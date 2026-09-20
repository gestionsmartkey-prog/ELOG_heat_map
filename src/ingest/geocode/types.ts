export type GeocodeQuery = {
  street: string;
  number: string | null;
  locality: string | null;
  province: string | null; // 'CABA' | 'Buenos Aires' | other
  postal_code: string | null;
};

export type GeocodeResult = {
  lat: number;
  lng: number;
  confidence: number; // 0..1
  provider: string;
  locality: string | null;
  partido: string | null;
  raw: unknown;
};

export interface GeocodeProvider {
  readonly name: string;
  geocode(q: GeocodeQuery): Promise<GeocodeResult | null>;
}

/** AMBA bounding box, generous. Anything outside is flagged, not rejected. */
export const AMBA_BBOX = { minLat: -35.2, maxLat: -34.2, minLng: -59.2, maxLng: -57.9 };
export function insideAmba(lat: number, lng: number): boolean {
  return lat >= AMBA_BBOX.minLat && lat <= AMBA_BBOX.maxLat && lng >= AMBA_BBOX.minLng && lng <= AMBA_BBOX.maxLng;
}
