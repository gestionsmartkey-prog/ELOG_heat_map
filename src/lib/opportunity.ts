import type { MapSeller } from "./types";

/**
 * Hub sizing rules (design doc §Decisions). A hub is worth opening at a target
 * volume; sellers are banded by monthly packages and enterprise never counts.
 */
export type Band = "micro" | "chico" | "core" | "enterprise";
export type CountedBand = Exclude<Band, "enterprise">;

export const BAND_LABELS: Record<Band, string> = {
  micro: "Micro",
  chico: "Chico",
  core: "Core",
  enterprise: "Enterprise",
};
export const COUNTED_BANDS: CountedBand[] = ["micro", "chico", "core"];

export const DEFAULT_TARGET = 5000;
export const RADII_KM = [3, 5, 8] as const;
export const DEFAULT_RADIUS_KM = 5;

export function bandOf(volume: number | null): Band | null {
  if (volume == null) return null;
  if (volume < 100) return "micro";
  if (volume < 1000) return "chico";
  if (volume <= 5000) return "core";
  return "enterprise";
}

export const volumeOf = (s: MapSeller): number | null =>
  s.metrics?.shipments_month ?? null;

/** Drop-off agencies and partners are map references, never sales targets. */
export const isReference = (s: MapSeller): boolean =>
  s.kind === "dropoff_agency" || s.kind === "partner";

/** Located at the door. Older fixtures have no precision and are doors. */
export const isExact = (s: MapSeller): boolean =>
  (s.precision ?? "street") === "street";

export function countableVolume(s: MapSeller): number {
  if (isReference(s)) return 0;
  const v = volumeOf(s);
  if (v == null || bandOf(v) === "enterprise") return 0;
  return v;
}

export type Needed = {
  picks: MapSeller[];
  reached: number;
  enough: boolean;
  byBand: Record<CountedBand, number>;
};

/** Greedy shortest path to the target: largest countable sellers first. */
export function sellersNeeded(sellers: MapSeller[], target: number): Needed {
  const ranked = sellers
    .filter((s) => countableVolume(s) > 0)
    .sort((a, b) => countableVolume(b) - countableVolume(a));
  const picks: MapSeller[] = [];
  let reached = 0;
  for (const s of ranked) {
    if (reached >= target) break;
    picks.push(s);
    reached += countableVolume(s);
  }
  const byBand: Record<CountedBand, number> = { micro: 0, chico: 0, core: 0 };
  for (const s of picks) byBand[bandOf(volumeOf(s)) as CountedBand] += 1;
  return { picks, reached, enough: reached >= target, byBand };
}

export type ShareBin = { min: number; color: string; label: string };

/** Opportunity ramp, fixed breaks (design doc §2). Colours mirror the --color-opp-* tokens. */
export const SHARE_BINS: ShareBin[] = [
  { min: 0, color: "#FAF0E6", label: "<25%" },
  { min: 0.25, color: "#FFC48F", label: "25–50%" },
  { min: 0.5, color: "#FF9038", label: "50–75%" },
  { min: 0.75, color: "#C13E06", label: "75–100%" },
  { min: 1, color: "#6E2303", label: "100%+" },
];

export function shareBin(share: number): ShareBin {
  let bin = SHARE_BINS[0];
  for (const b of SHARE_BINS) if (share >= b.min) bin = b;
  return bin;
}

export const formatPkgs = (v: number): string =>
  Math.round(v).toLocaleString("es-AR");
export const formatShare = (share: number): string =>
  `${Math.round(share * 100)}%`;
