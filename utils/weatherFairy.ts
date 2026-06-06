// 날씨요정 지수 계산 엔진
// 컨셉: "내가 참석한 덩산"의 날씨가 "전체 덩산 평균"보다 얼마나 좋은지 정량화
// Supabase RLS/schema note:
// - hike_sessions INSERT/SELECT must be scoped by auth.uid() = user_id for personal rows.
// - Global comparison should use the get_weather_fairy_stats RPC or an aggregate view
//   instead of exposing all users' raw hike_sessions rows to clients.

import { supabase, SUPABASE_TABLES } from './supabase';

export interface HikeSession {
  id?: string;
  user_id: string;
  started_at: string;
  ended_at: string;
  weather_score: number; // 0-100 (높을수록 좋은 날씨)
  location_name?: string;
  temp?: number;
  wind_speed?: number;
}

export type WeatherFairyBadge =
  // 🧚 요정 계열
  | 'sprout'      // 새싹 날씨요정 🌱
  | 'fairy'       // 날씨요정 🧚
  | 'gold'        // 골드 날씨요정 ✨
  // 👺 요괴 계열
  | 'goblin'      // 날씨요괴 👺
  | 'goblin_boss' // 대왕 날씨요괴 🌩️

export interface WeatherFairyResult {
  index: number;           // 날씨요정 지수 (50 기준: 높을수록 날씨요정)
  userAvg: number;         // 내 덩산 날씨 평균
  globalAvg: number;       // 전체 덩산 날씨 평균
  mySessionCount: number;  // 내 참석 횟수
  totalSessionCount: number;
  badge: WeatherFairyBadge | null;
  badgeLabel: string;
  badgeEmoji: string;
  description: string;
}

type WeatherFairyStats = {
  globalAvg: number;
  totalSessionCount: number;
};

// 날씨요정 지수 공식:
//   index = (내 평균 날씨 점수) - (전체 평균) + 50
//   50 = 평균 수준, 50 이상이면 남들보다 날씨가 좋을 때 덩산
//
// 뱃지 기준 (관대하게 설정 — 쉽게 받을 수 있도록):
//   >= 42: 새싹 날씨요정 🌱 (평균보다 8점 낮아도 OK!)
//   >= 52: 날씨요정 ⭐ (평균보다 조금 높으면)
//   >= 65: 골드 날씨요정 ✨ (명확히 날씨가 좋을 때 옴)
export function calculateWeatherFairyIndex(
  mySessions: HikeSession[],
  allSessions: HikeSession[]
): WeatherFairyResult {
  const myCount = mySessions.length;
  const totalCount = allSessions.length;

  if (myCount === 0) {
    return {
      index: 50,
      userAvg: 0,
      globalAvg: 0,
      mySessionCount: 0,
      totalSessionCount: totalCount,
      badge: null,
      badgeLabel: '아직 없음',
      badgeEmoji: '—',
      description: '덩산에 참석하면 날씨요정 지수를 계산할 수 있어요!',
    };
  }

  const userAvg = mySessions.reduce((sum, s) => sum + s.weather_score, 0) / myCount;

  // 전체 평균: 내 세션 포함 (전체 기준)
  // 단, 내 세션만 있을 경우 globalAvg = userAvg → index = 50 (중립)
  const globalAvg = totalCount > 0
    ? allSessions.reduce((sum, s) => sum + s.weather_score, 0) / totalCount
    : userAvg;

  // 지수 계산 (소수점 1자리)
  const rawIndex = userAvg - globalAvg + 50;
  const index = Math.round(Math.max(0, Math.min(100, rawIndex)) * 10) / 10;

  // 뱃지 판정 (관대한 기준)
  let badge: WeatherFairyBadge | null = null;
  let badgeLabel = '일반 크루원';
  let badgeEmoji = '🏃';

  if (index >= 65) {
    badge = 'gold';
    badgeLabel = '골드 날씨요정';
    badgeEmoji = '✨';
  } else if (index >= 52) {
    badge = 'fairy';
    badgeLabel = '날씨요정';
    badgeEmoji = '🧚';
  } else if (index >= 42) {
    badge = 'sprout';
    badgeLabel = '새싹 날씨요정';
    badgeEmoji = '🌱';
  } else if (index >= 30) {
    // 중립 구간 — 뱃지 없음 (일반 크루원)
    badge = null;
    badgeLabel = '일반 크루원';
    badgeEmoji = '🏃';
  } else if (index >= 18) {
    badge = 'goblin';
    badgeLabel = '날씨요괴';
    badgeEmoji = '👺';
  } else {
    badge = 'goblin_boss';
    badgeLabel = '대왕 날씨요괴';
    badgeEmoji = '🌩️';
  }

  // 설명 메시지
  let description = '';
  if (myCount === 1) {
    description = '아직 1회 참석이에요. 더 참석할수록 정확해져요!';
  } else if (index >= 65) {
    description = '확실한 날씨요정! 당신이 오면 하늘이 맑아져요 ☀️';
  } else if (index >= 52) {
    description = '평균보다 날씨 좋은 날 잘 참석하네요 😊';
  } else if (index >= 42) {
    description = '날씨요정의 기운이 느껴져요 🌤️';
  } else if (index >= 30) {
    description = '조금만 더! 맑은 날 자주 참석하면 날씨요정이 될 수 있어요 🌈';
  } else if (index >= 18) {
    description = '앗, 날씨요괴 출현! 맑은 날 참석이 쌓이면 날씨요정으로 변신할 수 있어요 🌱';
  } else {
    description = '전설의 대왕 날씨요괴... 하지만 맑은 날 참석하면 언젠가 요정이 될 수 있어요! 💪';
  }

  return {
    index,
    userAvg: Math.round(userAvg),
    globalAvg: Math.round(globalAvg),
    mySessionCount: myCount,
    totalSessionCount: totalCount,
    badge,
    badgeLabel,
    badgeEmoji,
    description,
  };
}

