import { LocationRecord } from './database';

/**
 * GPS 고도 데이터의 노이즈를 필터링하여 누적 상승 고도를 계산합니다.
 * @param records 위치 기록 배열
 * @param threshold 고도 변화 임계값 (미터). 이 값 이상의 변동만 유효한 상승/하강으로 간주합니다.
 * @returns 누적 상승 고도 (미터)
 */
export const calculateElevationGain = (records: LocationRecord[], threshold: number = 3): number => {
  if (!records || records.length < 2) return 0;

  let gain = 0;
  let lastValidAltitude = records[0].altitude;

  for (let i = 1; i < records.length; i++) {
    const currentAltitude = records[i].altitude;
    const diff = currentAltitude - lastValidAltitude;

    if (diff >= threshold) {
      // 임계값 이상 상승 시 누적
      gain += diff;
      lastValidAltitude = currentAltitude;
    } else if (diff <= -threshold) {
      // 임계값 이상 하강 시 기준점 갱신 (추후 재상승을 계산하기 위함)
      lastValidAltitude = currentAltitude;
    }
    // 그 외의 미세한 변동(노이즈)은 무시하고 lastValidAltitude 유지
  }

  return gain;
};

/**
 * 누적 상승 고도를 층수로 환산합니다. (1층 = 약 3m)
 * @param elevationGain 누적 상승 고도 (미터)
 * @returns 환산된 층수
 */
export const calculateFloors = (elevationGain: number): number => {
  return Math.floor(elevationGain / 3);
};
