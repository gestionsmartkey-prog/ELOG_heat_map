import { readFileSync } from "node:fs";
import { join } from "node:path";
import { latLngToCell } from "h3-js";
import { supabaseAdmin } from "./supabase";
import { fetchAllPages } from "./paging";
import { toMapSeller, type MapRow } from "./mapRows";
import { DEFAULT_BANDS, type BandRule } from "./opportunity";
import type { BatchSummary, MapSeller, SellersResponse } from "./types";

const H3_RES = 9;

/**
 * Data access for the map. DATA_SOURCE=fixture serves data/fixtures/sellers.json
 * (used for local dev and browser tests); anything else reads Supabase.
 */
export async function getSellersResponse(): Promise<SellersResponse> {
  if (process.env.DATA_SOURCE === "fixture") return loadFixture();

  const sb = supabaseAdmin();
  const [sellersRes, kindsRes, batchesRes, reviewsRes, bandsRes] = await Promise.all([
    // More than 1,000 sellers: read them in pages, ordered by a unique key so none repeat or go missing.
    // The view already keeps active sellers only.
    fetchAllPages<MapRow>((from, to) => sb.from("v_map_sellers").select("*").order("name").order("id").range(from, to))
      .catch((e: Error) => { throw new Error(`v_map_sellers: ${e.message}`); }),
    sb.from("seller_kinds").select("kind,label,counts_as_seller,color"),
    sb.from("import_batches").select("id,filename,status,row_count,loaded_count,review_count,created_at,finished_at").order("created_at", { ascending: false }).limit(20),
    sb.from("review_items").select("id", { count: "exact", head: true }).eq("resolved", false),
    sb.from("size_bands").select("band,label,min_value,counts_toward_target,sort").order("sort"),
  ]);
  if (kindsRes.error) throw new Error(`seller_kinds: ${kindsRes.error.message}`);
  if (batchesRes.error) throw new Error(`import_batches: ${batchesRes.error.message}`);
  if (bandsRes.error) throw new Error(`size_bands: ${bandsRes.error.message}`);

  const kinds = kindsRes.data ?? [];
  const sellers = sellersRes.map((r) => withH3(toMapSeller(r, kinds)));
  return {
    sellers,
    kinds,
    batches: (batchesRes.data ?? []) as BatchSummary[],
    stats: buildStats(sellers, reviewsRes.count ?? 0),
    bands: (bandsRes.data ?? []) as BandRule[],
    generated_at: new Date().toISOString(),
  };
}

export async function getSellerDetail(id: string) {
  if (process.env.DATA_SOURCE === "fixture") {
    const fx = loadFixture();
    const s = fx.sellers.find((x) => x.id === id);
    return s ? { ...s, phone: null, note_raw: null, extra: {} } : null;
  }
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("sellers")
    .select("id,external_id,kind,name,source,opening_hours,phone,note_raw,note_address,extra,parent_external_id,created_at,updated_at,locations(address_display,locality,partido,province,postal_code,lat,lng,h3_r9,geocode_status,geocode_provider,geocode_confidence)")
    .eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** The stored cell is authoritative; if a row was geocoded outside the pipeline we derive it. */
function withH3(s: MapSeller): MapSeller {
  if (s.h3_r9 || s.lat == null || s.lng == null) return s;
  return { ...s, h3_r9: latLngToCell(s.lat, s.lng, H3_RES) };
}

function buildStats(sellers: MapSeller[], openReviews: number) {
  const located = sellers.filter((s) => s.lat != null && s.lng != null).length;
  return { total: sellers.length, located, unlocated: sellers.length - located, open_reviews: openReviews };
}

let fixtureCache: SellersResponse | null = null;
function loadFixture(): SellersResponse {
  if (fixtureCache) return fixtureCache;
  const raw = JSON.parse(readFileSync(join(process.cwd(), "data", "fixtures", "sellers.json"), "utf8")) as SellersResponse;
  raw.sellers = raw.sellers.map(withH3);
  raw.stats = buildStats(raw.sellers, raw.stats?.open_reviews ?? 0);
  raw.bands ??= DEFAULT_BANDS;
  fixtureCache = raw;
  return raw;
}
