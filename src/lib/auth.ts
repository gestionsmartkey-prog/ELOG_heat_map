import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "elog_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

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

/**
 * Named users come from APP_USERS: "alice:secret1, bob:secret2" (comma or newline
 * separated; the first colon splits name from password). APP_PASSWORD is the
 * shared fallback that accepts any username. Both can coexist.
 */
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

export function hasAnyCredential(): boolean {
  return parseUsers().size > 0 || Boolean(process.env.APP_PASSWORD);
}

/** Returns the resolved username on success, null otherwise. */
export function checkCredentials(username: string, password: string): string | null {
  const name = username.trim().toLowerCase();
  const users = parseUsers();
  const expected = users.get(name);
  if (expected !== undefined) return safeEqual(password, expected) ? name : null;
  // Always run one comparison so unknown usernames cost the same as known ones.
  const shared = process.env.APP_PASSWORD ?? "";
  if (shared && safeEqual(password, shared)) return name || "team";
  safeEqual(password, "x".repeat(Math.max(1, password.length)));
  return null;
}

export async function createSessionToken(user: string): Promise<string> {
  return new SignJWT({ role: "team" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret());
}

/** Returns the username inside a valid session token, or null. */
export async function verifySessionToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return payload.sub ?? "team";
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};
