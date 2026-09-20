import type { GeocodeProvider, GeocodeQuery, GeocodeResult } from "./types";

const BASE = "https://apis.datos.gob.ar/georef/api/direcciones";
const PROVINCE_ID: Record<string, string> = { CABA: "02", "Buenos Aires": "06" };

type GeorefDireccion = {
  ubicacion?: { lat: number | null; lon: number | null } | null;
  localidad_censal?: { nombre?: string } | null;
  departamento?: { nombre?: string } | null;
  nomenclatura?: string;
};

/** Argentina's official, free geocoder. Two attempts: with locality, then province only. */
export class GeorefProvider implements GeocodeProvider {
  readonly name = "georef";
  constructor(private fetchImpl: typeof fetch = fetch) {}

  async geocode(q: GeocodeQuery): Promise<GeocodeResult | null> {
    const direccion = q.number && q.number !== "S/N" ? `${q.street} ${q.number}` : q.street;
    const prov = q.province ? PROVINCE_ID[q.province] : undefined;
    const attempts: Record<string, string>[] = [];
    if (q.locality && q.province !== "CABA") attempts.push({ direccion, ...(prov ? { provincia: prov } : {}), localidad: q.locality, max: "3" });
    attempts.push({ direccion, ...(prov ? { provincia: prov } : {}), max: "3" });
    for (const [i, params] of attempts.entries()) {
      const url = `${BASE}?${new URLSearchParams(params).toString()}`;
      const res = await this.fetchImpl(url, { headers: { accept: "application/json" } });
      if (!res.ok) continue;
      const json = (await res.json()) as { direcciones?: GeorefDireccion[] };
      const hit = (json.direcciones ?? []).find((d) => d.ubicacion && d.ubicacion.lat != null && d.ubicacion.lon != null);
      if (hit && hit.ubicacion) {
        return {
          lat: hit.ubicacion.lat as number,
          lng: hit.ubicacion.lon as number,
          confidence: i === 0 ? 0.9 : 0.7,
          provider: this.name,
          locality: hit.localidad_censal?.nombre ?? null,
          partido: hit.departamento?.nombre ?? null,
          raw: hit,
        };
      }
    }
    return null;
  }
}
