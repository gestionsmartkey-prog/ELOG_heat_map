import { createHash } from "node:crypto";
import { latLngToCell } from "h3-js";
import { mapRow } from "./headers";
import { classifySeller } from "./classify";
import { parseNote, noteConflictsWithAddress } from "./note";
import { rowHash } from "./parse";
import {
  addressDisplay, addressKey, foldKey, nfc, normalizePostalCode, normalizeProvince, normalizeStreet,
  normalizeStreetNumber, normalizeUnit, provinceFromPostalCode, titleCase,
} from "./normalize";
import type { ChainGeocoder } from "./geocode";
import { insideAmba } from "./geocode";
import type { BatchMeta, IngestReport, IngestResult, LocationRecord, RawRow, ReviewRecord, SellerRecord } from "./types";

export const H3_STORE_RES = 9;

/**
 * What makes two rows the same seller when ids cannot tell: name, door and unit. Two
 * sellers in one building (different floor or different name) never share a fingerprint.
 */
export function sellerFingerprint(name: string | null, addressKey: string | null, unit: string | null): string {
  return [foldKey(name ?? ""), addressKey ?? "", foldKey(unit ?? "")].join("#");
}

/** Stable id for a row that came without one, so the next file updates it instead of duplicating it. */
export function derivedSellerId(fingerprint: string): string {
  return `sin-id-${createHash("sha1").update(fingerprint).digest("hex").slice(0, 12)}`;
}

export type PipelineOptions = {
  batch: BatchMeta;
  geocoder?: ChainGeocoder | null;
  /** Called after each geocode so a CLI can show progress. */
  onProgress?: (done: number, total: number) => void;
};

/**
 * Pure transformation: raw rows in, clean records out. No database access here.
 * Geocoding is the only network step and is injected so it can be skipped
 * (deferred to the database) or swapped per provider.
 */
