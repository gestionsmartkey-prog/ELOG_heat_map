import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "elog_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type Role = "viewer" | "admin";
export type SessionInfo = { user: string; role: Role };

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET must be set (16+ chars)");
  return new TextEncoder().encode(s);
}

/** Constant-time string compare so password checks do not leak length/prefix timing. */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i % ea.length] ?? 0) ^ (eb[i % eb.length] ?? 0);
  return diff === 0;
}

/** "alice:secret1, bob:secret2" (comma or newline separated; first colon splits name from password). */
export function parseUsers(raw = process.env.APP_USERS ?? ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of raw.split(/[,\n]/)) {
    const t = entry.trim();
    if (!t) continue;
    const i = t.indexOf(":");
    if (i <= 0) continue;
    out.set(t.slice(0, i).trim().toLowerCase(), t.slice(i + 1).trim());
  }
  return out;
}

/** Bootstrap admins, same format as APP_USERS. These get role=admin and can whitelist others. */
export function parseAdmins(raw = process.env.APP_ADMINS ?? ""): Map<string, string> {
  return parseUsers(raw);
}

export function hasAnyCredential(): boolean {
  return parseUsers().size > 0 || parseAdmins().size > 0 || Boolean(process.env.APP_PASSWORD);
}

/**
 * Env-based credential check (bootstrap + fallback). Admins win over viewers on a
 * name collision. Returns the resolved session, or null. DB-backed users are checked
 * separately (see lib/users) so this module stays free of server-only imports.
 */
export function checkEnvCredentials(username: string, password: string): SessionInfo | null {
  const name = username.trim().toLowerCase();
  const admins = parseAdmins();
  const users = parseUsers();
  const adminPw = admins.get(name);
  if (adminPw !== undefined) return safeEqual(password, adminPw) ? { user: name, role: "admin" } : null;
  const userPw = users.get(name);
  if (userPw !== undefined) return safeEqual(password, userPw) ? { user: name, role: "viewer" } : null;
  const shared = process.env.APP_PASSWORD ?? "";
  if (shared && safeEqual(password, shared)) return { user: name || "team", role: "viewer" };
  // Keep unknown usernames the same cost as known ones.
  safeEqual(password, "x".repeat(Math.max(1, password.length)));
  return null;
}

export async function createSessionToken(session: SessionInfo): Promise<string> {
  return new SignJWT({ role: session.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.user)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret());
}

/** Returns the session inside a valid token, or null. */
export async function verifySessionToken(token: string | undefined): Promise<SessionInfo | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const role: Role = payload.role === "admin" ? "admin" : "viewer";
    return { user: (payload.sub as string) ?? "team", role };
  } catch {
    return null;
  }
}

/**
 * Admin bearer token for automation: a short JWT with scope:"admin", signed with the
 * same secret. Mint one with scripts/mint-admin-token.ts. Accepts a raw token or an
 * "Authorization: Bearer <token>" header value.
 */
export async function verifyAdminToken(authorization: string | null | undefined): Promise<boolean> {
  if (!authorization) return false;
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return payload.scope === "admin";
  } catch {
    return false;
  }
}

/** Mint an admin bearer token (used by the CLI). */
export async function createAdminToken(ttlSeconds = 3600, note = "admin"): Promise<string> {
  return new SignJWT({ scope: "admin", note })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret());
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};
