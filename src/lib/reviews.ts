import { latLngToCell } from "h3-js";
import { supabaseAdmin } from "./supabase";

const H3_RES = 9;
// Generous AMBA envelope; a manual pin must still land in the metro region.
const BOUNDS = { minLat: -35.4, maxLat: -34.0, minLng: -59.5, maxLng: -57.6 };

export type ReviewItem = {
  id: number;
  reason: string;
  payload: Record<string, unknown>;
  created_at: string;
  seller: { name: string; external_id: string; kind: string } | null;
  location: {
    id: string; address_display: string | null; locality: string | null; partido: string | null;
    province: string | null; postal_code: string | null; lat: number | null; lng: number | null; geocode_status: string | null;
  } | null;
};

export async function listReviews(): Promise<ReviewItem[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("review_items")
    .select("id,reason,payload,created_at,seller:sellers(name,external_id,kind),location:locations(id,address_display,locality,partido,province,postal_code,lat,lng,geocode_status)")
    .eq("resolved", false)
    .order("reason")
    .order("created_at");
  if (error) throw new Error(`review_items: ${error.message}`);
  // PostgREST returns embeds as arrays or objects depending on cardinality; normalise to a single object.
  return (data ?? []).map((r) => {
    const rec = r as Record<string, unknown>;
    const one = <T,>(v: unknown): T | null => (Array.isArray(v) ? ((v[0] as T) ?? null) : ((v as T) ?? null));
    return { id: rec.id as number, reason: rec.reason as string, payload: (rec.payload as Record<string, unknown>) ?? {}, created_at: rec.created_at as string, seller: one(rec.seller), location: one(rec.location) } as ReviewItem;
  });
}

export type ResolveAction = "locate" | "dismiss" | "retry";
export type ResolveResult = { ok: true; action: ResolveAction; status?: string } | { ok: false; error: string; message: string };

export async function resolveReview(id: number, action: ResolveAction, body: { lat?: number; lng?: number }): Promise<ResolveResult> {
  const sb = supabaseAdmin();
  const { data: review, error: rErr } = await sb.from("review_items").select("id,reason,location_id,resolved").eq("id", id).maybeSingle();
  if (rErr) throw new Error(`review read: ${rErr.message}`);
  if (!review) return { ok: false, error: "not_found", message: "El ítem no existe." };
  const locationId = (review as { location_id: string | null }).location_id;

  if (action === "dismiss") {
    await markResolved(sb, id);
    return { ok: true, action };
  }

  if (action === "retry") {
    if (!locationId) return { ok: false, error: "no_location", message: "El ítem no tiene un domicilio para geolocalizar." };
    const { data, error } = await sb.rpc("georef_geocode_one", { p_location_id: locationId });
    if (error) return { ok: false, error: "geocode_failed", message: error.message };
    const status = data as string;
    if (status === "ok") await resolveForLocation(sb, id, locationId);
    return { ok: true, action, status };
  }

  // locate: place a manual pin
  const { lat, lng } = body;
  if (typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng)) return { ok: false, error: "bad_coords", message: "Coordenadas inválidas." };
  if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lng < BOUNDS.minLng || lng > BOUNDS.maxLng) return { ok: false, error: "out_of_bounds", message: "El punto está fuera del AMBA." };
  if (!locationId) return { ok: false, error: "no_location", message: "El ítem no tiene un domicilio para ubicar." };

  const { error: uErr } = await sb.from("locations").update({
    lat, lng, h3_r9: latLngToCell(lat, lng, H3_RES),
    geocode_status: "ok", manual_override: true, geocode_provider: "manual", geocode_confidence: 1, geocode_raw: null,
  }).eq("id", locationId);
  if (uErr) throw new Error(`location update: ${uErr.message}`);
  await resolveForLocation(sb, id, locationId);
  return { ok: true, action };
}

async function markResolved(sb: ReturnType<typeof supabaseAdmin>, id: number) {
  const { error } = await sb.from("review_items").update({ resolved: true, resolved_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(`resolve: ${error.message}`);
}

/** A fixed point settles every open review for that door, plus the current item. */
async function resolveForLocation(sb: ReturnType<typeof supabaseAdmin>, id: number, locationId: string) {
  const now = new Date().toISOString();
  const a = await sb.from("review_items").update({ resolved: true, resolved_at: now }).eq("location_id", locationId).eq("resolved", false);
  if (a.error) throw new Error(`resolve loc: ${a.error.message}`);
  await markResolved(sb, id);
}
