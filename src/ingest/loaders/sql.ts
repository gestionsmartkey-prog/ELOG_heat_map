import type { IngestResult } from "../types";

/** SQL literal with proper escaping. */
export function lit(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return `${lit(JSON.stringify(v))}::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

const ROWS_PER_STATEMENT = 40;
function groups<T>(arr: T[], n = ROWS_PER_STATEMENT): T[][] {
  return Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
}

/**
 * Emit idempotent SQL that loads an IngestResult. Every statement addresses the
 * batch by file hash, so the output can be applied in chunks by any SQL client.
 * Used when the machine running the pipeline cannot reach the database, and as
 * a readable record of exactly what a batch did.
 */
export function toSql(result: IngestResult): string {
  const out: string[] = [];
  // A tiny helper function keeps every statement short; it is dropped at the end.
  const B = `public._ingest_batch()`;
  out.push(`create or replace function public._ingest_batch() returns uuid language sql stable as $f$ select id from public.import_batches where file_hash = ${lit(result.batch.file_hash)} order by created_at desc limit 1 $f$;`);

  out.push(`insert into public.import_batches (filename, file_hash, source, uploaded_by, status, row_count, report)
values (${lit(result.batch.filename)}, ${lit(result.batch.file_hash)}, ${lit(result.batch.source)}, ${lit(result.batch.uploaded_by)}, 'loading', ${result.rawRows.length}, ${lit(result.report)});`);

  for (const g of groups(result.rawRows)) {
    out.push(`insert into public.raw_rows (batch_id, row_number, row_hash, data) values\n${g.map((r) => `(${B}, ${r.row_number}, ${lit(r.row_hash)}, ${lit(r.data)})`).join(",\n")}\non conflict (batch_id, row_number) do nothing;`);
  }

  for (const g of groups(result.locations)) {
    out.push(`insert into public.locations (address_key, street, street_number, address_display, locality, partido, province, postal_code, lat, lng, h3_r9, geocode_provider, geocode_confidence, geocode_raw, geocode_status) values
${g.map((l) => `(${[l.address_key, l.street, l.street_number, l.address_display, l.locality, l.partido, l.province, l.postal_code, l.lat, l.lng, l.h3_r9, l.geocode_provider, l.geocode_confidence, l.geocode_raw, l.geocode_status].map(lit).join(", ")})`).join(",\n")}
on conflict (address_key) do update set
  lat = case when public.locations.manual_override or public.locations.geocode_status = 'ok' then public.locations.lat else coalesce(excluded.lat, public.locations.lat) end,
  lng = case when public.locations.manual_override or public.locations.geocode_status = 'ok' then public.locations.lng else coalesce(excluded.lng, public.locations.lng) end,
  h3_r9 = case when public.locations.manual_override or public.locations.geocode_status = 'ok' then public.locations.h3_r9 else coalesce(excluded.h3_r9, public.locations.h3_r9) end,
  geocode_status = case when public.locations.manual_override or public.locations.geocode_status = 'ok' then public.locations.geocode_status else excluded.geocode_status end,
  geocode_provider = case when public.locations.manual_override or public.locations.geocode_status = 'ok' then public.locations.geocode_provider else coalesce(excluded.geocode_provider, public.locations.geocode_provider) end,
  locality = coalesce(public.locations.locality, excluded.locality),
  partido = coalesce(public.locations.partido, excluded.partido);`);
  }

  for (const g of groups(result.sellers)) {
    out.push(`insert into public.sellers (external_id, kind, parent_external_id, name, location_id, unit, source, opening_hours, phone, note_raw, note_address, extra, row_hash, first_batch_id, last_seen_batch_id, active) values
${g.map((s) => `(${lit(s.external_id)}, ${lit(s.kind)}, ${lit(s.parent_external_id)}, ${lit(s.name)}, public._location_for_key(${lit(s.address_key)}), ${lit(s.unit)}, ${lit(s.source)}, ${lit(s.opening_hours)}, ${lit(s.phone)}, ${lit(s.note_raw)}, ${lit(s.note_address)}, ${lit(s.extra)}, ${lit(s.row_hash)}, ${B}, ${B}, true)`).join(",\n")}
on conflict (external_id) do update set
  kind = excluded.kind, parent_external_id = excluded.parent_external_id, name = excluded.name,
  location_id = case when public.sellers.location_locked then public.sellers.location_id else coalesce(excluded.location_id, public.sellers.location_id) end,
  unit = excluded.unit,
  opening_hours = coalesce(excluded.opening_hours, public.sellers.opening_hours),
  phone = coalesce(excluded.phone, public.sellers.phone),
  note_raw = excluded.note_raw,
  note_address = case when public.sellers.location_locked then null else excluded.note_address end,
  extra = public.sellers.extra || excluded.extra,
  row_hash = excluded.row_hash, last_seen_batch_id = excluded.last_seen_batch_id, active = true;`);
  }

  if (result.reviews.length) {
    // Skip reviews a person already saw (open or resolved), as the direct loader does.
    for (const g of groups(result.reviews)) {
      out.push(`insert into public.review_items (batch_id, seller_id, location_id, reason, payload)
select v.* from (values
${g.map((r) => `(${B}, (select id from public.sellers where external_id = ${lit(r.external_id)}), public._location_for_key(${lit(r.address_key)}), ${lit(r.reason)}, ${lit(r.payload)})`).join(",\n")}
) as v(batch_id, seller_id, location_id, reason, payload)
where not exists (
  select 1 from public.review_items x
  where x.reason = v.reason and x.seller_id is not distinct from v.seller_id and x.location_id is not distinct from v.location_id
    and (v.reason <> 'address_conflict' or coalesce(x.payload->>'note_address', '') = coalesce(v.payload->>'note_address', ''))
);`);
    }
  }

  out.push(`update public.import_batches set status = 'loaded', loaded_count = ${result.sellers.length}, review_count = ${result.reviews.length}, finished_at = now() where id = ${B};`);
  out.push(`drop function public._ingest_batch();`);
  return out.join("\n");
}
