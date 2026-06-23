const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type LocationSearchResult = Coordinates & {
  id: string;
  title: string;
  subtitle: string;
};

export async function geocodeHikeLocation(mountainName: string, meetingPoint?: string): Promise<Coordinates | null> {
  const result = (await searchLocations(meetingPoint?.trim() || mountainName.trim()))[0];
  if (result) return { latitude: result.latitude, longitude: result.longitude };

  return null;
}

export async function searchLocations(query: string): Promise<LocationSearchResult[]> {
  if (!GOOGLE_MAPS_API_KEY) return [];

  const searchQuery = `${query.trim()} 대한민국`;
  if (!query.trim()) return [];

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(searchQuery)}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&language=ko&region=kr`;
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
        };
      })
      .filter(Boolean) as LocationSearchResult[];
  } catch (error) {
    console.warn('[Geocoding] Failed to search locations:', error);
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
