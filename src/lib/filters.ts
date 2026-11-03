import type { MapSeller } from "./types";
import {
  bandOf,
  isExact,
  isReference,
  volumeOf,
  type CountedBand,
} from "./opportunity";

export type FilterState = {
  sizes: CountedBand[]; // empty = any size
  flex: "all" | "si" | "si_probable";
  repMin: number; // 0 = any; 5 = verde ... 1 = rojo
  power: "any" | "silver" | "gold" | "platinum";
  precision: "all" | "exact";
  refs: boolean; // show drop-off agencies and partners as reference dots
};

export const NO_FILTERS: FilterState = {
  sizes: [],
  flex: "all",
  repMin: 0,
  power: "any",
  precision: "all",
  refs: false,
};
/** Default view: the Flex target market (design doc §3). */
export const PROSPECTO_FLEX: FilterState = {
  ...NO_FILTERS,
  sizes: ["chico", "core"],
  flex: "si_probable",
};

export const REPUTATION_OPTIONS = [
  { value: 0, label: "Cualquiera" },
  { value: 5, label: "Verde" },
  { value: 4, label: "Verde claro o mejor" },
  { value: 3, label: "Amarillo o mejor" },
  { value: 2, label: "Naranja o mejor" },
];
export const POWER_OPTIONS: { value: FilterState["power"]; label: string }[] = [
  { value: "any", label: "Cualquiera" },
  { value: "silver", label: "Silver o mejor" },
  { value: "gold", label: "Gold o mejor" },
  { value: "platinum", label: "Platinum" },
];
export const FLEX_OPTIONS: { value: FilterState["flex"]; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "si", label: "Sí" },
  { value: "si_probable", label: "Sí + probable" },
];

const POWER_RANK: Record<string, number> = { silver: 1, gold: 2, platinum: 3 };
/** "5_green" -> 5. Unknown -> 0. */
const repRank = (v: string | undefined): number =>
  v ? Number(v.split("_")[0]) || 0 : 0;

export function activeFilterCount(f: FilterState): number {
  return [
    f.sizes.length > 0,
    f.flex !== "all",
    f.repMin > 0,
    f.power !== "any",
    f.precision !== "all",
  ].filter(Boolean).length;
}

export type FilterResult = {
  kept: MapSeller[];
  references: MapSeller[];
  excluded: { noData: number; filtered: number };
};

type Verdict = "keep" | "noData" | "filtered";

function judge(s: MapSeller, f: FilterState): Verdict {
  const a = s.attrs ?? {};
  if (f.precision === "exact" && !isExact(s)) return "filtered";
  if (f.sizes.length) {
    const band = bandOf(volumeOf(s));
    if (band == null) return "noData";
    // Enterprise is kept so the cluster footnote can count it; it never adds volume.
    if (band !== "enterprise" && !f.sizes.includes(band)) return "filtered";
  }
  if (f.flex !== "all") {
    if (!a.flex_candidate) return "noData";
    const ok =
      f.flex === "si"
        ? a.flex_candidate === "si"
        : a.flex_candidate === "si" || a.flex_candidate === "probable";
    if (!ok) return "filtered";
  }
  if (f.repMin > 0) {
    if (!a.reputation) return "noData";
    if (repRank(a.reputation) < f.repMin) return "filtered";
  }
  if (f.power !== "any") {
    if (!a.power_seller) return "noData";
    if ((POWER_RANK[a.power_seller] ?? 0) < POWER_RANK[f.power])
      return "filtered";
  }
  return "keep";
}

/** Every filter applies to every seller (design doc §3). Unlocated rows never reach the map. */
export function applyFilters(
  sellers: MapSeller[],
  f: FilterState,
): FilterResult {
  const out: FilterResult = {
    kept: [],
    references: [],
    excluded: { noData: 0, filtered: 0 },
  };
  for (const s of sellers) {
    if (!s.h3_r9) continue;
    if (isReference(s)) {
      if (f.refs) out.references.push(s);
      continue;
    }
    const v = judge(s, f);
    if (v === "keep") out.kept.push(s);
    else out.excluded[v] += 1;
  }
  return out;
}
