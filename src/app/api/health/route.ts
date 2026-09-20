import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Public liveness check for monitoring and deploy verification. Reports only
 * whether the database answers and which env vars are present, never data.
 */
export async function GET() {
  const env = {
    APP_PASSWORD: Boolean(process.env.APP_PASSWORD),
    SESSION_SECRET: Boolean(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16),
    SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
    SUPABASE_SECRET_KEY: Boolean(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY),
  };
  let db: "ok" | "error" | "skipped" = "skipped";
  let error: string | undefined;
  if (process.env.DATA_SOURCE !== "fixture" && env.SUPABASE_URL && env.SUPABASE_SECRET_KEY) {
    try {
      const { error: e } = await supabaseAdmin().from("seller_kinds").select("kind", { head: true, count: "exact" });
      if (e) throw new Error(e.message);
      db = "ok";
    } catch (e) {
      db = "error";
      error = e instanceof Error ? e.message : String(e);
    }
  }
  const ok = Object.values(env).every(Boolean) && db !== "error";
  return NextResponse.json({ ok, env, db, ...(error ? { error } : {}) }, { status: ok ? 200 : 503 });
}
