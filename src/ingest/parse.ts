import * as XLSX from "xlsx";
import { createHash } from "node:crypto";
import type { RawRow } from "./types";

export type ParsedFile = {
  filename: string;
  file_hash: string;
  sheet: string;
  rows: RawRow[];
};

/** Read the first non-empty sheet of an .xlsx/.xls/.csv buffer into plain objects keyed by header. */
export function parseWorkbook(buffer: Buffer | Uint8Array, filename: string): ParsedFile {
  const file_hash = createHash("sha256").update(buffer).digest("hex");
  // SheetJS decodes a CSV buffer as Latin-1; decode UTF-8 text ourselves so "Dirección" keeps its accent.
  const wb = /\.(csv|txt|tsv)$/i.test(filename)
    ? XLSX.read(decodeText(buffer), { type: "string", cellDates: false })
    : XLSX.read(buffer, { type: "buffer", cellDates: false });
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<RawRow>(ws, { defval: null, raw: true }).map(stripEmptyAutoColumns);
    const nonEmpty = rows.filter((r) => Object.values(r).some((v) => v !== null && v !== undefined && String(v).trim() !== ""));
    if (nonEmpty.length) return { filename, file_hash, sheet: name, rows: nonEmpty };
  }
  return { filename, file_hash, sheet: wb.SheetNames[0] ?? "", rows: [] };
}

/** UTF-8 (with or without BOM) unless the bytes are not valid UTF-8, then Latin-1 as Excel exports it. */
function decodeText(buffer: Buffer | Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

export function rowHash(row: RawRow): string {
  const stable = JSON.stringify(row, Object.keys(row).sort());
  return createHash("sha1").update(stable).digest("hex");
}

/** SheetJS names header-less columns "__EMPTY", "__EMPTY_1"…; drop them when they carry nothing. */
function stripEmptyAutoColumns(row: RawRow): RawRow {
  const out: RawRow = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith("__EMPTY") && (v === null || v === undefined || String(v).trim() === "")) continue;
    out[k] = v;
  }
  return out;
}
