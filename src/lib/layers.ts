import type { MapSeller } from "./types";

/**
 * Sources that are a prospecting universe (public profiles), not sellers already on the network.
 * They get their own layer and stay off the map until someone turns them on, so they never inflate a count.
 */
export const PROSPECT_SOURCES = ["ml_publico"];

export const SOURCE_LABELS: Record<string, string> = {
  meli: "Mercado Libre",
  ml_publico: "Perfiles públicos ML",
  otro: "Otro",
};

export const sourceLabel = (source: string): string => SOURCE_LABELS[source] ?? source;

/** Located by the centre of an area, not by a door. These render on their own layer. */
export const isApproximate = (s: MapSeller): boolean => (s.precision ?? "street") !== "street";

/** The filterable attributes of prospect files, in the order the top bar shows them. */
export const ATTR_FILTERS: { key: string; label: string; options: { value: string; label: string }[] }[] = [
  { key: "flex_candidate", label: "Candidato Flex", options: [{ value: "si", label: "Sí" }, { value: "probable", label: "Probable" }] },
  { key: "reputation", label: "Reputación", options: [
    { value: "5_green", label: "Verde" }, { value: "4_light_green", label: "Verde claro" }, { value: "3_yellow", label: "Amarillo" },
    { value: "2_orange", label: "Naranja" }, { value: "1_red", label: "Rojo" },
  ] },
  { key: "power_seller", label: "Power seller", options: [{ value: "platinum", label: "Platinum" }, { value: "gold", label: "Gold" }, { value: "silver", label: "Silver" }] },
];

/** Active filters: attribute key → allowed values. An empty set means "no filter on this attribute". */
export type AttrSelection = Record<string, Set<string>>;

export function matchesAttrs(s: MapSeller, sel: AttrSelection): boolean {
  for (const [key, allowed] of Object.entries(sel)) {
    if (!allowed.size) continue;
    const v = s.attrs?.[key];
    if (!v || !allowed.has(v)) return false;
  }
  return true;
}
