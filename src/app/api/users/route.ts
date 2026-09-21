import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/session";
import { createUser, listUsers, setUserActive, UserError } from "@/lib/users";
import type { Role } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET: list whitelisted users (admin only). */
export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    return NextResponse.json({ users: await listUsers() });
  } catch (e) {
    console.error("GET /api/users failed", e);
    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }
}

/** POST: whitelist a user {email, password, role?}. Admin session cookie or Bearer admin token. */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "forbidden", message: "Se requiere permiso de administrador." }, { status: 403 });

  let body: { email?: string; password?: string; role?: string; active?: boolean };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "bad_request", message: "Se esperaba un cuerpo JSON." }, { status: 400 }); }

  const email = String(body.email ?? "").trim();
  const role: Role = body.role === "admin" ? "admin" : "viewer";

  // Deactivate/reactivate path: {email, active:boolean}
  if (typeof body.active === "boolean" && body.password === undefined) {
    try {
      await setUserActive(email, body.active);
      return NextResponse.json({ email: email.toLowerCase(), active: body.active });
    } catch (e) {
      console.error("set active failed", e);
      return NextResponse.json({ error: "update_failed" }, { status: 500 });
    }
  }

  try {
    const user = await createUser(email, String(body.password ?? ""), role, admin.by);
    return NextResponse.json({ user }, { status: 201 });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.code, message: e.message }, { status: 422 });
    console.error("POST /api/users failed", e);
    return NextResponse.json({ error: "create_failed", message: "No se pudo crear el usuario." }, { status: 500 });
  }
}