export async function runPipeline(rawRows: RawRow[], opts: PipelineOptions): Promise<IngestResult> {
  const warnings: string[] = [];
  const unmappedSet = new Set<string>();
  const locations = new Map<string, LocationRecord>();
  const sellers: SellerRecord[] = [];
  const reviews: ReviewRecord[] = [];
  const seenIds = new Map<string, { fingerprint: string; row_number: number; name: string | null; address: string; unit: string | null }>();
  const seenFingerprints = new Set<string>();
  let duplicatesSkipped = 0;
  let derivedIds = 0;
  const byKind: Record<string, number> = {};
  const byProvince: Record<string, number> = {};

  const raw = rawRows.map((data, i) => ({ row_number: i + 1, row_hash: rowHash(data), data }));

  for (const r of raw) {
    const { row, unmapped } = mapRow(r.data);
    unmapped.forEach((u) => unmappedSet.add(u));

    const name = row.name ? nfc(row.name) : null;
    const street = normalizeStreet(row.street);
    const number = normalizeStreetNumber(row.street_number);
    const postal = normalizePostalCode(row.postal_code);
    // In CABA the "barrio" column is the locality; in GBA it is usually the localidad and "ciudad" the partido.
    const locality = row.locality ? titleCase(row.locality) : row.city ? titleCase(row.city) : null;
    const note = parseNote(row.note);
    const key = addressKey(street, number, postal, locality);
    const unit = normalizeUnit(row.unit) ?? note.unit;
    const fingerprint = sellerFingerprint(name, key, unit);

    let external_id = row.external_id ? nfc(row.external_id) : null;
    const seen = external_id ? seenIds.get(external_id) : undefined;
    if (external_id && seen) {
      // Same id twice: identical data is a repeated row; different data needs a person to decide.
      if (seen.fingerprint === fingerprint) { duplicatesSkipped++; continue; }
      reviews.push({ external_id, address_key: null, reason: "duplicate_id", payload: {
        row_number: r.row_number, name, address: addressDisplay(street, number), unit,
        first_row: seen.row_number, first_name: seen.name, first_address: seen.address, first_unit: seen.unit,
      } });
      continue;
    }
    if (!external_id) {
      if (!name && !key) {
        reviews.push({ external_id: null, address_key: null, reason: "missing_id", payload: { row_number: r.row_number, name, street: row.street, note: row.note } });
        continue;
      }
      // No id: the seller is who they are by name + door + unit. The same trio again is the same seller.
      if (seenFingerprints.has(fingerprint)) { duplicatesSkipped++; continue; }
      external_id = derivedSellerId(fingerprint);
      derivedIds++;
    }
    seenIds.set(external_id, { fingerprint, row_number: r.row_number, name, address: addressDisplay(street, number), unit });
    seenFingerprints.add(fingerprint);

    const { kind, parent } = classifySeller(external_id.startsWith("sin-id-") ? null : external_id, name);
    byKind[kind] = (byKind[kind] ?? 0) + 1;

    let province = normalizeProvince(row.province);
    const cpProvince = provinceFromPostalCode(postal);
    if (cpProvince && province !== cpProvince) {
      if (province) warnings.push(`row ${r.row_number}: province "${province}" disagrees with postal code ${postal}; using postal code`);
      province = cpProvince;
    }
    const partido = row.city && row.locality && row.city.toLowerCase() !== row.locality.toLowerCase() && !/^caba$|capital/i.test(row.city) ? titleCase(row.city) : null;
    byProvince[province ?? "unknown"] = (byProvince[province ?? "unknown"] ?? 0) + 1;

    if (!key) {
      reviews.push({ external_id, address_key: null, reason: "missing_address", payload: { row_number: r.row_number, street: row.street, note: row.note } });
    } else if (!locations.has(key)) {
      const hasCoords = row.lat != null && row.lng != null;
      locations.set(key, {
        address_key: key,
        street,
        street_number: number,
        address_display: addressDisplay(street, number),
        locality,
        partido,
        province,
        postal_code: postal,
        lat: hasCoords ? row.lat : null,
        lng: hasCoords ? row.lng : null,
        h3_r9: hasCoords ? latLngToCell(row.lat as number, row.lng as number, H3_STORE_RES) : null,
        geocode_provider: hasCoords ? "source" : null,
        geocode_confidence: hasCoords ? 1 : null,
        geocode_raw: null,
        geocode_status: hasCoords ? "ok" : "pending",
      });
    }

    const conflict = noteConflictsWithAddress(note.address, street, number, postal);
    if (conflict && key) {
      reviews.push({ external_id, address_key: key, reason: "address_conflict", payload: { structured: addressDisplay(street, number), postal, note_address: note.address?.display, note_postal: note.address?.postal_code, note_locality: note.address?.locality, note_province: note.address?.province } });
    }

    sellers.push({
      external_id,
      kind,
      parent_external_id: parent,
      name: name ?? external_id,
      address_key: key,
      unit,
      source: opts.batch.source,
      opening_hours: note.opening_hours,
      phone: note.phone,
      note_raw: row.note,
      note_address: conflict ? note.address?.display ?? null : null,
      extra: { ...row.extra, ...(row.company ? { company: row.company } : {}) },
      row_hash: r.row_hash,
      row_number: r.row_number,
    });
  }

  // Geocode pending locations (optional; can be deferred to the database).
  let geocoded = 0;
  let failed = 0;
  if (opts.geocoder) {
    const pending = [...locations.values()].filter((l) => l.geocode_status === "pending" && l.street);
    let done = 0;
    for (const loc of pending) {
      const res = await opts.geocoder.geocode(loc.address_key, {
        street: loc.street as string, number: loc.street_number, locality: loc.locality, province: loc.province, postal_code: loc.postal_code,
      });
      done++;
      opts.onProgress?.(done, pending.length);
      if (!res) {
        failed++;
        loc.geocode_status = "failed";
        reviews.push({ external_id: null, address_key: loc.address_key, reason: "geocode_failed", payload: { address: loc.address_display, locality: loc.locality, postal: loc.postal_code } });
        continue;
      }
      loc.lat = res.lat; loc.lng = res.lng;
      loc.h3_r9 = latLngToCell(res.lat, res.lng, H3_STORE_RES);
      loc.geocode_provider = res.provider;
      loc.geocode_confidence = res.confidence;
      loc.geocode_raw = res.raw;
      if (!loc.partido && res.partido) loc.partido = res.partido;
      if (!insideAmba(res.lat, res.lng)) {
        loc.geocode_status = "review";
        reviews.push({ external_id: null, address_key: loc.address_key, reason: "outside_region", payload: { address: loc.address_display, lat: res.lat, lng: res.lng } });
      } else {
        loc.geocode_status = "ok";
        geocoded++;
      }
    }
  }

  const report: IngestReport = {
    row_count: raw.length,
    seller_count: sellers.length,
    location_count: locations.size,
    review_count: reviews.length,
    by_kind: byKind,
    by_province: byProvince,
    geocoded,
    geocode_failed: failed,
    duplicates_skipped: duplicatesSkipped,
    derived_ids: derivedIds,
    unmapped_columns: [...unmappedSet],
    warnings,
  };

  return { batch: opts.batch, rawRows: raw, locations: [...locations.values()], sellers, reviews, report };
}
