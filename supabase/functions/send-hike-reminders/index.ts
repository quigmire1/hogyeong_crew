import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Hike = {
  id: string;
  mountain_name: string;
  meeting_point: string | null;
  start_time: string | null;
  meeting_at: string | null;
  forecast_lat: number | null;
  forecast_lon: number | null;
  group_hike_attendance?: { user_id: string }[];
  group_hike_reminder_deliveries?: { id: string }[];
};

type KmaItem = {
  category: string;
  fcstDate: string;
  fcstTime: string;
  fcstValue: string;
};

const KST = 'Asia/Seoul';
const KMA_URL = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst';

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Missing Supabase env' }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { start, end } = tomorrowKstRange();
  const { data: hikes, error } = await supabase
    .from('group_hikes')
    .select(`
      id,
      mountain_name,
      meeting_point,
      start_time,
      meeting_at,
      forecast_lat,
      forecast_lon,
      group_hike_attendance(user_id),
      group_hike_reminder_deliveries(id)
    `)
    .eq('status', 'SCHEDULED')
    .gte('start_time', start.toISOString())
    .lt('start_time', end.toISOString());

  if (error) return json({ error: error.message }, 500);

  let sentHikes = 0;
  let sentNotifications = 0;

  for (const hike of (hikes ?? []) as Hike[]) {
    if ((hike.group_hike_reminder_deliveries?.length ?? 0) > 0) continue;

    const userIds = Array.from(new Set((hike.group_hike_attendance ?? []).map((row) => row.user_id).filter(Boolean)));
    if (userIds.length === 0) continue;

    const { data: tokenRows, error: tokenError } = await supabase
      .from('app_push_tokens')
      .select('token')
      .in('user_id', userIds);

    if (tokenError) {
      console.warn('[send-hike-reminders] token lookup failed', tokenError.message);
      continue;
    }

    const tokens = Array.from(new Set((tokenRows ?? []).map((row: { token: string }) => row.token)));
    if (tokens.length === 0) continue;

    const weather = await weatherSummary(hike);
    const meeting = formatKst(hike.start_time ?? hike.meeting_at);
    const place = hike.meeting_point ? ` · ${hike.meeting_point}` : '';
    const body = `${meeting}${place}\n${weather}`;

    const messages = tokens.map((to) => ({
      to,
      sound: 'default',
      channelId: 'hike-reminders',
      title: `내일 ${hike.mountain_name} 덩산`,
      body,
      data: { hikeId: hike.id },
    }));

    const pushResponse = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    if (!pushResponse.ok) {
      console.warn('[send-hike-reminders] Expo push failed', await pushResponse.text());
      continue;
    }

    const { error: logError } = await supabase
      .from('group_hike_reminder_deliveries')
      .insert({
        hike_id: hike.id,
        recipient_count: tokens.length,
        weather_summary: weather,
      });

    if (logError) {
      console.warn('[send-hike-reminders] reminder log failed', logError.message);
    }

    sentHikes += 1;
    sentNotifications += tokens.length;
  }

  return json({ sentHikes, sentNotifications });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function tomorrowKstRange(now = new Date()) {
  const p = kstParts(now);
  const start = new Date(Date.UTC(p.year, p.month - 1, p.day + 1, -9));
  const end = new Date(Date.UTC(p.year, p.month - 1, p.day + 2, -9));
  return { start, end };
}

function kstParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: KST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  };
}

