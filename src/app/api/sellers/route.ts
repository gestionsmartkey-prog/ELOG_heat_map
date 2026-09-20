import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSellersResponse } from "@/lib/data";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const body = await getSellersResponse();
    const viewer = await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
    return NextResponse.json({ ...body, viewer }, { headers: { "cache-control": "private, max-age=60" } });
  } catch (e) {
    console.error("GET /api/sellers failed", e);
    return NextResponse.json({ error: "data_unavailable" }, { status: 500 });
  }
}
