import { NextResponse } from "next/server";
import { getSellerDetail } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  try {
    const s = await getSellerDetail(id);
    if (!s) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(s);
  } catch (e) {
    console.error("GET /api/sellers/[id] failed", e);
    return NextResponse.json({ error: "data_unavailable" }, { status: 500 });
  }
}
