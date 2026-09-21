import { NextResponse, type NextRequest } from "next/server";
import { resolveReview, type ResolveAction } from "@/lib/reviews";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ACTIONS: ResolveAction[] = ["locate", "dismiss", "retry"];

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  let body: { action?: string; lat?: number; lng?: number };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  const action = body.action as ResolveAction;
  if (!ACTIONS.includes(action)) return NextResponse.json({ error: "bad_action", message: `action debe ser uno de: ${ACTIONS.join(", ")}` }, { status: 400 });

  try {
    const result = await resolveReview(numId, action, { lat: body.lat, lng: body.lng });
    if (!result.ok) return NextResponse.json(result, { status: 422 });
    return NextResponse.json(result);
  } catch (e) {
    console.error("POST /api/reviews/[id] failed", e);
    return NextResponse.json({ error: "resolve_failed" }, { status: 500 });
  }
}
