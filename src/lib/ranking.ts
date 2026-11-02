import {
  cellToLatLng,
  cellToParent,
  getHexagonEdgeLengthAvg,
  gridDisk,
} from "h3-js";
import type { MapSeller } from "./types";
import {
  bandOf,
  countableVolume,
  isExact,
  sellersNeeded,
  volumeOf,
  type Needed,
} from "./opportunity";

/** Hubs are placed on res-8 cells (about 0.9 km across). */
export const HUB_RES = 8;
const SPACING_KM = getHexagonEdgeLengthAvg(HUB_RES, "km") * Math.sqrt(3);

/** Rings of res-8 hexes that approximate a pickup radius: 3 km -> 3, 5 km -> 5, 8 km -> 9. */
export const radiusToK = (km: number): number =>
  Math.max(1, Math.round(km / SPACING_KM));

export type CellBucket = {
  volume: number;
  exact: number;
  sellers: MapSeller[];
};

export function bucketByCell(sellers: MapSeller[]): Map<string, CellBucket> {
  const out = new Map<string, CellBucket>();
  for (const s of sellers) {
    if (!s.h3_r9) continue;
    const cell = cellToParent(s.h3_r9, HUB_RES);
    const b = out.get(cell) ?? { volume: 0, exact: 0, sellers: [] };
    const v = countableVolume(s);
    b.volume += v;
    if (isExact(s)) b.exact += v;
    b.sellers.push(s);
    out.set(cell, b);
  }
  return out;
}

export type Cluster = {
  cell: string;
  lat: number;
  lng: number;
  name: string;
  volume: number;
  exactVolume: number;
  share: number;
  approxShare: number;
  /** Every seller in the radius except enterprise, by volume (no volume last). */
  sellers: MapSeller[];
  enterprise: number;
  noVolume: number;
  needed: Needed;
};

function topLocality(sellers: MapSeller[]): string {
  const byName = new Map<string, number>();
  for (const s of sellers) {
    const n = s.locality ?? s.partido;
    if (n) byName.set(n, (byName.get(n) ?? 0) + countableVolume(s));
  }
  return (
    [...byName.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    "Zona sin nombre"
  );
}

/** The catchment of a hub at `cell`: what a hub there would collect. */
export function buildCluster(
  cell: string,
  disk: string[],
  buckets: Map<string, CellBucket>,
  target: number,
): Cluster {
  const all: MapSeller[] = [];
  let volume = 0,
    exactVolume = 0;
  for (const c of disk) {
    const b = buckets.get(c);
    if (!b) continue;
    all.push(...b.sellers);
    volume += b.volume;
    exactVolume += b.exact;
  }
  const enterprise = all.filter(
    (s) => bandOf(volumeOf(s)) === "enterprise",
  ).length;
  const sellers = all
    .filter((s) => bandOf(volumeOf(s)) !== "enterprise")
    .sort((a, b) => (volumeOf(b) ?? -1) - (volumeOf(a) ?? -1));
  const [lat, lng] = cellToLatLng(cell);
  return {
    cell,
    lat,
    lng,
    name: topLocality(sellers),
    volume,
    exactVolume,
    share: volume / target,
    approxShare: volume ? (volume - exactVolume) / volume : 0,
    sellers,
    enterprise,
    noVolume: sellers.filter((s) => volumeOf(s) == null).length,
    needed: sellersNeeded(sellers, target),
  };
}

export function clusterAt(
  cell: string,
  buckets: Map<string, CellBucket>,
  k: number,
  target: number,
): Cluster {
  return buildCluster(cell, gridDisk(cell, k), buckets, target);
}

export type Pick = Cluster & { rank: number };
export type Ranking = {
  picks: Pick[];
  /** Countable volume reachable from each res-8 cell before any claiming: the heat surface. */
  scores: Map<string, number>;
  /** seller id -> rank of the pick that claimed it. */
  claimedBy: Map<string, number>;
};
export type RankOptions = {
  target: number;
  radiusKm: number;
  maxPicks?: number;
  minShare?: number;
};

/**
 * Greedy coverage (design doc §4): score every res-8 cell within the radius of a seller,
 * take the best, claim its sellers, subtract them from every score they fed, repeat.
 * Each package counts once.
 */
export function rankHubs(
  sellers: MapSeller[],
  { target, radiusKm, maxPicks = 10, minShare = 0.25 }: RankOptions,
): Ranking {
  const k = radiusToK(radiusKm);
  const buckets = bucketByCell(sellers);
  const live = new Map(buckets);

  // Each populated cell adds its volume to every cell within k of it (the disk is symmetric),
  // so a candidate's score is built once and later only decreases as sellers are claimed.
  const disks = new Map<string, string[]>();
  const score = new Map<string, { v: number; e: number }>();
  for (const [cell, b] of buckets) {
    if (b.volume <= 0) continue;
    const disk = gridDisk(cell, k);
    disks.set(cell, disk);
    for (const n of disk) {
      const s = score.get(n);
      if (s) {
        s.v += b.volume;
        s.e += b.exact;
      } else score.set(n, { v: b.volume, e: b.exact });
    }
  }
  const scores = new Map(
    [...score].map(([c, s]) => [c, s.v] as [string, number]),
  );

  const picks: Pick[] = [];
  const claimedBy = new Map<string, number>();
  while (picks.length < maxPicks) {
    let best: string | null = null;
    let bs = { v: 0, e: 0 };
    for (const [c, s] of score) {
      // Higher volume wins; ties go to more exact-door volume, then a stable cell order.
      const better =
        s.v > bs.v ||
        (s.v === bs.v &&
          s.v > 0 &&
          (s.e > bs.e || (s.e === bs.e && best !== null && c < best)));
      if (better) {
        best = c;
        bs = s;
      }
    }
    if (!best || bs.v <= 0 || bs.v < minShare * target) break;
    const disk = gridDisk(best, k);
    const rank = picks.length + 1;
    picks.push({ ...buildCluster(best, disk, live, target), rank });
    for (const n of disk) {
      const b = live.get(n);
      if (!b) continue;
      for (const s of b.sellers) claimedBy.set(s.id, rank);
      live.delete(n);
      for (const m of disks.get(n) ?? []) {
        const s = score.get(m);
        if (s) {
          s.v -= b.volume;
          s.e -= b.exact;
        }
      }
    }
  }
  return { picks, scores, claimedBy };
}
