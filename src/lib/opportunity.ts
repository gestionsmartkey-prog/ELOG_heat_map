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

/** One row of public.size_bands. A band starts at min_value and runs to the next band's start. */
export type BandRule = {
  band: Band;
  label: string;
  min_value: number;
  counts_toward_target: boolean;
  sort: number;
};

export const DEFAULT_BANDS: BandRule[] = [
  {
    band: "micro",
    label: "Micro",
    min_value: 0,
    counts_toward_target: true,
    sort: 1,
  },
  {
    band: "chico",
    label: "Chico",
    min_value: 100,
    counts_toward_target: true,
    sort: 2,
  },
  {
    band: "core",
    label: "Core",
    min_value: 1000,
    counts_toward_target: true,
    sort: 3,
  },
  {
    band: "enterprise",
    label: "Enterprise",
    min_value: 5001,
    counts_toward_target: false,
    sort: 4,
  },
];

let bands: BandRule[] = DEFAULT_BANDS;

/**
 * Use the bands served by /api/sellers. Called on the main thread when data arrives and in the
 * ranking worker per request. Anything unusable falls back to the defaults.
 */
export function setBands(next: BandRule[] | undefined): void {
  const ok = (next ?? []).filter(
    (b) => b.band in BAND_LABELS && Number.isFinite(Number(b.min_value)),
  );
  bands = ok.length
    ? ok
        .map((b) => ({ ...b, min_value: Number(b.min_value) }))
        .sort((a, b) => a.min_value - b.min_value)
    : DEFAULT_BANDS;
}

export function bandOf(volume: number | null): Band | null {
  if (volume == null) return null;
  let out: Band = bands[0].band;
  for (const b of bands) if (volume >= b.min_value) out = b.band;
  return out;
}

const countsTowardTarget = (band: Band): boolean =>
  bands.find((b) => b.band === band)?.counts_toward_target ?? false;

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
  const band = bandOf(v);
  if (v == null || band == null || !countsTowardTarget(band)) return 0;
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
