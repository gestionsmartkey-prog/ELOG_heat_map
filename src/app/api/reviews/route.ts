import { NextResponse } from "next/server";
import { listReviews } from "@/lib/reviews";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ reviews: await listReviews() });
  } catch (e) {
    console.error("GET /api/reviews failed", e);
    return NextResponse.json({ error: "reviews_unavailable" }, { status: 500 });
  }
}
