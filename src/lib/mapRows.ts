import type { MapSeller, SellersResponse } from "./types";

/** One row of public.v_map_sellers. */
export type MapRow = {
  id: string;
  external_id: string;
  kind: string;
  name: string;
  source: string;
  unit: string | null;
  opening_hours: string | null;
  note_address: string | null;
  address_display: string | null;
  locality: string | null;
  partido: string | null;
  province: string | null;
  postal_code: string | null;
  lat: number | null;
  lng: number | null;
  h3_r8: string | null;
  h3_r9: string | null;
  precision: string;
  address_edited: boolean;
  shipments_month: number | null;
  flex_candidate: string | null;
  reputation: string | null;
  power_seller: string | null;
  profile_url: string | null;
};

/** The slim view keeps typed columns; the client still reads attrs/metrics, so rebuild them here. */
export function toMapSeller(
  r: MapRow,
  kinds: SellersResponse["kinds"],
): MapSeller {
  const kind = kinds.find((k) => k.kind === r.kind);
  const attrs: Record<string, string> = {};
  if (r.flex_candidate) attrs.flex_candidate = r.flex_candidate;
  if (r.reputation) attrs.reputation = r.reputation;
  if (r.power_seller) attrs.power_seller = r.power_seller;
  if (r.profile_url) attrs.profile_url = r.profile_url;
  const volume = r.shipments_month == null ? null : Number(r.shipments_month);
  return {
    id: r.id,
    external_id: r.external_id,
    kind: r.kind,
    kind_label: kind?.label ?? r.kind,
    counts_as_seller: kind?.counts_as_seller ?? true,
    name: r.name,
    source: r.source,
    opening_hours: r.opening_hours,
    note_address: r.note_address,
    location_id: null,
    address_display: r.address_display,
    locality: r.locality,
    partido: r.partido,
    province: r.province,
    postal_code: r.postal_code,
    lat: r.lat,
    lng: r.lng,
    h3_r8: r.h3_r8,
    h3_r9: r.h3_r9,
    geocode_status: null,
    unit: r.unit,
    address_edited: r.address_edited,
    precision: r.precision,
    attrs,
    metrics:
      volume == null || !Number.isFinite(volume)
        ? {}
        : { shipments_month: volume },
  };
}
