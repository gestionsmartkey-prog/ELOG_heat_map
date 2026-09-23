import { parseWorkbook, runPipeline, loadToSupabase, type IngestReport } from "@/ingest";
import { supabaseAdmin } from "./supabase";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel function body limit is 4.5 MB
export const ACCEPTED_EXTENSIONS = [".xlsx", ".xls", ".csv"];

export type ImportOutcome =
  | { status: "loaded"; batch_id: string; report: IngestReport; sheet: string; dry_run: false }
  | { status: "dry_run"; batch_id: null; report: IngestReport; sheet: string; dry_run: true }
  | { status: "duplicate"; batch_id: string; filename: string; created_at: string; report: IngestReport; sheet: string; dry_run: false };

export type ImportOptions = { source?: string; uploaded_by?: string | null; force?: boolean };

/**
 * One uploaded workbook → parse → pipeline (no network) → Supabase. Geocoding is
 * left to the database so the request returns in seconds; the page then drives
 * /api/geocode until nothing is pending.
 */
export async function importWorkbook(buffer: Buffer, filename: string, opts: ImportOptions = {}): Promise<ImportOutcome> {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  if (!ACCEPTED_EXTENSIONS.includes(ext)) throw new ImportError("unsupported_type", `Formato no soportado (${ext || "sin extensión"}). Subí un .xlsx, .xls o .csv.`);
  if (buffer.byteLength === 0) throw new ImportError("empty_file", "El archivo está vacío.");
  if (buffer.byteLength > MAX_UPLOAD_BYTES) throw new ImportError("too_large", `El archivo supera los ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);

  const parsed = parseWorkbook(buffer, filename);
  if (!parsed.rows.length) throw new ImportError("no_rows", "No se encontraron filas con datos en ninguna hoja.");

  const result = await runPipeline(parsed.rows, {
    batch: { filename, file_hash: parsed.file_hash, source: opts.source ?? "meli", uploaded_by: opts.uploaded_by ?? null },
    geocoder: null,
  });
  // A file where no row has an id is almost always an unrecognized id column. Loading it by name + door
  // would duplicate every seller once a file with ids arrives, so only the odd id-less row is identified that way.
  if (!result.sellers.length || result.report.derived_ids === result.report.seller_count) throw new ImportError("no_ids", "Ninguna fila tiene un identificador de seller. Revisá que la columna «Seller ID» exista.", result.report);

  if (process.env.DATA_SOURCE === "fixture") return { status: "dry_run", batch_id: null, report: result.report, sheet: parsed.sheet, dry_run: true };

  const sb = supabaseAdmin();
  if (!opts.force) {
    const { data: dup } = await sb.from("import_batches").select("id,filename,created_at").eq("file_hash", parsed.file_hash).eq("status", "loaded").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (dup) return { status: "duplicate", batch_id: dup.id as string, filename: dup.filename as string, created_at: dup.created_at as string, report: result.report, sheet: parsed.sheet, dry_run: false };
  }
  const { batch_id } = await loadToSupabase(result, sb);
  return { status: "loaded", batch_id, report: result.report, sheet: parsed.sheet, dry_run: false };
}

export class ImportError extends Error {
  constructor(public code: string, message: string, public report?: IngestReport) { super(message); }
}
