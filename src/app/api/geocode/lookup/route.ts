import { NextResponse, type NextRequest } from "next/server";
import { lookupAddress, normalizeAddressInput, type AddressInput } from "@/lib/reviews";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** Look an address up without saving anything: the review screen's "Buscar en el mapa". */
export async function POST(request: NextRequest) {
  let body: AddressInput;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  const address = normalizeAddressInput(body);
  if (!address) return NextResponse.json({ error: "bad_address", message: "Falta la calle." }, { status: 422 });
  if (process.env.DATA_SOURCE === "fixture") return NextResponse.json({ address, found: null });
  try {
    return NextResponse.json({ address, found: await lookupAddress(address) });
  } catch (e) {
    console.error("POST /api/geocode/lookup failed", e);
    return NextResponse.json({ error: "lookup_failed" }, { status: 502 });
  }
}
