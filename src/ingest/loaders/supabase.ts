import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IngestResult } from "../types";

/**
 * Direct loader used by the CLI on a machine with database access, and later by
 * the upload route. Mirrors the SQL loader's semantics exactly.
 */
export async function loadToSupabase(result: IngestResult, client?: SupabaseClient): Promise<{ batch_id: string }> {
  const sb = client ?? createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SECRET_KEY"), { auth: { persistSession: false } });

  const { data: batch, error: bErr } = await sb.from("import_batches").insert({
    filename: result.batch.filename, file_hash: result.batch.file_hash, source: result.batch.source,
    uploaded_by: result.batch.uploaded_by, status: "loading", row_count: result.rawRows.length, report: result.report,
  }).select("id").single();
  if (bErr || !batch) throw new Error(`batch insert failed: ${bErr?.message}`);
  const batch_id = batch.id as string;
  try {
    return await loadBatch(sb, result, batch_id);
  } catch (e) {
    await sb.from("import_batches").update({ status: "failed", finished_at: new Date().toISOString(), report: { ...result.report, error: String(e) } }).eq("id", batch_id);
    throw e;
  }
}

async function loadBatch(sb: SupabaseClient, result: IngestResult, batch_id: string): Promise<{ batch_id: string }> {

  const chunk = <T,>(arr: T[], n = 500) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  // PostgREST puts `in (...)` filters in the query string; keep each read well under URL limits.
  const readIn = async <T,>(table: string, columns: string, column: string, values: string[]): Promise<T[]> => {
    const out: T[] = [];
    for (const vs of chunk(values, 200)) {
      const { data, error } = await sb.from(table).select(columns).in(column, vs);
      if (error) throw new Error(`${table} read: ${error.message}`);
      out.push(...((data ?? []) as T[]));
    }
    return out;
  };

  for (const rows of chunk(result.rawRows)) {
    const { error } = await sb.from("raw_rows").upsert(rows.map((r) => ({ batch_id, ...r })), { onConflict: "batch_id,row_number", ignoreDuplicates: true });
    if (error) throw new Error(`raw_rows: ${error.message}`);
  }

  // Locations: insert new keys, only refresh coordinates on rows that are not manual and not already ok.
  // A key that was corrected in the web lives on as an alias of the corrected door: it maps there.
  const keys = result.locations.map((l) => l.address_key);
  const aliases = await readIn<{ address_key: string; location_id: string }>("location_aliases", "address_key,location_id", "address_key", keys);
  const aliasByKey = new Map(aliases.map((a) => [a.address_key, a.location_id]));
  const existing = await readIn<{ id: string; address_key: string; geocode_status: string; manual_override: boolean }>("locations", "id,address_key,geocode_status,manual_override", "address_key", keys);
  const existingByKey = new Map(existing.map((e) => [e.address_key, e]));
  const toInsert = result.locations.filter((l) => !existingByKey.has(l.address_key) && !aliasByKey.has(l.address_key));
  const toUpdate = result.locations.filter((l) => { const e = existingByKey.get(l.address_key); return e && !e.manual_override && e.geocode_status !== "ok" && l.geocode_status === "ok"; });
  for (const rows of chunk(toInsert)) {
    const { error } = await sb.from("locations").insert(rows);
    if (error) throw new Error(`locations insert: ${error.message}`);
  }
  for (const l of toUpdate) {
    const { error } = await sb.from("locations").update({ lat: l.lat, lng: l.lng, h3_r9: l.h3_r9, geocode_provider: l.geocode_provider, geocode_confidence: l.geocode_confidence, geocode_raw: l.geocode_raw, geocode_status: l.geocode_status }).eq("address_key", l.address_key);
    if (error) throw new Error(`locations update: ${error.message}`);
  }
  const allLocs = await readIn<{ id: string; address_key: string }>("locations", "id,address_key", "address_key", keys);
  const idByKey = new Map([...aliasByKey, ...allLocs.map((e) => [e.address_key, e.id] as [string, string])]);

  const sellerRows = result.sellers.map((s) => ({
    external_id: s.external_id, kind: s.kind, parent_external_id: s.parent_external_id, name: s.name,
    location_id: s.address_key ? idByKey.get(s.address_key) ?? null : null, unit: s.unit, source: s.source,
    opening_hours: s.opening_hours, phone: s.phone, note_raw: s.note_raw, note_address: s.note_address,
    extra: s.extra, row_hash: s.row_hash, first_batch_id: batch_id, last_seen_batch_id: batch_id, active: true,
  }));
  // Preserve first_batch_id for sellers we have seen before, and keep a seller moved by hand where it was put.
  const seen = await readIn<{ external_id: string; first_batch_id: string; location_id: string | null; location_locked: boolean }>("sellers", "external_id,first_batch_id,location_id,location_locked", "external_id", sellerRows.map((s) => s.external_id));
  const prior = new Map(seen.map((s) => [s.external_id, s]));
  for (const rows of chunk(sellerRows)) {
    const { error } = await sb.from("sellers").upsert(rows.map((r) => {
      const p = prior.get(r.external_id);
      const locked = p?.location_locked ? { location_id: p.location_id, note_address: null } : {};
      return { ...r, ...locked, first_batch_id: p?.first_batch_id ?? batch_id };
    }), { onConflict: "external_id" });
    if (error) throw new Error(`sellers upsert: ${error.message}`);
  }

  let reviewCount = 0;
  if (result.reviews.length) {
    const sellerIds = await readIn<{ id: string; external_id: string }>("sellers", "id,external_id", "external_id", result.reviews.map((r) => r.external_id).filter(Boolean) as string[]);
    const sid = new Map(sellerIds.map((s) => [s.external_id, s.id]));
    const candidates = result.reviews.map((r) => ({
      batch_id, seller_id: r.external_id ? sid.get(r.external_id) ?? null : null,
      location_id: r.address_key ? idByKey.get(r.address_key) ?? null : null, reason: r.reason, payload: r.payload,
    }));
    // A file uploaded again must not reopen what a person already decided: skip a review that
    // already exists, open or resolved, for the same seller, door and reason (and, for a conflict,
    // the same alternate address).
    const known = new Set<string>();
    const reviewKey = (r: { seller_id: string | null; location_id: string | null; reason: string; payload: unknown }) =>
      `${r.reason}|${r.seller_id ?? ""}|${r.location_id ?? ""}|${r.reason === "address_conflict" ? String((r.payload as Record<string, unknown> | null)?.note_address ?? "") : ""}`;
    const sellerIdList = [...new Set(candidates.map((c) => c.seller_id).filter(Boolean) as string[])];
    const locIdList = [...new Set(candidates.map((c) => c.location_id).filter(Boolean) as string[])];
    for (const [col, ids] of [["seller_id", sellerIdList], ["location_id", locIdList]] as const) {
      if (!ids.length) continue;
      for (const vs of chunk(ids, 200)) {
        const { data, error } = await sb.from("review_items").select("seller_id,location_id,reason,payload").in(col, vs);
        if (error) throw new Error(`review_items read: ${error.message}`);
        for (const r of data ?? []) known.add(reviewKey(r as { seller_id: string | null; location_id: string | null; reason: string; payload: unknown }));
      }
    }
    const fresh = candidates.filter((c) => {
      const k = reviewKey(c);
      if (known.has(k)) return false;
      known.add(k); // the same file can also raise one twice
      return true;
    });
    reviewCount = fresh.length;
    for (const rows of chunk(fresh)) {
      const { error } = await sb.from("review_items").insert(rows);
      if (error) throw new Error(`review_items: ${error.message}`);
    }
  }

  const { error: fErr } = await sb.from("import_batches").update({ status: "loaded", loaded_count: result.sellers.length, review_count: reviewCount, finished_at: new Date().toISOString() }).eq("id", batch_id);
  if (fErr) throw new Error(`batch finish: ${fErr.message}`);
  return { batch_id };
}

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}
