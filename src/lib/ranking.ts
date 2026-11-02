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
