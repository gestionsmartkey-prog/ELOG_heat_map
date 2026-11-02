import {
  DEFAULT_RADIUS_KM,
  DEFAULT_TARGET,
  RADII_KM,
  COUNTED_BANDS,
  type CountedBand,
} from "./opportunity";
import {
  NO_FILTERS,
  POWER_OPTIONS,
  FLEX_OPTIONS,
  PROSPECTO_FLEX,
  type FilterState,
} from "./filters";

export type ViewState = {
  target: number;
  radiusKm: number;
  filters: FilterState;
  center?: [number, number];
  zoom?: number;
};
export const DEFAULT_VIEW: ViewState = {
  target: DEFAULT_TARGET,
  radiusKm: DEFAULT_RADIUS_KM,
  filters: PROSPECTO_FLEX,
};

const FILTER_KEYS = ["sz", "fx", "rep", "pw", "pr", "ref"];
const sameFilters = (a: FilterState, b: FilterState) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Short query string for sharing a view; defaults are omitted. */
export function encodeView(v: ViewState): string {
  const q = new URLSearchParams();
  if (v.target !== DEFAULT_TARGET) q.set("t", String(v.target));
  if (v.radiusKm !== DEFAULT_RADIUS_KM) q.set("r", String(v.radiusKm));
  if (!sameFilters(v.filters, PROSPECTO_FLEX)) {
    const f = v.filters;
    q.set("sz", f.sizes.join(","));
    q.set("fx", f.flex);
    q.set("rep", String(f.repMin));
    q.set("pw", f.power);
    q.set("pr", f.precision);
    q.set("ref", f.refs ? "1" : "0");
  }
  if (v.center) q.set("c", v.center.map((n) => n.toFixed(4)).join(","));
  if (v.zoom != null) q.set("z", v.zoom.toFixed(2));
  return q.toString();
}

export function decodeView(query: string): ViewState {
  const q = new URLSearchParams(query);
  const t = Number(q.get("t"));
  const r = Number(q.get("r"));
  const view: ViewState = {
    target: Number.isFinite(t) && t >= 100 ? Math.round(t) : DEFAULT_TARGET,
    radiusKm: (RADII_KM as readonly number[]).includes(r)
      ? r
      : DEFAULT_RADIUS_KM,
    filters: PROSPECTO_FLEX,
  };
  if (FILTER_KEYS.some((k) => q.has(k))) {
    const rep = Number(q.get("rep"));
    view.filters = {
      sizes: (q.get("sz") ?? "")
        .split(",")
        .filter((s): s is CountedBand =>
          (COUNTED_BANDS as string[]).includes(s),
        ),
      flex:
        FLEX_OPTIONS.find((o) => o.value === q.get("fx"))?.value ??
        NO_FILTERS.flex,
      repMin: Number.isInteger(rep) && rep >= 0 && rep <= 5 ? rep : 0,
      power:
        POWER_OPTIONS.find((o) => o.value === q.get("pw"))?.value ??
        NO_FILTERS.power,
      precision: q.get("pr") === "exact" ? "exact" : "all",
      refs: q.get("ref") === "1",
    };
  }
  const c = (q.get("c") ?? "").split(",").map(Number);
  if (c.length === 2 && c.every(Number.isFinite)) view.center = [c[0], c[1]];
  const z = Number(q.get("z"));
  if (q.has("z") && Number.isFinite(z)) view.zoom = z;
  return view;
}
