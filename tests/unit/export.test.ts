import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  buildExportWorkbook,
  exportFilename,
  exportRows,
  type ExportSeller,
} from "../../src/lib/export";

const seller = (over: Partial<ExportSeller> = {}): ExportSeller => ({
  id: "u1",
  external_id: "123",
  name: "Tienda",
  profile_url: "http://perfil.mercadolibre.com.ar/TIENDA",
  phone: "11 5555-0000",
  address: "Av. Rivadavia 1000",
  approximate: false,
  locality: "Morón",
  partido: "Morón",
  province: "Buenos Aires",
  shipments_month: 1200,
  band: "core",
  flex_candidate: "si",
  reputation: "5_green",
  power_seller: "gold",
  sources: ["meli", "ml_publico"],
  ...over,
});
const summary = {
  hub: "Morón",
  radiusKm: 5,
  target: 5000,
  needed: 4,
  reached: 5600,
  exportedAt: new Date("2026-11-03T12:00:00Z"),
  exportedBy: "ana@elog.com",
};

describe("export rows", () => {
  it("sort by volume, label bands and leave the sales columns empty", () => {
    const rows = exportRows(
      [
        seller({ id: "a", shipments_month: 300, band: "chico" }),
        seller({ id: "b" }),
      ],
      { withPhone: true },
    );
    expect(rows.map((r) => r.paq_mes)).toEqual([1200, 300]);
    expect(rows[0]).toMatchObject({
      ml_id: "123",
      nombre: "Tienda",
      tamano: "Core",
      flex: "si",
      reputacion: "verde",
      power_seller: "gold",
      ubicacion: "exacta",
      telefono: "11 5555-0000",
      estado: "Target",
      nuevo_estado: "",
      nota: "",
    });
  });

  it("drop the phone column entirely without permission", () => {
    const [r] = exportRows([seller()], { withPhone: false });
    expect("telefono" in r).toBe(false);
  });

  it("mark approximate locations and missing volume", () => {
    const [r] = exportRows(
      [
        seller({
          approximate: true,
          address: "Morón",
          shipments_month: null,
          band: null,
        }),
      ],
      { withPhone: false },
    );
    expect(r).toMatchObject({
      domicilio: "Morón",
      ubicacion: "aproximada (centro de la localidad)",
      paq_mes: "",
      tamano: "sin volumen",
    });
  });
});

describe("export workbook", () => {
  it("has the sellers sheet and a summary sheet", () => {
    const wb = XLSX.read(
      buildExportWorkbook([seller()], summary, { withPhone: false }),
    );
    expect(wb.SheetNames).toEqual(["Sellers", "Resumen"]);
    const resumen = XLSX.utils.sheet_to_json<{ campo: string; valor: unknown }>(
      wb.Sheets.Resumen,
    );
    expect(resumen.find((r) => r.campo === "Sellers necesarios")?.valor).toBe(
      4,
    );
    expect(XLSX.utils.sheet_to_json(wb.Sheets.Sellers)).toHaveLength(1);
  });

  it("names the file after the hub and the date", () => {
    expect(
      exportFilename(
        "Villa Luzuriaga · Morón",
        new Date("2026-11-03T12:00:00Z"),
      ),
    ).toBe("elog-hub-villa-luzuriaga-moron-2026-11-03.xlsx");
  });
});
