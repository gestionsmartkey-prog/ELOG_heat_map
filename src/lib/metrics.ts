import type { MapSeller } from "./types";

/**
 * Metric registry. The map is a dumb shell: each metric is a reducer over the
 * sellers that fall in a cell. Adding a metric is one entry here, no map code.
 */
export type Metric = {
  id: string;
  label: string;
  /** Plural and singular unit, for "2 sellers" / "1 seller". */
  short: string;
  one: string;
  reduce: (rows: MapSeller[]) => number;
  format: (v: number) => string;
};

export const METRICS: Metric[] = [
  {
    id: "seller_count",
    label: "Cantidad de sellers",
    short: "sellers",
    one: "seller",
    reduce: (rows) => rows.length,
    format: (v) => String(v),
  },
  {
    id: "location_count",
    label: "Cantidad de domicilios",
    short: "domicilios",
    one: "domicilio",
    reduce: (rows) => new Set(rows.map((r) => r.location_id ?? r.id)).size,
    format: (v) => String(v),
  },
  {
    id: "shipments_month",
    label: "Envíos por mes (est.)",
    short: "envíos/mes",
    one: "envío/mes",
    reduce: (rows) => rows.reduce((sum, r) => sum + (r.metrics?.shipments_month ?? 0), 0),
    format: (v) => Math.round(v).toLocaleString("es-AR"),
  },
  {
    id: "flex_candidates",
    label: "Candidatos Flex",
    short: "candidatos Flex",
    one: "candidato Flex",
    reduce: (rows) => rows.filter((r) => r.attrs?.flex_candidate === "si").length,
    format: (v) => String(v),
  },
];

export function metricById(id: string): Metric {
  return METRICS.find((m) => m.id === id) ?? METRICS[0];
}
