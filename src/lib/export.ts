import * as XLSX from "xlsx";
import { BAND_LABELS, type Band } from "./opportunity";

/** One row of public.v_export_sellers. */
export type ExportSeller = {
  id: string;
  external_id: string;
  name: string;
  profile_url: string | null;
  phone: string | null;
  address: string | null;
  approximate: boolean;
  locality: string | null;
  partido: string | null;
  province: string | null;
  shipments_month: number | null;
  band: Band | null;
  flex_candidate: string | null;
  reputation: string | null;
  power_seller: string | null;
  sources: string[] | null;
};

export type ExportSummary = {
  hub: string;
  radiusKm: number;
  target: number;
  needed: number;
  reached: number;
  exportedAt: Date;
  exportedBy: string;
};

const REPUTATION_ES: Record<string, string> = {
  "5_green": "verde",
  "4_light_green": "verde claro",
  "3_yellow": "amarillo",
  "2_orange": "naranja",
  "1_red": "rojo",
};

/**
 * Sheet 1 of the sales export (design doc §6). nuevo_estado and nota are left for the salesperson;
 * the file comes back through /importar in phase 3. Phone is a column only when allowed.
 */
export function exportRows(
  sellers: ExportSeller[],
  opts: { withPhone: boolean },
): Record<string, string | number>[] {
  return [...sellers]
    .sort(
      (a, b) =>
        (Number(b.shipments_month) || 0) - (Number(a.shipments_month) || 0),
    )
    .map((s) => ({
      ml_id: s.external_id,
      nombre: s.name,
      perfil: s.profile_url ?? "",
      domicilio: s.address ?? "",
      ubicacion: s.approximate
        ? "aproximada (centro de la localidad)"
        : "exacta",
      localidad: [s.locality, s.partido]
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(" · "),
      ...(opts.withPhone ? { telefono: s.phone ?? "" } : {}),
      paq_mes: s.shipments_month == null ? "" : Number(s.shipments_month),
      tamano: s.band ? BAND_LABELS[s.band] : "sin volumen",
      flex: s.flex_candidate ?? "",
      reputacion: s.reputation
        ? (REPUTATION_ES[s.reputation] ?? s.reputation)
        : "",
      power_seller: s.power_seller ?? "",
      estado: "Target",
      nuevo_estado: "",
      nota: "",
    }));
}

export function buildExportWorkbook(
  sellers: ExportSeller[],
  summary: ExportSummary,
  opts: { withPhone: boolean },
): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(exportRows(sellers, opts)),
    "Sellers",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { campo: "Hub", valor: summary.hub },
      { campo: "Radio (km)", valor: summary.radiusKm },
      { campo: "Objetivo (paq/mes)", valor: summary.target },
      { campo: "Sellers necesarios", valor: summary.needed },
      { campo: "Paq/mes con esos sellers (est.)", valor: summary.reached },
      { campo: "Sellers en el archivo", valor: sellers.length },
      {
        campo: "Exportado",
        valor: summary.exportedAt.toISOString().slice(0, 16).replace("T", " "),
      },
      { campo: "Por", valor: summary.exportedBy },
    ]),
    "Resumen",
  );
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function exportFilename(hub: string, date: Date): string {
  const slug = hub
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `elog-hub-${slug || "cluster"}-${date.toISOString().slice(0, 10)}.xlsx`;
}
