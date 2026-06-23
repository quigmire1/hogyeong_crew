export type CoordinateLike = {
  latitude: number;
  longitude: number;
};

export type TrackingMapProvider = 'kakao' | 'google';

const KOREA_BOUNDS = {
  minLatitude: 33,
  maxLatitude: 39,
  minLongitude: 124,
  maxLongitude: 132,
};

export const isCoordinateInKorea = (coordinate?: CoordinateLike | null) => {
  if (!coordinate) {
    return false;
  }

  const { latitude, longitude } = coordinate;

  return (
    latitude >= KOREA_BOUNDS.minLatitude &&
    latitude <= KOREA_BOUNDS.maxLatitude &&
    longitude >= KOREA_BOUNDS.minLongitude &&
    longitude <= KOREA_BOUNDS.maxLongitude
  );
};

export const getTrackingMapProvider = (
  coordinate?: CoordinateLike | null,
): TrackingMapProvider => (isCoordinateInKorea(coordinate) ? 'kakao' : 'google');
