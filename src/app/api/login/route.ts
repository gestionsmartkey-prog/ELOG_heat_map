import { NextResponse } from "next/server";
import { SESSION_COOKIE, checkPassword, createSessionToken, sessionCookieOptions } from "@/lib/auth";

/** Plain form POST so the login page works without JavaScript. */
export async function POST(request: Request) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  // Small fixed delay blunts online guessing without needing shared state.
  await new Promise((r) => setTimeout(r, 400));
  if (!checkPassword(password)) {
    return NextResponse.redirect(new URL("/login?error=1", request.url), { status: 303 });
  }
  const res = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions);
  return res;
}
