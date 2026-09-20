import type { GeocodeProvider, GeocodeQuery, GeocodeResult } from "./types";

type GoogleResult = {
  geometry: { location: { lat: number; lng: number }; location_type: string };
  address_components: { long_name: string; types: string[] }[];
  partial_match?: boolean;
};

/** Paid fallback. Only used when GEOCODING_API_KEY is set. */
export class GoogleProvider implements GeocodeProvider {
  readonly name = "google";
  constructor(private apiKey: string, private fetchImpl: typeof fetch = fetch) {}

  async geocode(q: GeocodeQuery): Promise<GeocodeResult | null> {
    const parts = [q.number && q.number !== "S/N" ? `${q.street} ${q.number}` : q.street, q.locality, q.province === "CABA" ? "Ciudad Autónoma de Buenos Aires" : q.province, "Argentina"].filter(Boolean);
    const params = new URLSearchParams({ address: parts.join(", "), region: "ar", key: this.apiKey });
    if (q.postal_code) params.set("components", `country:AR|postal_code:${q.postal_code}`);
    else params.set("components", "country:AR");
    const res = await this.fetchImpl(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { status: string; results: GoogleResult[] };
    const r = json.results?.[0];
    if (json.status !== "OK" || !r) return null;
    const comp = (t: string) => r.address_components.find((c) => c.types.includes(t))?.long_name ?? null;
    const confidence = r.geometry.location_type === "ROOFTOP" ? 0.95 : r.geometry.location_type === "RANGE_INTERPOLATED" ? 0.8 : 0.5;
    return {
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      confidence: r.partial_match ? Math.min(confidence, 0.5) : confidence,
      provider: this.name,
      locality: comp("sublocality") ?? comp("locality"),
      partido: comp("administrative_area_level_2"),
      raw: r,
    };
  }
}
