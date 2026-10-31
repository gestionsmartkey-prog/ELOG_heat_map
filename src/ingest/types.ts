/**
 * Ingest pipeline types. This package has no Next.js dependency so it can run
 * from a CLI today and from an upload route later without changes.
 */

export type RawRow = Record<string, unknown>;

/** Canonical field names every source file is mapped onto. */
export type MappedRow = {
  external_id: string | null;
  name: string | null;
  company: string | null;
  street: string | null;
  street_number: string | null;
  locality: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  /** Piso / depto / oficina inside the door. Several columns may feed it. */
  unit: string | null;
  note: string | null;
  lat: number | null;
  lng: number | null;
  /** How precise lat/lng are in the source: localidad | partido | ciudad | municipio | provincia. */
  precision: string | null;
  /** Centre-of-locality postal code. Never the seller's own, so it never feeds postal_code or the address key. */
  reference_postal_code: string | null;
  flex_coverage: string | null;
  flex_candidate: string | null;
  /** Estimated shipments per month. Lands in seller_metrics. */
  shipments_month: number | null;
  trend: string | null;
  reputation: string | null;
  power_seller: string | null;
  zone: string | null;
  profile_url: string | null;
  official_store: string | null;
  categories: string | null;
  /** Source columns that matched no alias. Kept so nothing is lost. */
  extra: Record<string, unknown>;
};

export type SellerKind = "seller" | "dropoff_agency" | "partner" | "unknown";

/** street = an exact door; the rest are centres of an area (a file with no street column). */
export type LocationPrecision = "street" | "locality" | "partido" | "ciudad";

export type LocationRecord = {
  address_key: string;
  precision: LocationPrecision;
  street: string | null;
  street_number: string | null;
  address_display: string;
  locality: string | null;
  partido: string | null;
  province: string | null;
  postal_code: string | null;
  lat: number | null;
  lng: number | null;
  h3_r9: string | null;
  geocode_provider: string | null;
  geocode_confidence: number | null;
  geocode_raw: unknown | null;
  geocode_status: "pending" | "ok" | "failed" | "review";
};

export type SellerRecord = {
  external_id: string;
  kind: SellerKind;
  parent_external_id: string | null;
  name: string;
  address_key: string | null;
  /** Piso / depto / PB inside a shared door: two sellers in one building stay apart by it. */
  unit: string | null;
  source: string;
  opening_hours: string | null;
  phone: string | null;
  note_raw: string | null;
  note_address: string | null;
  /** Categorical attributes the map filters on (flex_candidate, reputation, power_seller, ...). */
  attrs: Record<string, string>;
  extra: Record<string, unknown>;
  row_hash: string;
  row_number: number;
};

export type ReviewRecord = {
  external_id: string | null;
  address_key: string | null;
  reason:
    | "geocode_failed"
    | "address_conflict"
    | "outside_region"
    | "missing_address"
    | "missing_id"
    | "duplicate_id"
    | "approximate_location";
  payload: Record<string, unknown>;
};

/** One number about one seller for one period; written to seller_metrics. */
export type MetricRecord = {
  external_id: string;
  metric: string;
  /** Snapshot date. Never null: a null period would not collide on re-import and would duplicate. */
  period: string;
  value: number;
};

export type BatchMeta = {
  filename: string;
  file_hash: string | null;
  source: string;
  uploaded_by: string | null;
};

export type IngestResult = {
  batch: BatchMeta;
  rawRows: { row_number: number; row_hash: string; data: RawRow }[];
  locations: LocationRecord[];
  sellers: SellerRecord[];
  reviews: ReviewRecord[];
  metrics: MetricRecord[];
  report: IngestReport;
};

export type IngestReport = {
  row_count: number;
  seller_count: number;
  location_count: number;
  review_count: number;
  by_kind: Record<string, number>;
  by_province: Record<string, number>;
  /** Locations by precision (street vs approximate), after dedupe. */
  by_precision?: Record<string, number>;
  geocoded: number;
  geocode_failed: number;
  /** Rows that repeated a seller already in the file with identical data. */
  duplicates_skipped: number;
  /** Rows without a seller id, identified by name + door + unit instead. */
  derived_ids: number;
  unmapped_columns: string[];
  warnings: string[];
};
