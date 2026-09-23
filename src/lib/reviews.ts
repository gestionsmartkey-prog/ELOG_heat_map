import { latLngToCell } from "h3-js";
import { supabaseAdmin } from "./supabase";
import {
  addressDisplay, addressKey, normalizePostalCode, normalizeProvince, normalizeStreet, normalizeStreetNumber,
  provinceFromPostalCode, titleCase,
} from "@/ingest/normalize";
import { parseNote } from "@/ingest/note";

const H3_RES = 9;
// Generous AMBA envelope; a manual pin must still land in the metro region.
const BOUNDS = { minLat: -35.4, maxLat: -34.0, minLng: -59.5, maxLng: -57.6 };

export type ReviewItem = {
  id: number;
  reason: string;
  payload: Record<string, unknown>;
  created_at: string;
  seller: { id: string; name: string; external_id: string; kind: string; unit: string | null } | null;
  location: {
    id: string; street: string | null; street_number: string | null; address_display: string | null; locality: string | null; partido: string | null;
    province: string | null; postal_code: string | null; lat: number | null; lng: number | null; geocode_status: string | null;
    address_edited: boolean;
    /** Sellers at this door: correcting the door's address changes it for all of them. */
    seller_count: number;
    sellers: DoorSeller[];
  } | null;
};

/** A seller sharing the door, so a correction or a move is never done blind. */
export type DoorSeller = { id: string; name: string; external_id: string; unit: string | null; note_address: string | null };

export async function listReviews(): Promise<ReviewItem[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("review_items")
    .select("id,reason,payload,created_at,seller:sellers(id,name,external_id,kind,unit),location:locations(id,street,street_number,address_display,locality,partido,province,postal_code,lat,lng,geocode_status,address_edited)")
    .eq("resolved", false)
    .order("reason")
    .order("created_at");
  if (error) throw new Error(`review_items: ${error.message}`);
  // PostgREST returns embeds as arrays or objects depending on cardinality; normalise to a single object.
  const items = (data ?? []).map((r) => {
    const rec = r as Record<string, unknown>;
    const one = <T,>(v: unknown): T | null => (Array.isArray(v) ? ((v[0] as T) ?? null) : ((v as T) ?? null));
    return { id: rec.id as number, reason: rec.reason as string, payload: (rec.payload as Record<string, unknown>) ?? {}, created_at: rec.created_at as string, seller: one(rec.seller), location: one(rec.location) } as ReviewItem;
  });
  const locIds = [...new Set(items.map((i) => i.location?.id).filter(Boolean) as string[])];
  const byDoor = new Map<string, DoorSeller[]>();
  const notes = new Map<string, string | null>();
  for (let i = 0; i < locIds.length; i += 200) {
    const { data: rows, error: cErr } = await sb.from("sellers").select("id,name,external_id,unit,note_address,note_raw,location_id")
      .in("location_id", locIds.slice(i, i + 200)).order("name");
    if (cErr) throw new Error(`door sellers: ${cErr.message}`);
    for (const row of (rows ?? []) as (DoorSeller & { location_id: string; note_raw: string | null })[]) {
      const { location_id, note_raw, ...seller } = row;
      notes.set(seller.id, note_raw);
      byDoor.set(location_id, [...(byDoor.get(location_id) ?? []), seller]);
    }
  }
  for (const it of items) {
    if (it.location) {
      it.location.sellers = byDoor.get(it.location.id) ?? [];
      it.location.seller_count = it.location.sellers.length;
    }
    // Conflicts loaded before the note's locality was kept: read it from the note now, so the form is prefilled.
    if (it.reason === "address_conflict" && it.seller && it.payload.note_locality === undefined) {
      const a = parseNote(notes.get(it.seller.id) ?? null).address;
      if (a) it.payload = { ...it.payload, note_locality: a.locality, note_province: a.province };
    }
  }
  return items;
}

/** What a person types in the correction form. */
export type AddressInput = { street?: unknown; number?: unknown; locality?: unknown; province?: unknown; postal_code?: unknown };

export type NormalizedAddress = {
  street: string; number: string | null; display: string; locality: string | null;
  province: string | null; postal_code: string | null; key: string;
};

/**
 * Same normalization the importer uses, so a corrected address gets the key a future file
 * with that spelling would get, and the two land on the same door.
 */
export function normalizeAddressInput(input: AddressInput): NormalizedAddress | null {
  const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() || null : null);
  const street = normalizeStreet(text(input.street));
  if (!street) return null;
  const number = normalizeStreetNumber(text(input.number));
  const postal = normalizePostalCode(text(input.postal_code));
  const locality = text(input.locality) ? titleCase(text(input.locality) as string) : null;
  const province = provinceFromPostalCode(postal) ?? normalizeProvince(text(input.province));
  const key = addressKey(street, number, postal, locality);
  if (!key) return null;
  return { street, number, display: addressDisplay(street, number), locality, province, postal_code: postal, key };
}

export type LookupResult = { lat: number; lng: number; confidence: number; partido: string | null; match: string | null };

/** Georef lookup for the "Buscar" button: never writes. */
export async function lookupAddress(a: NormalizedAddress): Promise<LookupResult | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("georef_lookup", { p_street: a.street, p_number: a.number, p_locality: a.locality, p_province: a.province });
  if (error) throw new Error(`georef_lookup: ${error.message}`);
  return (data as LookupResult | null) ?? null;
}

