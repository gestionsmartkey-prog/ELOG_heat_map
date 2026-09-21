import { supabaseAdmin } from "./supabase";

export type GeocodeCounts = { pending: number; ok: number; failed: number; review: number; manual: number };
export type GeocodePass = { counts: GeocodeCounts; processed: Record<string, number>; done: boolean; elapsed_ms: number };

const PASS_LIMIT = 2;          // locations per database call; each one is bounded to ~5 s inside Postgres (migration 0004)
const STATEMENT_TIMEOUT = "57014"; // PostgREST sessions carry an 8 s statement timeout
const DEFAULT_BUDGET_MS = 20_000;

export async function geocodeCounts(): Promise<GeocodeCounts> {
  if (process.env.DATA_SOURCE === "fixture") return { pending: 0, ok: 0, failed: 0, review: 0, manual: 0 };
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("geocode_status_counts").single();
  if (error) throw new Error(`geocode_status_counts: ${error.message}`);
  const d = data as Record<string, number | string>;
  return { pending: Number(d.pending), ok: Number(d.ok), failed: Number(d.failed), review: Number(d.review), manual: Number(d.manual) };
}

/**
 * Runs the in-database georef geocoder in small slices until nothing is left or
 * the time budget is spent. Callers loop on `done === false`.
 */
export async function runGeocodePass(opts: { retry?: boolean; budgetMs?: number } = {}): Promise<GeocodePass> {
  const started = Date.now();
  const budget = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const processed: Record<string, number> = {};
  if (process.env.DATA_SOURCE === "fixture") return { counts: await geocodeCounts(), processed, done: true, elapsed_ms: 0 };

  const sb = supabaseAdmin();
  let retry = Boolean(opts.retry);
  let limit = PASS_LIMIT;
  for (;;) {
    const { data, error } = await sb.rpc("georef_geocode_pending", { p_limit: limit, p_retry: retry });
    if (error) {
      // A slow georef answer can still push two locations past the timeout: shrink to one and go on.
      if (error.code === STATEMENT_TIMEOUT && limit > 1) { limit = 1; continue; }
      throw new Error(`georef_geocode_pending: ${error.message}`);
    }
    const rows = (data ?? []) as { status: string; n: number | string }[];
    let n = 0;
    for (const r of rows) { processed[r.status] = (processed[r.status] ?? 0) + Number(r.n); n += Number(r.n); }
    if (n === 0) break;
    // A retry pass touches failed rows once; do not loop over them forever.
    if (retry && n < limit) retry = false;
    if (Date.now() - started > budget) break;
  }
  const counts = await geocodeCounts();
  return { counts, processed, done: counts.pending === 0, elapsed_ms: Date.now() - started };
}
