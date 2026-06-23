import { isCoordinateInKorea, TrackingMapProvider } from './mapProvider';

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
const KAKAO_REST_API_KEY = process.env.EXPO_PUBLIC_KAKAO_REST_API_KEY ?? '';

export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type LocationSearchResult = Coordinates & {
  id: string;
  title: string;
  subtitle: string;
  provider?: TrackingMapProvider;
};

export async function geocodeHikeLocation(mountainName: string, meetingPoint?: string): Promise<Coordinates | null> {
  const result = (await searchLocations(meetingPoint?.trim() || mountainName.trim()))[0];
  if (result) return { latitude: result.latitude, longitude: result.longitude };

  return null;
}

export async function searchLocations(query: string): Promise<LocationSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const [kakaoResults, googleResults] = await Promise.all([
    searchKakaoLocations(trimmed),
    searchGoogleLocations(trimmed),
  ]);

  const deduped = new Map<string, LocationSearchResult>();
  [...kakaoResults, ...googleResults].forEach((result) => {
    const key = `${result.title}-${result.latitude.toFixed(5)}-${result.longitude.toFixed(5)}`;
    if (!deduped.has(key)) deduped.set(key, result);
  });

  return Array.from(deduped.values()).sort((a, b) => {
    const aKorea = isCoordinateInKorea(a);
    const bKorea = isCoordinateInKorea(b);
    if (aKorea !== bKorea) return aKorea ? -1 : 1;
    if (a.provider !== b.provider) return a.provider === 'kakao' ? -1 : 1;
    return 0;
  });
}

async function searchKakaoLocations(query: string): Promise<LocationSearchResult[]> {
  if (!KAKAO_REST_API_KEY) return [];

  try {
    const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=10`;
    const response = await fetch(url, {
      headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` },
    });
    if (!response.ok) return [];

    const json = await response.json();
    const documents = Array.isArray(json.documents) ? json.documents : [];

    return documents
      .map((item: any, index: number) => {
        const latitude = Number(item.y);
        const longitude = Number(item.x);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

        return {
          id: item.id ? `kakao-${item.id}` : `kakao-${latitude}-${longitude}-${index}`,
          title: item.place_name ?? query,
          subtitle: item.road_address_name || item.address_name || item.category_name || '',
          latitude,
          longitude,
          provider: 'kakao' as const,
        };
      })
      .filter(Boolean) as LocationSearchResult[];
  } catch (error) {
    console.warn('[Geocoding] Failed to search Kakao locations:', error);
    return [];
  }
}

async function searchGoogleLocations(query: string): Promise<LocationSearchResult[]> {
  if (!GOOGLE_MAPS_API_KEY) return [];

  const searchQuery = query.trim();
  if (!searchQuery) return [];

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(searchQuery)}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&language=ko`;
    const response = await fetch(url);
    if (!response.ok) return [];

    const json = await response.json();
    const results = Array.isArray(json.results) ? json.results : [];

    return results
      .map((result: any, index: number) => {
        const location = result.geometry?.location;
        if (typeof location?.lat !== 'number' || typeof location?.lng !== 'number') return null;

        const title = result.formatted_address?.replace(/^대한민국\s*/, '') ?? query.trim();
        return {
          id: result.place_id ?? `${location.lat}-${location.lng}-${index}`,
          title,
          subtitle: result.types?.join(', ') ?? '',
          latitude: location.lat,
          longitude: location.lng,
          provider: 'google' as const,
        };
      })
      .filter(Boolean) as LocationSearchResult[];
  } catch (error) {
    console.warn('[Geocoding] Failed to search Google locations:', error);
    return [];
  }
}

export async function reverseGeocodeLocation(latitude: number, longitude: number): Promise<string | null> {
  if (!GOOGLE_MAPS_API_KEY) return null;

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&language=ko&region=kr`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const json = await response.json();
    const address = json.results?.[0]?.formatted_address;
    return typeof address === 'string' ? address.replace(/^대한민국\s*/, '') : null;
  } catch (error) {
    console.warn('[Geocoding] Failed to reverse geocode location:', error);
    return null;
  }
}
