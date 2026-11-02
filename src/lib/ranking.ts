import {
  cellToLatLng,
  cellToParent,
  getHexagonEdgeLengthAvg,
  gridDisk,
  gridDistance,
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

/**
 * A spot is named after the locality nearest its centre (most volume among the closest sellers).
 * Naming by the most volume in the whole radius gave neighbouring hubs the same name, because
 * approximate sellers stack on a few locality centres (Balvanera, La Matanza).
 */
function nearestLocality(cell: string, sellers: MapSeller[]): string {
  let best = Infinity;
  let closest: MapSeller[] = [];
  for (const s of sellers) {
    if (!s.h3_r9 || !(s.locality ?? s.partido)) continue;
    const d = gridDistance(cell, cellToParent(s.h3_r9, HUB_RES));
    if (d < best) {
      best = d;
      closest = [s];
    } else if (d === best) closest.push(s);
  }
  return topLocality(closest);
}

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
    name: nearestLocality(cell, all),
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
 * take the best, let it claim the sellers it needs to reach the target (largest first),
 * subtract them from every score they fed, block hub centres inside its radius, repeat.
 * Each package counts once; sellers a hub does not need stay available to the hubs around it.
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
    const pick: Pick = { ...buildCluster(best, disk, live, target), rank };
    picks.push(pick);

    // A hub holds one target: it claims only the sellers it needs, the rest stay for the hubs around it.
    const byCell = new Map<string, Set<string>>();
    for (const s of pick.needed.picks) {
      claimedBy.set(s.id, rank);
      const cell = cellToParent(s.h3_r9!, HUB_RES);
      byCell.set(cell, (byCell.get(cell) ?? new Set()).add(s.id));
    }
    for (const [cell, ids] of byCell) {
      const b = live.get(cell)!;
      const rest = b.sellers.filter((s) => !ids.has(s.id));
      const next = bucketByCell(rest).get(cell) ?? {
        volume: 0,
        exact: 0,
        sellers: [],
      };
      live.set(cell, next);
      for (const m of disks.get(cell) ?? []) {
        const s = score.get(m);
        if (s) {
          s.v -= b.volume - next.volume;
          s.e -= b.exact - next.exact;
        }
      }
    }
    // No later hub is centred inside this one's radius, so the picks are distinct places.
    for (const n of disk) score.delete(n);
  }
  return { picks, scores, claimedBy };
}
