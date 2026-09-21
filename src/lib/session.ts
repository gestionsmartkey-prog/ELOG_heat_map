import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken, verifyAdminToken, type SessionInfo } from "./auth";

/** Current session from the cookie (route handlers / server components). */
export async function getSession(): Promise<SessionInfo | null> {
  return verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/**
 * Authorize an admin action: an admin session cookie, or an admin bearer token in
 * the Authorization header. Returns the acting identity, or null when not allowed.
 */
export async function requireAdmin(request: Request): Promise<{ by: string } | null> {
  const session = await getSession();
  if (session?.role === "admin") return { by: session.user };
  if (await verifyAdminToken(request.headers.get("authorization"))) return { by: "admin-token" };
  return null;
}
