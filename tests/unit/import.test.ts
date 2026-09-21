import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { importWorkbook, ImportError } from "../../src/lib/import";

const prev = process.env.DATA_SOURCE;
beforeAll(() => { process.env.DATA_SOURCE = "fixture"; });
afterAll(() => { process.env.DATA_SOURCE = prev; });

function workbook(rows: Record<string, unknown>[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Hoja1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("importWorkbook", () => {
  it("runs the sample through the pipeline without touching the database in fixture mode", async () => {
    const buf = readFileSync("data/private/Sellers.xlsx");
    const out = await importWorkbook(buf, "Sellers.xlsx", { uploaded_by: "demo" });
    expect(out.status).toBe("dry_run");
    expect(out.report.row_count).toBe(140);
    expect(out.report.seller_count).toBe(140);
    expect(out.report.by_kind.dropoff_agency).toBe(18);
  });

  it("accepts a csv with aliased headers", async () => {
    const csv = Buffer.from("Seller ID,Nombre,Dirección,Número,Barrio,Provincia,Codigo Postal\n1,Uno,Zapata,5,Belgrano,CABA,1426\n");
    const out = await importWorkbook(csv, "lote.csv");
    expect(out.status).toBe("dry_run");
    expect(out.report.seller_count).toBe(1);
    expect(out.report.location_count).toBe(1);
  });

  it("rejects the wrong extension, empty files and sheets without ids", async () => {
    await expect(importWorkbook(Buffer.from("x"), "foto.png")).rejects.toMatchObject({ code: "unsupported_type" });
    await expect(importWorkbook(Buffer.alloc(0), "a.xlsx")).rejects.toMatchObject({ code: "empty_file" });
    const noIds = workbook([{ Nombre: "Sin id", Dirección: "Zapata", Número: 5 }]);
    const err = await importWorkbook(noIds, "sinid.xlsx").catch((e) => e as ImportError);
    expect(err).toBeInstanceOf(ImportError);
    expect((err as ImportError).code).toBe("no_ids");
    expect((err as ImportError).report?.review_count).toBe(1);
  });
});
