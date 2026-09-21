"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const ReviewMap = dynamic(() => import("./ReviewMap").then((m) => m.ReviewMap), { ssr: false, loading: () => <div className="flex h-full items-center justify-center text-gris-700">Cargando mapa…</div> });

type ReviewItem = {
  id: number; reason: string; payload: Record<string, unknown>; created_at: string;
  seller: { name: string; external_id: string; kind: string } | null;
  location: { id: string; address_display: string | null; locality: string | null; partido: string | null; province: string | null; postal_code: string | null; lat: number | null; lng: number | null; geocode_status: string | null } | null;
};

const AMBA_CENTER: [number, number] = [-58.55, -34.62];
const REASONS: Record<string, string> = { geocode_failed: "Sin geolocalizar", address_conflict: "Dirección en conflicto", outside_region: "Fuera de zona" };

export function ReviewApp() {
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pin, setPin] = useState<[number, number]>(AMBA_CENTER);
  const [moved, setMoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch("/api/reviews", { cache: "no-store" });
      if (r.status === 401) { window.location.href = "/login"; return; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { reviews: ReviewItem[] };
      setItems(j.reviews);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    }
  }, []);
  useEffect(() => { (async () => { await load(); })(); }, [load]);

  const selected = useMemo(() => items?.find((i) => i.id === selectedId) ?? null, [items, selectedId]);

  const select = useCallback((it: ReviewItem) => {
    setSelectedId(it.id);
    setMoved(false);
    setNote(null);
    const loc = it.location;
    setPin(loc?.lng != null && loc?.lat != null ? [loc.lng, loc.lat] : AMBA_CENTER);
  }, []);

  const onMove = useCallback((lng: number, lat: number) => { setPin([lng, lat]); setMoved(true); }, []);

  const act = useCallback(async (action: "locate" | "dismiss" | "retry") => {
    if (!selected) return;
    setBusy(true);
    setNote(null);
    try {
      const payload: Record<string, unknown> = { action };
      if (action === "locate") { payload.lat = pin[1]; payload.lng = pin[0]; }
      const r = await fetch(`/api/reviews/${selected.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = (await r.json().catch(() => ({}))) as { ok?: boolean; status?: string; message?: string };
      if (!r.ok || body.ok === false) {
        if (action === "retry" && body.status && body.status !== "ok") { setNote("No se encontró la dirección automáticamente. Ubicala a mano y guardá."); return; }
        throw new Error(body.message ?? `HTTP ${r.status}`);
      }
      // Drop the resolved item and advance to the next one.
      const next = (items ?? []).filter((i) => i.id !== selected.id);
      const following = next[0] ?? null;
      setItems(next);
      setSelectedId(following?.id ?? null);
      setMoved(false);
      const l = following?.location;
      setPin(l?.lng != null && l?.lat != null ? [l.lng, l.lat] : AMBA_CENTER);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [selected, pin, items]);

  const grouped = useMemo(() => {
    const g = new Map<string, ReviewItem[]>();
    for (const it of items ?? []) { const k = it.reason; if (!g.has(k)) g.set(k, []); g.get(k)!.push(it); }
    return [...g.entries()];
  }, [items]);

  const focusKey = `${selected?.id ?? "none"}`;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-grafito px-4 py-2 text-white">
        <div className="flex items-center gap-3 pr-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/elog-logo-white.svg" alt="ELOG" width={100} height={30} className="h-[30px] w-auto" />
          <span className="t-etiqueta text-white/70">Revisar domicilios</span>
        </div>
        <span className="t-dato text-white/80" data-testid="review-count">{items ? `${items.length} pendientes` : "Cargando…"}</span>
        <div className="ml-auto flex items-center gap-3">
          <Link href="/" className="btn btn-ghost">Ver mapa</Link>
          <form method="post" action="/api/logout"><button className="btn btn-ghost">Salir</button></form>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[34%] min-w-[320px] max-w-[460px] overflow-auto border-r border-gris-200 bg-white">
          {error ? <p className="p-4 text-rojo">No se pudo cargar la cola: {error}</p> : null}
          {items && items.length === 0 && !error ? <p className="p-6 text-gris-700">No hay domicilios pendientes de revisión. 🎉</p> : null}
          {grouped.map(([reason, list]) => (
            <div key={reason}>
              <div className="sticky top-0 flex items-center justify-between bg-papel px-4 py-2">
                <span className="t-etiqueta text-carbon">{REASONS[reason] ?? reason}</span>
                <span className="tnum text-gris-700">{list.length}</span>
              </div>
              <ul data-testid="review-list">
                {list.map((it) => (
                  <li key={it.id}>
                    <button
                      onClick={() => select(it)}
                      className={`block w-full border-b border-gris-200 px-4 py-3 text-left transition-colors ${selectedId === it.id ? "bg-naranja/10" : "hover:bg-papel"}`}
                      data-testid="review-row"
                    >
                      <div className="t-dato text-carbon">{it.seller?.name ?? it.location?.address_display ?? `Ítem ${it.id}`}</div>
                      <div className="mt-0.5 text-[13px] text-gris-700">{it.location?.address_display ?? "—"}{it.location?.locality ? ` · ${it.location.locality}` : ""}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>

        <section className="relative min-w-0 flex-1">
          {selected ? (
            <>
              <div className="absolute inset-0"><ReviewMap pin={pin} onMove={onMove} focusKey={focusKey} /></div>
              <div className="pointer-events-none absolute left-4 right-4 top-4 z-10 flex justify-center">
                <div className="card pointer-events-auto max-w-2xl p-4 shadow-[0_2px_12px_rgba(42,39,38,0.15)]" data-testid="review-detail">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="t-h3 text-carbon">{selected.seller?.name ?? "Domicilio"}</div>
                      <div className="mt-0.5 text-[13px] text-gris-700">{REASONS[selected.reason] ?? selected.reason}</div>
                    </div>
                    {selected.seller ? <span className="pill border border-gris-200 px-2 py-0.5 text-[12px] text-gris-700">{selected.seller.external_id}</span> : null}
                  </div>

                  {selected.reason === "address_conflict" ? (
                    <div className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
                      <div className="rounded-[8px] border border-gris-200 bg-papel p-3">
                        <div className="t-etiqueta text-gris-700">Registrada</div>
                        <div className="mt-1 text-carbon">{String(selected.payload.structured ?? selected.location?.address_display ?? "—")}</div>
                        <div className="text-gris-700">CP {String(selected.payload.postal ?? selected.location?.postal_code ?? "—")}</div>
                      </div>
                      <div className="rounded-[8px] border border-ambar/40 bg-ambar/5 p-3">
                        <div className="t-etiqueta text-ambar">En la nota</div>
                        <div className="mt-1 text-carbon">{String(selected.payload.note_address ?? "—")}</div>
                        <div className="text-gris-700">CP {String(selected.payload.note_postal ?? "—")}</div>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-[13px] text-gris-700">{selected.location?.address_display ?? "Sin dirección"}{selected.location?.locality ? ` · ${selected.location.locality}` : ""}{selected.location?.postal_code ? ` (CP ${selected.location.postal_code})` : ""}</p>
                  )}

                  <p className="mt-3 text-[13px] text-gris-700">Arrastrá el pin sobre la puerta real y guardá, o descartá el ítem.</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button className="btn btn-primary" disabled={busy || !moved} onClick={() => act("locate")} data-testid="save-location" title={moved ? "" : "Movés el pin para habilitar"}>Guardar acá</button>
                    {selected.reason !== "address_conflict" ? <button className="btn btn-light" disabled={busy} onClick={() => act("retry")}>Reintentar automático</button> : null}
                    <button className="btn btn-light" disabled={busy} onClick={() => act("dismiss")} data-testid="dismiss">{selected.reason === "address_conflict" ? "La registrada es correcta" : "Descartar"}</button>
                    <span className="tnum text-[12px] text-gris-700">{pin[1].toFixed(5)}, {pin[0].toFixed(5)}</span>
                  </div>
                  {note ? <p className="mt-2 text-[13px] text-rojo" data-testid="review-note">{note}</p> : null}
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-gris-700">{items && items.length ? "Elegí un domicilio de la lista." : "Nada para revisar."}</div>
          )}
        </section>
      </div>
    </div>
  );
}
