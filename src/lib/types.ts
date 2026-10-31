/** Compact seller record served to the map. No phone, no raw note. */
export type MapSeller = {
  id: string;
  external_id: string;
  kind: string;
  kind_label: string;
  counts_as_seller: boolean;
  name: string;
  source: string;
  opening_hours: string | null;
  note_address: string | null;
  location_id: string | null;
  address_display: string | null;
  locality: string | null;
  partido: string | null;
  province: string | null;
  postal_code: string | null;
  lat: number | null;
  lng: number | null;
  h3_r9: string | null;
  geocode_status: string | null;
  /** Piso / depto inside a shared door. Absent in older fixtures. */
  unit?: string | null;
  /** The door's address was corrected by hand in the review screen. */
  address_edited?: boolean;
  /** street = an exact door; anything else is the centre of an area. Absent in older fixtures (= street). */
  precision?: string;
  /** Filterable attributes from the source file (flex_candidate, reputation, power_seller, ...). */
  attrs?: Record<string, string>;
  /** Latest value of each metric (shipments_month, ...). */
  metrics?: Record<string, number>;
};

export type BatchSummary = {
  id: string;
  filename: string;
  status: string;
  row_count: number;
  loaded_count: number;
  review_count: number;
  created_at: string;
  finished_at: string | null;
};

export type SellersResponse = {
  sellers: MapSeller[];
  kinds: { kind: string; label: string; counts_as_seller: boolean; color: string | null }[];
  batches: BatchSummary[];
  stats: { total: number; located: number; unlocated: number; open_reviews: number };
  generated_at: string;
  /** Username from the session cookie; set by the API route, absent in fixtures. */
  viewer?: string | null;
  /** Role from the session cookie: "admin" unlocks the whitelist screen. */
  viewer_role?: string | null;
};
