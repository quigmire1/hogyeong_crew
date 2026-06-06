// 기상청 초단기예보 API 유틸리티 + 날씨 유의성 테스트

const DEFAULT_API_KEY = process.env.EXPO_PUBLIC_WEATHER_API_KEY ?? '';
// 기상청 공공데이터포털 단기예보 서비스 API (초단기예보)
const BASE_URL = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst';
const BASE_TIME_RETRY_COUNT = 3;

// LCC DFS Coordinate Transformation (위경도 -> 기상청 격자 x, y 변환)
function dfs_xy_conv(lat: number, lon: number) {
  const RE = 6371.00877; // 지구 반경(km)
  const GRID = 5.0; // 격자 간격(km)
  const SLAT1 = 30.0; // 투영 위도1(degree)
  const SLAT2 = 60.0; // 투영 위도2(degree)
  const OLON = 126.0; // 기준점 경도(degree)
  const OLAT = 38.0; // 기준점 위도(degree)
  const XO = 43; // 기준점 X좌표(GRID)
  const YO = 136; // 기1준점 Y좌표(GRID)
  
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
  
  let ra = Math.tan(Math.PI * 0.25 + (lat) * DEGRAD * 0.5);
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

// 기상청 API 호출을 위한 Base Time 계산 (매시간 45분 업데이트)
function formatBaseDateTime(date: Date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();

  const baseDate = `${year}${month.toString().padStart(2, '0')}${day.toString().padStart(2, '0')}`;
  const baseTime = `${hours.toString().padStart(2, '0')}30`;
  return { baseDate, baseTime };
}

function getBaseDateTimeCandidates(now = new Date()) {
  const base = new Date(now);
  if (base.getMinutes() < 45) {
    base.setHours(base.getHours() - 1);
  }

  return Array.from({ length: BASE_TIME_RETRY_COUNT }, (_, index) => {
    const candidate = new Date(base);
    candidate.setHours(base.getHours() - index);
    return formatBaseDateTime(candidate);
  });
}

export interface WeatherData {
  temp: number;         // 기온 °C
  feelsLike: number;    // 체감 온도
  humidity: number;     // 습도 %
  windSpeed: number;    // 풍속 m/s
  windGust?: number;    // 돌풍 m/s
  description: string;  // 날씨 설명
  icon: string;         // 아이콘 코드
  rain1h?: number;      // 1시간 강수량 mm
  snow1h?: number;      // 1시간 적설량 mm
  visibility: number;   // 가시거리 m
  clouds: number;       // 구름양 %
  cityName: string;
}

// 날씨 유의성 판단 결과
export type SafetyLevel = 'safe' | 'caution' | 'danger';

export interface SafetyResult {
  level: SafetyLevel;
  score: number;          // 0~100 (높을수록 좋음)
  reasons: string[];      // 유의 사항 목록
  recommendation: string; // 종합 권고 메시지
  emoji: string;
}

// 날씨 유의성 테스트 핵심 로직
export function evaluateHikingSafety(w: WeatherData): SafetyResult {
  const reasons: string[] = [];
  let deduction = 0;

  // 1. 기온 체크
  if (w.temp < 0) {
    reasons.push(`❄️ 영하 기온 (${w.temp}°C) — 동상 위험`);
    deduction += 25;
  } else if (w.temp < 5) {
    reasons.push(`🥶 저온 (${w.temp}°C) — 방한 장비 필수`);
    deduction += 10;
  } else if (w.temp > 35) {
    reasons.push(`🥵 폭염 (${w.temp}°C) — 열사병 위험`);
    deduction += 20;
  } else if (w.temp > 30) {
    reasons.push(`☀️ 고온 (${w.temp}°C) — 수분 보충 필수`);
    deduction += 8;
  }

  // 2. 풍속 체크
  if (w.windSpeed >= 14) {
    reasons.push(`💨 강풍 (${w.windSpeed.toFixed(1)}m/s) — 능선 덩산 위험`);
    deduction += 30;
  } else if (w.windSpeed >= 9) {
    reasons.push(`🌬️ 강한 바람 (${w.windSpeed.toFixed(1)}m/s) — 주의 필요`);
    deduction += 15;
  } else if (w.windSpeed >= 5) {
    reasons.push(`🍃 바람 있음 (${w.windSpeed.toFixed(1)}m/s)`);
    deduction += 3;
  }

  // 3. 돌풍 체크
  if (w.windGust && w.windGust >= 17) {
    reasons.push(`⚡ 돌풍 (${w.windGust.toFixed(1)}m/s) — 덩산 매우 위험`);
    deduction += 20;
  }

  // 4. 강수 체크
  if (w.rain1h && w.rain1h > 10) {
    reasons.push(`🌧️ 강우 (${w.rain1h}mm/h) — 덩산 불가 수준`);
    deduction += 40;
  } else if (w.rain1h && w.rain1h > 0) {
    reasons.push(`🌦️ 강수 (${w.rain1h}mm/h) — 미끄럼 주의`);
    deduction += 20;
  }

  // 5. 적설 체크
  if (w.snow1h && w.snow1h > 0) {
    reasons.push(`❄️ 적설 (${w.snow1h}mm/h) — 아이젠 필요`);
    deduction += 25;
  }

  // 6. 가시거리 체크
  if (w.visibility < 1000) {
    reasons.push(`🌫️ 가시거리 불량 (${(w.visibility / 1000).toFixed(1)}km) — 길 잃음 위험`);
    deduction += 20;
  } else if (w.visibility < 3000) {
    reasons.push(`🌁 가시거리 낮음 (${(w.visibility / 1000).toFixed(1)}km)`);
    deduction += 8;
  }

  // 7. 습도 체크
  if (w.humidity > 90) {
    reasons.push(`💧 매우 높은 습도 (${w.humidity}%) — 땀 배출 어려움`);
    deduction += 5;
  }

  const score = Math.max(0, 100 - deduction);
  let level: SafetyLevel;
  let recommendation: string;
  let emoji: string;

  if (score >= 75) {
    level = 'safe';
    recommendation = '오늘은 덩산하기 좋은 날입니다! 즐거운 덩산 되세요 🏔️';
    emoji = '✅';
  } else if (score >= 45) {
    level = 'caution';
    recommendation = '덩산 가능하나 주의가 필요합니다. 장비를 꼼꼼히 챙기세요 ⚠️';
    emoji = '⚠️';
  } else {
    level = 'danger';
    recommendation = '현재 기상 상태로 덩산은 위험합니다. 일정을 재고하세요 🚫';
    emoji = '🚫';
  }

  return { level, score, reasons, recommendation, emoji };
}

type FetchWeatherOptions = {
  apiKey?: string;
  now?: Date;
};

type KmaForecastItem = {
  category: string;
  fcstTime: string;
  fcstValue: string;
};

export async function fetchWeather(
  lat: number,
  lon: number,
  options: FetchWeatherOptions = {},
): Promise<WeatherData> {
  const apiKey = options.apiKey ?? DEFAULT_API_KEY;
  if (!apiKey) throw new Error('날씨 API 키가 설정되지 않았습니다.');

  const { x, y } = dfs_xy_conv(lat, lon);
  const baseDateTimeCandidates = getBaseDateTimeCandidates(options.now);
  let lastError: Error | null = null;
  let items: KmaForecastItem[] | null = null;

  for (const { baseDate, baseTime } of baseDateTimeCandidates) {
    const url = `${BASE_URL}?serviceKey=${encodeURIComponent(apiKey)}&pageNo=1&numOfRows=60&dataType=JSON&base_date=${baseDate}&base_time=${baseTime}&nx=${x}&ny=${y}`;

    const res = await fetch(url);
    if (!res.ok) {
      lastError = new Error(`기상청 API HTTP 오류: ${res.status}`);
      continue;
    }

    const json = await res.json();

    if (json.response?.header?.resultCode !== '00') {
      lastError = new Error(`기상청 API 오류: ${json.response?.header?.resultMsg ?? '알 수 없는 오류'}`);
      continue;
    }

    const nextItems = json.response?.body?.items?.item as KmaForecastItem[] | undefined;
    if (nextItems && nextItems.length > 0) {
      items = nextItems;
      break;
    }

    lastError = new Error(`기상청 API에서 ${baseDate} ${baseTime} 날씨 데이터를 찾을 수 없습니다.`);
  }

  if (!items) {
    throw lastError ?? new Error('기상청 API에서 날씨 데이터를 찾을 수 없습니다.');
  }

  // 예보 중 가장 가까운 시간(첫 번째 시간)의 데이터만 추출
  const targetTime = items[0].fcstTime;
  const w: Record<string, string> = {};
  
  for (const it of items) {
    if (it.fcstTime === targetTime) {
      w[it.category] = it.fcstValue;
    }
  }

  const pty = w['PTY']; // 강수형태: 0 없음, 1 비, 2 비/눈, 3 눈, 5 빗방울, 6 빗방울눈날림, 7 눈날림
  const sky = w['SKY']; // 하늘상태: 1 맑음, 3 구름많음, 4 흐림

  let description = '';
  let icon = '01d';
  
  if (pty === '1' || pty === '5') {
    description = '비'; icon = '09d';
  } else if (pty === '3' || pty === '7') {
    description = '눈'; icon = '13d';
  } else if (pty === '2' || pty === '6') {
    description = '비/눈'; icon = '13d';
  } else {
    if (sky === '1') { description = '맑음'; icon = '01d'; }
    else if (sky === '3') { description = '구름많음'; icon = '03d'; }
    else if (sky === '4') { description = '흐림'; icon = '04d'; }
  }

  // 강수량 처리 ('강수없음' 문자열은 0으로 처리)
  const rn1Str = w['RN1'] === '강수없음' ? '0' : (w['RN1']?.replace(/[^0-9.]/g, '') || '0');
  const rn1 = parseFloat(rn1Str);
  const temp = parseFloat(w['T1H']) || 0;

  return {
    temp: temp,
    feelsLike: temp, // 기상청 API는 체감온도를 제공하지 않으므로 기온과 동일하게 처리
    humidity: parseFloat(w['REH']) || 0,
    windSpeed: parseFloat(w['WSD']) || 0,
    description,
    icon,
    rain1h: (pty === '1' || pty === '5') ? rn1 : 0,
    snow1h: (pty === '3' || pty === '7') ? rn1 : 0,
    visibility: 10000,
    clouds: sky === '4' ? 100 : sky === '3' ? 50 : 0,
    cityName: '현위치 (대한민국)',
  };
}

// 날씨 아이콘 이모지 변환
export function weatherIconToEmoji(icon: string): string {
  const map: Record<string, string> = {
    '01d': '☀️', '01n': '🌙',
    '02d': '⛅', '02n': '⛅',
    '03d': '🌥️', '03n': '🌥️',
    '04d': '☁️', '04n': '☁️',
    '09d': '🌧️', '09n': '🌧️',
    '10d': '🌦️', '10n': '🌦️',
    '11d': '⛈️', '11n': '⛈️',
    '13d': '❄️', '13n': '❄️',
    '50d': '🌫️', '50n': '🌫️',
  };
  return map[icon] ?? '🌤️';
}
