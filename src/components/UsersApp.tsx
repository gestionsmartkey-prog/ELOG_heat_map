"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type AppUser = { email: string; role: string; active: boolean; created_by: string | null; created_at: string };

export function UsersApp() {
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("viewer");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/users", { cache: "no-store" });
    if (r.status === 401) { window.location.href = "/login"; return; }
    if (r.status === 403) { setForbidden(true); setUsers([]); return; }
    if (r.ok) setUsers(((await r.json()) as { users: AppUser[] }).users ?? []);
  }, []);
  useEffect(() => { (async () => { await load(); })(); }, [load]);

  const add = useCallback(async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, role }) });
      const body = (await r.json().catch(() => ({}))) as { message?: string; user?: AppUser };
      if (!r.ok) throw new Error(body.message ?? `HTTP ${r.status}`);
      setMsg({ kind: "ok", text: `${body.user?.email} habilitado como ${body.user?.role}.` });
      setEmail(""); setPassword("");
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  }, [email, password, role, load]);

  const toggle = useCallback(async (u: AppUser) => {
    await fetch("/api/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: u.email, active: !u.active }) });
    await load();
  }, [load]);

  return (
    <div className="min-h-screen bg-papel">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-grafito px-4 py-2 text-white">
        <div className="flex items-center gap-3 pr-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/elog-logo-white.svg" alt="ELOG" width={100} height={30} className="h-[30px] w-auto" />
          <span className="t-etiqueta text-white/70">Usuarios</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Link href="/" className="btn btn-ghost">Ver mapa</Link>
          <form method="post" action="/api/logout"><button className="btn btn-ghost">Salir</button></form>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="t-h3 text-carbon">Usuarios habilitados</h1>
        {forbidden ? (
          <p className="mt-3 text-rojo">Necesitás permiso de administrador para ver esta página.</p>
        ) : (
          <>
            <p className="mt-1 text-gris-700">Habilitá a alguien con su email y una contraseña (mínimo 8 caracteres). Puede ingresar al toque; no hace falta redeploy.</p>
            <section className="card mt-6 p-6">
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
                <label className="flex flex-col gap-1"><span className="t-etiqueta text-gris-700">Email</span>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="field" data-testid="user-email" placeholder="persona@empresa.com" /></label>
                <label className="flex flex-col gap-1"><span className="t-etiqueta text-gris-700">Contraseña</span>
                  <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} className="field" data-testid="user-password" placeholder="mínimo 8 caracteres" /></label>
                <label className="flex flex-col gap-1"><span className="t-etiqueta text-gris-700">Rol</span>
                  <select value={role} onChange={(e) => setRole(e.target.value)} className="field" data-testid="user-role"><option value="viewer">Viewer</option><option value="admin">Admin</option></select></label>
                <button className="btn btn-primary px-5 py-2.5" disabled={busy || !email || password.length < 8} onClick={add} data-testid="user-add">Habilitar</button>
              </div>
              {msg ? <p className={`mt-3 text-[13px] ${msg.kind === "ok" ? "text-verde" : "text-rojo"}`} data-testid="user-msg">{msg.text}</p> : null}
            </section>

            <div className="card mt-6 overflow-hidden">
              <table className="w-full text-[13px]">
                <thead className="bg-papel text-left text-gris-700"><tr><th className="px-4 py-2 font-medium">Email</th><th className="px-4 py-2 font-medium">Rol</th><th className="px-4 py-2 font-medium">Alta</th><th className="px-4 py-2 font-medium">Estado</th><th className="px-4 py-2"></th></tr></thead>
                <tbody data-testid="user-table">
                  {(users ?? []).map((u) => (
                    <tr key={u.email} className="border-t border-gris-200 text-carbon">
                      <td className="px-4 py-2">{u.email}</td>
                      <td className="px-4 py-2">{u.role === "admin" ? "Admin" : "Viewer"}</td>
                      <td className="px-4 py-2 text-gris-700">{new Date(u.created_at).toLocaleDateString("es-AR")}</td>
                      <td className="px-4 py-2">{u.active ? <span className="text-verde">Activo</span> : <span className="text-gris-700">Inactivo</span>}</td>
                      <td className="px-4 py-2 text-right"><button className="btn btn-light" onClick={() => toggle(u)}>{u.active ? "Desactivar" : "Reactivar"}</button></td>
                    </tr>
                  ))}
                  {users && users.length === 0 ? <tr><td colSpan={5} className="px-4 py-4 text-gris-700">Todavía no hay usuarios en la tabla (los del entorno siguen funcionando).</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
