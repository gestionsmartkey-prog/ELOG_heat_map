import { supabaseAdmin } from "./supabase";
import type { Role, SessionInfo } from "./auth";

export type AppUser = { email: string; role: Role; active: boolean; created_by: string | null; created_at: string };

/** Verify a database-backed login. Returns the session or null. Fails closed on error. */
export async function verifyDbUser(email: string, password: string): Promise<SessionInfo | null> {
  if (process.env.DATA_SOURCE === "fixture") return null;
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb.rpc("verify_app_user", { p_email: email, p_password: password }).maybeSingle();
    if (error || !data) return null;
    const row = data as { email: string; role: Role };
    return { user: row.email, role: row.role === "admin" ? "admin" : "viewer" };
  } catch (e) {
    console.error("verifyDbUser failed", e);
    return null;
  }
}

/** Whitelist (create or update) a user. Throws UserError on validation problems. */
export async function createUser(email: string, password: string, role: Role, createdBy: string | null): Promise<AppUser> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("create_app_user", { p_email: email, p_password: password, p_role: role, p_created_by: createdBy }).maybeSingle();
  if (error) {
    const known: Record<string, string> = { invalid_email: "El email no es válido.", weak_password: "La contraseña debe tener al menos 8 caracteres.", invalid_role: "El rol no es válido." };
    throw new UserError(known[error.message] ? error.message : "create_failed", known[error.message] ?? "No se pudo crear el usuario.");
  }
  return data as AppUser;
}

export async function listUsers(): Promise<AppUser[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("list_app_users");
  if (error) throw new Error(`list_app_users: ${error.message}`);
  return (data ?? []) as AppUser[];
}

export async function setUserActive(email: string, active: boolean): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb.rpc("set_app_user_active", { p_email: email, p_active: active });
  if (error) throw new Error(`set_app_user_active: ${error.message}`);
}

export class UserError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
