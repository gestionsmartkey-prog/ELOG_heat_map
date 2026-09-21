import { NextResponse } from "next/server";
import { getSellersResponse } from "@/lib/data";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const body = await getSellersResponse();
    const session = await getSession();
    return NextResponse.json({ ...body, viewer: session?.user ?? null, viewer_role: session?.role ?? null }, { headers: { "cache-control": "private, max-age=60" } });
  } catch (e) {
    console.error("GET /api/sellers failed", e);
    return NextResponse.json({ error: "data_unavailable" }, { status: 500 });
  }
}
