import { NextResponse } from "next/server";
import { getSellersResponse } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const body = await getSellersResponse();
    return NextResponse.json(body, { headers: { "cache-control": "private, max-age=60" } });
  } catch (e) {
    console.error("GET /api/sellers failed", e);
    return NextResponse.json({ error: "data_unavailable" }, { status: 500 });
  }
}
