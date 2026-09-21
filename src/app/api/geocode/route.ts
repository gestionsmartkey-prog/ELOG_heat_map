import { NextResponse, type NextRequest } from "next/server";
import { geocodeCounts, runGeocodePass } from "@/lib/geocode";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET: current tally. POST: run one time-boxed pass (?retry=1 also retries failed/review rows). */
export async function GET() {
  try {
    return NextResponse.json({ counts: await geocodeCounts() });
  } catch (e) {
    console.error("GET /api/geocode failed", e);
    return NextResponse.json({ error: "geocode_unavailable" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const retry = request.nextUrl.searchParams.get("retry") === "1";
  try {
    return NextResponse.json(await runGeocodePass({ retry }));
  } catch (e) {
    console.error("POST /api/geocode failed", e);
    return NextResponse.json({ error: "geocode_failed", message: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
