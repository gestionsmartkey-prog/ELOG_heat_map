import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { importWorkbook, ImportError, MAX_UPLOAD_BYTES } from "@/lib/import";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** multipart/form-data: file (required), source (optional), force=1 to re-import a file already loaded. */
export async function POST(request: NextRequest) {
  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "bad_request", message: "Se esperaba un formulario con el archivo." }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "missing_file", message: "Falta el archivo." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "too_large", message: `El archivo supera los ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.` }, { status: 413 });

  const uploaded_by = await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  const source = String(form.get("source") ?? "meli").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32) || "meli";
  const force = form.get("force") === "1";

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const outcome = await importWorkbook(buffer, file.name, { source, uploaded_by, force });
    return NextResponse.json(outcome, { status: outcome.status === "duplicate" ? 409 : 200 });
  } catch (e) {
    if (e instanceof ImportError) return NextResponse.json({ error: e.code, message: e.message, report: e.report ?? null }, { status: 422 });
    console.error("POST /api/import failed", e);
    return NextResponse.json({ error: "import_failed", message: "La importación falló. Revisá los registros del servidor." }, { status: 500 });
  }
}
