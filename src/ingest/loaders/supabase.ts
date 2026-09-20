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

  const chunk = <T,>(arr: T[], n = 500) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

  for (const rows of chunk(result.rawRows)) {
    const { error } = await sb.from("raw_rows").upsert(rows.map((r) => ({ batch_id, ...r })), { onConflict: "batch_id,row_number", ignoreDuplicates: true });
    if (error) throw new Error(`raw_rows: ${error.message}`);
  }

  // Locations: insert new keys, only refresh coordinates on rows that are not manual and not already ok.
  const keys = result.locations.map((l) => l.address_key);
  const { data: existing, error: eErr } = await sb.from("locations").select("id,address_key,geocode_status,manual_override").in("address_key", keys);
  if (eErr) throw new Error(`locations read: ${eErr.message}`);
  const existingByKey = new Map((existing ?? []).map((e) => [e.address_key as string, e]));
  const toInsert = result.locations.filter((l) => !existingByKey.has(l.address_key));
  const toUpdate = result.locations.filter((l) => { const e = existingByKey.get(l.address_key); return e && !e.manual_override && e.geocode_status !== "ok" && l.geocode_status === "ok"; });
  for (const rows of chunk(toInsert)) {
    const { error } = await sb.from("locations").insert(rows);
    if (error) throw new Error(`locations insert: ${error.message}`);
  }
  for (const l of toUpdate) {
    const { error } = await sb.from("locations").update({ lat: l.lat, lng: l.lng, h3_r9: l.h3_r9, geocode_provider: l.geocode_provider, geocode_confidence: l.geocode_confidence, geocode_raw: l.geocode_raw, geocode_status: l.geocode_status }).eq("address_key", l.address_key);
    if (error) throw new Error(`locations update: ${error.message}`);
  }
  const { data: allLocs, error: aErr } = await sb.from("locations").select("id,address_key").in("address_key", keys);
  if (aErr) throw new Error(`locations reread: ${aErr.message}`);
  const idByKey = new Map((allLocs ?? []).map((e) => [e.address_key as string, e.id as string]));

  const sellerRows = result.sellers.map((s) => ({
    external_id: s.external_id, kind: s.kind, parent_external_id: s.parent_external_id, name: s.name,
    location_id: s.address_key ? idByKey.get(s.address_key) ?? null : null, source: s.source,
    opening_hours: s.opening_hours, phone: s.phone, note_raw: s.note_raw, note_address: s.note_address,
    extra: s.extra, row_hash: s.row_hash, first_batch_id: batch_id, last_seen_batch_id: batch_id, active: true,
  }));
  // Preserve first_batch_id for sellers we have seen before.
  const { data: seen } = await sb.from("sellers").select("external_id,first_batch_id").in("external_id", sellerRows.map((s) => s.external_id));
  const firstBatch = new Map((seen ?? []).map((s) => [s.external_id as string, s.first_batch_id as string]));
  for (const rows of chunk(sellerRows)) {
    const { error } = await sb.from("sellers").upsert(rows.map((r) => ({ ...r, first_batch_id: firstBatch.get(r.external_id) ?? batch_id })), { onConflict: "external_id" });
    if (error) throw new Error(`sellers upsert: ${error.message}`);
  }

  if (result.reviews.length) {
    const { data: sellerIds } = await sb.from("sellers").select("id,external_id").in("external_id", result.reviews.map((r) => r.external_id).filter(Boolean) as string[]);
    const sid = new Map((sellerIds ?? []).map((s) => [s.external_id as string, s.id as string]));
    const { error } = await sb.from("review_items").insert(result.reviews.map((r) => ({
      batch_id, seller_id: r.external_id ? sid.get(r.external_id) ?? null : null,
      location_id: r.address_key ? idByKey.get(r.address_key) ?? null : null, reason: r.reason, payload: r.payload,
    })));
    if (error) throw new Error(`review_items: ${error.message}`);
  }

  const { error: fErr } = await sb.from("import_batches").update({ status: "loaded", loaded_count: result.sellers.length, review_count: result.reviews.length, finished_at: new Date().toISOString() }).eq("id", batch_id);
  if (fErr) throw new Error(`batch finish: ${fErr.message}`);
  return { batch_id };
}

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}
