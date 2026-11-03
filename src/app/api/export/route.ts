import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { canSeePhone } from "@/lib/auth";
import { getExportSellers, logExport } from "@/lib/data";
import { buildExportWorkbook, exportFilename } from "@/lib/export";

export const dynamic = "force-dynamic";

const MAX_IDS = 3000;

/** POST {hub, radiusKm, target, needed, reached, seller_ids}: the cluster's sellers as .xlsx. Logged. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    hub?: string;
    radiusKm?: number;
    target?: number;
    needed?: number;
    reached?: number;
    seller_ids?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "bad_request", message: "Se esperaba un cuerpo JSON." },
      { status: 400 },
    );
  }
  const ids = Array.isArray(body.seller_ids)
    ? [
        ...new Set(
          body.seller_ids.filter((x): x is string => typeof x === "string"),
        ),
      ]
    : [];
  if (!ids.length)
    return NextResponse.json(
      { error: "empty", message: "No hay sellers para exportar." },
      { status: 400 },
    );
  if (ids.length > MAX_IDS)
    return NextResponse.json(
      {
        error: "too_many",
        message: `Se pueden exportar hasta ${MAX_IDS} sellers.`,
      },
      { status: 413 },
    );

  const hub = String(body.hub ?? "cluster").slice(0, 120);
  const withPhone = canSeePhone(session.role);
  try {
    const sellers = await getExportSellers(ids);
    const now = new Date();
    const file = buildExportWorkbook(
      sellers,
      {
        hub,
        radiusKm: Number(body.radiusKm) || 0,
        target: Number(body.target) || 0,
        needed: Number(body.needed) || 0,
        reached: Number(body.reached) || 0,
        exportedAt: now,
        exportedBy: session.user,
      },
      { withPhone },
    );
    await logExport({
      actor: session.user,
      role: session.role,
      scope: "cluster",
      label: hub,
      row_count: sellers.length,
      with_phone: withPhone,
    });
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${exportFilename(hub, now)}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    console.error("POST /api/export failed", e);
    return NextResponse.json(
      { error: "export_failed", message: "No se pudo generar el archivo." },
      { status: 500 },
    );
  }
}