export type ResolveAction = "locate" | "dismiss" | "retry" | "correct" | "move_seller";
export type ResolveResult = { ok: true; action: ResolveAction; status?: string; location_id?: string; moved?: number } | { ok: false; error: string; message: string };
/** seller_ids: for move_seller, the sellers of this door to move together (defaults to the item's seller). */
export type ResolveBody = { lat?: number; lng?: number; address?: AddressInput; provider?: string; seller_ids?: unknown };

export async function resolveReview(id: number, action: ResolveAction, body: ResolveBody, by: string): Promise<ResolveResult> {
  const sb = supabaseAdmin();
  const { data: review, error: rErr } = await sb.from("review_items").select("id,reason,location_id,seller_id,resolved").eq("id", id).maybeSingle();
  if (rErr) throw new Error(`review read: ${rErr.message}`);
  if (!review) return { ok: false, error: "not_found", message: "El ítem no existe." };
  const { reason, location_id: locationId, seller_id: sellerId } = review as { reason: string; location_id: string | null; seller_id: string | null };

  if (action === "dismiss") {
    await markResolved(sb, id, reason === "address_conflict" ? "kept_registered" : "dismissed", by);
    return { ok: true, action };
  }

  if (action === "retry") {
    if (!locationId) return { ok: false, error: "no_location", message: "El ítem no tiene un domicilio para geolocalizar." };
    const { data, error } = await sb.rpc("georef_geocode_one", { p_location_id: locationId });
    if (error) return { ok: false, error: "geocode_failed", message: error.message };
    const status = data as string;
    if (status === "ok") await resolveForLocation(sb, id, locationId, "auto", by);
    return { ok: true, action, status };
  }

  // Every remaining action places the door on the map, so it needs a pin inside AMBA.
  const { lat, lng } = body;
  if (typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng)) return { ok: false, error: "bad_coords", message: "Coordenadas inválidas." };
  if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lng < BOUNDS.minLng || lng > BOUNDS.maxLng) return { ok: false, error: "out_of_bounds", message: "El punto está fuera del AMBA." };
  const h3 = latLngToCell(lat, lng, H3_RES);

  if (action === "correct" || action === "move_seller") {
    const a = normalizeAddressInput(body.address ?? {});
    if (!a) return { ok: false, error: "bad_address", message: "Falta la calle." };
    const provider = body.provider === "georef" ? "georef" : "manual";
    const args = {
      p_address_key: a.key, p_street: a.street, p_number: a.number, p_display: a.display, p_locality: a.locality,
      p_partido: null, p_province: a.province, p_postal: a.postal_code, p_lat: lat, p_lng: lng, p_h3: h3,
      p_provider: provider, p_by: by, p_review_id: id,
    };
    if (action === "correct") {
      if (!locationId) return { ok: false, error: "no_location", message: "El ítem no tiene un domicilio para corregir." };
      const { data, error } = await sb.rpc("correct_location", { p_location_id: locationId, ...args });
      if (error) throw new Error(`correct_location: ${error.message}`);
      return { ok: true, action, location_id: data as string };
    }
    if (!sellerId) return { ok: false, error: "no_seller", message: "El ítem no está asociado a un seller." };
    const requested = Array.isArray(body.seller_ids) ? body.seller_ids.filter((v): v is string => typeof v === "string") : [];
    const ids = [...new Set([sellerId, ...requested])];
    if (ids.length > 1) {
      // Only sellers of this item's own door can ride along.
      const { data: same, error: sErr } = await sb.from("sellers").select("id").in("id", ids).eq("location_id", locationId ?? "");
      if (sErr) throw new Error(`move check: ${sErr.message}`);
      if ((same ?? []).length !== ids.length) return { ok: false, error: "bad_sellers", message: "Algún seller elegido no está en este domicilio." };
    }
    let target: string | null = null;
    for (const sid of ids) {
      const { data, error } = await sb.rpc("move_seller", { p_seller_id: sid, ...args, p_review_id: sid === sellerId ? id : null });
      if (error) throw new Error(`move_seller: ${error.message}`);
      target = data as string;
    }
    return { ok: true, action, location_id: target ?? undefined, moved: ids.length };
  }

  // locate: place a manual pin, address text unchanged
  if (!locationId) return { ok: false, error: "no_location", message: "El ítem no tiene un domicilio para ubicar." };
  const { error: uErr } = await sb.from("locations").update({
    lat, lng, h3_r9: h3,
    geocode_status: "ok", manual_override: true, geocode_provider: "manual", geocode_confidence: 1, geocode_raw: null,
    edited_by: by, edited_at: new Date().toISOString(),
  }).eq("id", locationId);
  if (uErr) throw new Error(`location update: ${uErr.message}`);
  await resolveForLocation(sb, id, locationId, "located", by);
  return { ok: true, action };
}

async function markResolved(sb: ReturnType<typeof supabaseAdmin>, id: number, resolution: string, by: string) {
  const { error } = await sb.from("review_items").update({ resolved: true, resolved_at: new Date().toISOString(), resolution, resolved_by: by }).eq("id", id);
  if (error) throw new Error(`resolve: ${error.message}`);
}

/** A fixed point settles the door's own open reviews (not a seller's address conflict), plus the current item. */
async function resolveForLocation(sb: ReturnType<typeof supabaseAdmin>, id: number, locationId: string, resolution: string, by: string) {
  const a = await sb.from("review_items").update({ resolved: true, resolved_at: new Date().toISOString(), resolution, resolved_by: by })
    .eq("location_id", locationId).eq("resolved", false).in("reason", ["geocode_failed", "outside_region"]);
  if (a.error) throw new Error(`resolve loc: ${a.error.message}`);
  await markResolved(sb, id, resolution, by);
}
