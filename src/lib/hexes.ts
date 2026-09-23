import { cellToBoundary, cellToParent, getResolution, gridDisk } from "h3-js";
import type { MapSeller } from "./types";
import type { Metric } from "./metrics";

export const STORED_RES = 9;

/** Display resolution follows zoom: 7 at metro view, 8 at city view (the default), 9 up close. */
export function resolutionForZoom(zoom: number): number {
  if (zoom < 10.5) return 7;
  if (zoom < 13) return 8;
  return 9;
}

export type CellAgg = {
  cell: string;
  value: number;
  sellers: MapSeller[];
};

/** Group sellers into cells at `res`, evaluating the metric per cell. */
export function aggregate(sellers: MapSeller[], res: number, metric: Metric): Map<string, CellAgg> {
  const cells = new Map<string, MapSeller[]>();
  for (const s of sellers) {
    if (!s.h3_r9) continue;
    const cell = res >= STORED_RES ? s.h3_r9 : cellToParent(s.h3_r9, res);
    const arr = cells.get(cell);
    if (arr) arr.push(s); else cells.set(cell, [s]);
  }
  const out = new Map<string, CellAgg>();
  for (const [cell, rows] of cells) out.set(cell, { cell, value: metric.reduce(rows), sellers: rows });
  return out;
}

/** Hexágonos vecinos dentro de k anillos, sin contar el central (k=1 → 6, k=2 → 18). */
export function neighbourCount(k: number): number {
  return 3 * k * (k + 1);
}

/** Cómo se nombra la zona en la interfaz: "este + 6 vecinos". */
export function zoneLabel(k: number): string {
  return k > 0 ? `este + ${neighbourCount(k)} vecinos` : "solo este hexágono";
}

/** Sum of a metric over a cell and its k-ring neighbours: the catchment a hub there would serve. */
export function catchment(cell: string, agg: Map<string, CellAgg>, metric: Metric, k: number): number {
  const rows: MapSeller[] = [];
  for (const c of gridDisk(cell, k)) {
    const a = agg.get(c);
    if (a) rows.push(...a.sellers);
  }
  return metric.reduce(rows);
}

export type Bin = { min: number; max: number; color: string; label: string };

// Rampa secuencial de marca: del Papel al Naranja ELOG y al Naranja Tostado. Pálido = pocos, saturado = muchos.
const PALETTE = ["#F5E3D3", "#FFC48F", "#FF9038", "#E86A1F", "#C13E06", "#8A2B04"];

/**
 * Class breaks that survive skewed, small-N data. Quantile breaks on the
 * distinct values; when there are few distinct values each becomes its own bin.
 * Every bin is labelled with its count range so colour maps back to numbers.
 */
export function computeBins(values: number[]): Bin[] {
  const vals = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (!vals.length) return [];
  const distinct = [...new Set(vals)];
  let edges: number[];
  if (distinct.length <= PALETTE.length) {
    edges = distinct;
  } else {
    const n = PALETTE.length;
    edges = [];
    for (let i = 1; i <= n; i++) {
      const q = vals[Math.min(vals.length - 1, Math.ceil((i / n) * vals.length) - 1)];
      if (!edges.includes(q)) edges.push(q);
    }
  }
  const bins: Bin[] = [];
  let lo = 1;
  edges.forEach((hi, i) => {
    const color = PALETTE[Math.round((i / Math.max(1, edges.length - 1)) * (PALETTE.length - 1))];
    bins.push({ min: lo, max: hi, color, label: lo === hi ? `${lo}` : `${lo}–${hi}` });
    lo = hi + 1;
  });
  return bins;
}

export function colorFor(value: number, bins: Bin[]): string {
  for (const b of bins) if (value >= b.min && value <= b.max) return b.color;
  return bins.length ? bins[bins.length - 1].color : "#E3DFDB";
}

/** GeoJSON for MapLibre: one polygon per populated cell with value and colour baked in. */
export function toGeoJSON(agg: Map<string, CellAgg>, bins: Bin[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const a of agg.values()) {
    const ring = cellToBoundary(a.cell, true); // [lng, lat]
    ring.push(ring[0]);
    features.push({
      type: "Feature",
      id: a.cell,
      properties: { cell: a.cell, value: a.value, color: colorFor(a.value, bins), res: getResolution(a.cell) },
      geometry: { type: "Polygon", coordinates: [ring] },
    });
  }
  return { type: "FeatureCollection", features };
}

export function pointsGeoJSON(sellers: MapSeller[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: sellers.filter((s) => s.lat != null && s.lng != null).map((s) => ({
      type: "Feature",
      id: s.id,
      properties: { id: s.id, name: s.name, kind: s.kind, cell: s.h3_r9 },
      geometry: { type: "Point", coordinates: [s.lng as number, s.lat as number] },
    })),
  };
}
