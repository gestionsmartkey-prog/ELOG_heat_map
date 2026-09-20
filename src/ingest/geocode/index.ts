import type { GeocodeProvider, GeocodeQuery, GeocodeResult } from "./types";
import { GeorefProvider } from "./georef";
import { GoogleProvider } from "./google";

export * from "./types";
export { GeorefProvider, GoogleProvider };

export type GeocodeCache = {
  get(key: string): Promise<GeocodeResult | null | undefined>; // undefined = unknown, null = known failure
  set(key: string, result: GeocodeResult | null): Promise<void>;
};

export class MemoryCache implements GeocodeCache {
  private m = new Map<string, GeocodeResult | null>();
  async get(k: string) { return this.m.has(k) ? this.m.get(k) : undefined; }
  async set(k: string, r: GeocodeResult | null) { this.m.set(k, r); }
}

/** Tries providers in order, memoizes by address key, and never throws on a single failure. */
export class ChainGeocoder {
  constructor(private providers: GeocodeProvider[], private cache: GeocodeCache = new MemoryCache(), private delayMs = 0) {}

  async geocode(key: string, q: GeocodeQuery): Promise<GeocodeResult | null> {
    const cached = await this.cache.get(key);
    if (cached !== undefined) return cached;
    for (const p of this.providers) {
      try {
        const r = await p.geocode(q);
        if (r) { await this.cache.set(key, r); return r; }
      } catch {
        // provider error: fall through to the next one
      }
      if (this.delayMs) await new Promise((res) => setTimeout(res, this.delayMs));
    }
    await this.cache.set(key, null);
    return null;
  }
}

export function buildGeocoder(opts: { provider: "georef" | "google" | "none" | "auto"; googleKey?: string; cache?: GeocodeCache; delayMs?: number }): ChainGeocoder | null {
  const providers: GeocodeProvider[] = [];
  if (opts.provider === "none") return null;
  if (opts.provider === "georef" || opts.provider === "auto") providers.push(new GeorefProvider());
  if ((opts.provider === "google" || opts.provider === "auto") && opts.googleKey) providers.push(new GoogleProvider(opts.googleKey));
  if (!providers.length) return null;
  return new ChainGeocoder(providers, opts.cache, opts.delayMs ?? 150);
}
