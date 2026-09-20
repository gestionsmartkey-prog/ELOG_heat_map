import { NextResponse } from "next/server";
import { SESSION_COOKIE, checkCredentials, createSessionToken, sessionCookieOptions } from "@/lib/auth";

/** Plain form POST so the login page works without JavaScript. */
export async function POST(request: Request) {
  const form = await request.formData();
  const username = String(form.get("username") ?? "").slice(0, 64);
  const password = String(form.get("password") ?? "").slice(0, 256);
  // Small fixed delay blunts online guessing without needing shared state.
  await new Promise((r) => setTimeout(r, 400));
  const user = checkCredentials(username, password);
  if (!user) {
    return NextResponse.redirect(new URL("/login?error=1", request.url), { status: 303 });
  }
  const res = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(user), sessionCookieOptions);
  return res;
}
