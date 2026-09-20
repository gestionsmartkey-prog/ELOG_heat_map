import type { MapSeller } from "./types";

/**
 * Metric registry. The map is a dumb shell: each metric is a reducer over the
 * sellers that fall in a cell. Adding a metric is one entry here, no map code.
 */
export type Metric = {
  id: string;
  label: string;
  short: string;
  reduce: (rows: MapSeller[]) => number;
  format: (v: number) => string;
};

export const METRICS: Metric[] = [
  {
    id: "seller_count",
    label: "Number of sellers",
    short: "sellers",
    reduce: (rows) => rows.length,
    format: (v) => String(v),
  },
  {
    id: "location_count",
    label: "Number of pickup doors",
    short: "doors",
    reduce: (rows) => new Set(rows.map((r) => r.location_id ?? r.id)).size,
    format: (v) => String(v),
  },
  // Phase 2, when volume rows exist in seller_metrics:
  // { id: "avg_monthly_volume", label: "Monthly volume", reduce: rows => sum(rows, r => r.metrics?.avg_monthly_volume ?? 0) }
];

export function metricById(id: string): Metric {
  return METRICS.find((m) => m.id === id) ?? METRICS[0];
}
