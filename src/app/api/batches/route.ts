import { NextResponse } from "next/server";
import { getSellersResponse } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const { batches, stats, generated_at } = await getSellersResponse();
  return NextResponse.json({ batches, stats, generated_at });
}