// Supabase에 덩산 세션 저장
export async function saveHikeSession(session: Omit<HikeSession, 'id'>): Promise<void> {
  const { error } = await supabase.from(SUPABASE_TABLES.HIKE_SESSIONS).insert(session);
  if (error) {
    console.error('[HikeSession] 저장 실패:', error.message);
    throw error;
  }
}

// 내 덩산 세션 조회
export async function fetchMySessions(userId: string): Promise<HikeSession[]> {
  const { data, error } = await supabase
    .from(SUPABASE_TABLES.HIKE_SESSIONS)
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false });

  if (error) {
    console.error('[HikeSession] 내 세션 조회 실패:', error.message);
    return [];
  }
  return data ?? [];
}

async function fetchWeatherFairyStats(): Promise<WeatherFairyStats | null> {
  const { data, error } = await supabase.rpc('get_weather_fairy_stats');

  if (error) {
    console.warn('[HikeSession] 집계 RPC 조회 실패:', error.message);
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return { globalAvg: 0, totalSessionCount: 0 };
  }

  return {
    globalAvg: Number(row.global_avg ?? row.globalAvg ?? 0),
    totalSessionCount: Number(row.total_session_count ?? row.totalSessionCount ?? 0),
  };
}

// 전체 raw row 조회 fallback. RPC/view 준비 전 개발 환경에서만 쓰고, 운영에서는 집계 RPC를 우선 사용합니다.
export async function fetchAllSessions(): Promise<HikeSession[]> {
  const { data, error } = await supabase
    .from(SUPABASE_TABLES.HIKE_SESSIONS)
    .select('user_id, weather_score, started_at');

  if (error) {
    console.error('[HikeSession] 전체 세션 조회 실패:', error.message);
    return [];
  }
  return (data ?? []) as HikeSession[];
}

// 날씨요정 지수를 Supabase에서 계산해 반환
export async function getWeatherFairyResult(userId: string): Promise<WeatherFairyResult> {
  const [mySessions, aggregateStats] = await Promise.all([
    fetchMySessions(userId),
    fetchWeatherFairyStats(),
  ]);

  if (aggregateStats) {
    const myCount = mySessions.length;
    if (myCount === 0) {
      return calculateWeatherFairyIndex(mySessions, []);
    }

    const userAvg = mySessions.reduce((sum, session) => sum + session.weather_score, 0) / myCount;
    const syntheticAllSessions: HikeSession[] = Array.from(
      { length: Math.max(aggregateStats.totalSessionCount, 1) },
      (_, index) => ({
        user_id: index === 0 ? userId : 'aggregate',
        started_at: '',
        ended_at: '',
        weather_score: aggregateStats.globalAvg,
      }),
    );
    const result = calculateWeatherFairyIndex(mySessions, syntheticAllSessions);

    return {
      ...result,
      userAvg: Math.round(userAvg),
      globalAvg: Math.round(aggregateStats.globalAvg),
      totalSessionCount: aggregateStats.totalSessionCount,
    };
  }

  const allSessions = await fetchAllSessions();
  return calculateWeatherFairyIndex(mySessions, allSessions);
}
