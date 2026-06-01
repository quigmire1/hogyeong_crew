export type RecommendedTrail = {
  name: string;
  dist: string;
  diff: '쉬움' | '보통' | '어려움';
  time: string;
  emoji: string;
};

export const RECOMMENDED_TRAILS: RecommendedTrail[] = [
  { name: '북한산 백운대', dist: '8.2km', diff: '어려움', time: '5h', emoji: '⛰️' },
  { name: '관악산 연주대', dist: '6.5km', diff: '보통', time: '3.5h', emoji: '🏔️' },
  { name: '인왕산 범바위', dist: '4.1km', diff: '쉬움', time: '2h', emoji: '🌄' },
];