function formatKst(iso?: string | null) {
  if (!iso) return '시간 미정';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: KST,
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

async function weatherSummary(hike: Hike) {
  const apiKey = Deno.env.get('WEATHER_API_KEY');
  const date = hike.start_time ?? hike.meeting_at;
  if (!apiKey || !date || hike.forecast_lat == null || hike.forecast_lon == null) {
    return '날씨예보를 확인할 수 없어요.';
  }

  try {
    const { x, y } = dfs(hike.forecast_lat, hike.forecast_lon);
    const base = kmaBaseDateTime();
    const target = kmaTargetDateTime(new Date(date));
    const url = `${KMA_URL}?serviceKey=${encodeURIComponent(apiKey)}&pageNo=1&numOfRows=1000&dataType=JSON&base_date=${base.date}&base_time=${base.time}&nx=${x}&ny=${y}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`KMA HTTP ${response.status}`);

    const json = await response.json();
    const items = json.response?.body?.items?.item as KmaItem[] | undefined;
    if (!items?.length) throw new Error('No KMA items');

    const byTime = items.filter((item) => item.fcstDate === target.date && item.fcstTime === target.time);
    const picked = byTime.length ? byTime : nearestForecast(items, target.date, target.time);
    const values = Object.fromEntries(picked.map((item) => [item.category, item.fcstValue]));

    const sky = skyText(values.SKY);
    const pty = precipitationText(values.PTY);
    const temp = values.TMP ? `${values.TMP}°C` : '기온 정보 없음';
    const pop = values.POP ? `강수확률 ${values.POP}%` : '강수확률 정보 없음';
    const wind = values.WSD ? `풍속 ${values.WSD}m/s` : null;

    return [pty || sky, temp, pop, wind].filter(Boolean).join(' · ');
  } catch (error) {
    console.warn('[send-hike-reminders] weather failed', error);
    return '날씨예보를 확인할 수 없어요.';
  }
}

function kmaBaseDateTime(now = new Date()) {
  const p = kstParts(now);
  const baseHours = [2, 5, 8, 11, 14, 17, 20, 23];
  let hour = baseHours.filter((h) => h < p.hour || (h === p.hour && p.minute >= 15)).at(-1);
  let date = new Date(Date.UTC(p.year, p.month - 1, p.day, -9));

  if (hour == null) {
    hour = 23;
    date = new Date(Date.UTC(p.year, p.month - 1, p.day - 1, -9));
  }

  const d = kstParts(date);
  return {
    date: `${d.year}${pad(d.month)}${pad(d.day)}`,
    time: `${pad(hour)}00`,
  };
}

function kmaTargetDateTime(date: Date) {
  const p = kstParts(date);
  return {
    date: `${p.year}${pad(p.month)}${pad(p.day)}`,
    time: `${pad(p.hour)}00`,
  };
}

function nearestForecast(items: KmaItem[], date: string, time: string) {
  const sameDay = items.filter((item) => item.fcstDate === date);
  const times = Array.from(new Set(sameDay.map((item) => item.fcstTime))).sort();
  const nearest = times.reduce((best, current) => (
    Math.abs(Number(current) - Number(time)) < Math.abs(Number(best) - Number(time)) ? current : best
  ), times[0] ?? time);
  return sameDay.filter((item) => item.fcstTime === nearest);
}

function skyText(value?: string) {
  if (value === '1') return '맑음';
  if (value === '3') return '구름많음';
  if (value === '4') return '흐림';
  return '하늘상태 정보 없음';
}

function precipitationText(value?: string) {
  if (!value || value === '0') return null;
  if (value === '1') return '비';
  if (value === '2') return '비/눈';
  if (value === '3') return '눈';
  if (value === '4') return '소나기';
  return '강수 예보';
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function dfs(lat: number, lon: number) {
  const RE = 6371.00877;
  const GRID = 5.0;
  const SLAT1 = 30.0;
  const SLAT2 = 60.0;
  const OLON = 126.0;
  const OLAT = 38.0;
  const XO = 43;
  const YO = 136;
  const DEGRAD = Math.PI / 180.0;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD;
  const slat2 = SLAT2 * DEGRAD;
  const olon = OLON * DEGRAD;
  const olat = OLAT * DEGRAD;
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = Math.pow(sf, sn) * Math.cos(slat1) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = re * sf / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  ra = re * sf / Math.pow(ra, sn);
  let theta = lon * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;
  return {
    x: Math.floor(ra * Math.sin(theta) + XO + 0.5),
    y: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5),
  };
}
