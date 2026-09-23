"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const ReviewMap = dynamic(() => import("./ReviewMap").then((m) => m.ReviewMap), { ssr: false, loading: () => <div className="flex h-full items-center justify-center text-gris-700">Cargando mapa…</div> });

type DoorSeller = { id: string; name: string; external_id: string; unit: string | null; note_address: string | null };
type ReviewItem = {
  id: number; reason: string; payload: Record<string, unknown>; created_at: string;
  seller: { id: string; name: string; external_id: string; kind: string; unit: string | null } | null;
  location: {
    id: string; street: string | null; street_number: string | null; address_display: string | null; locality: string | null; partido: string | null;
    province: string | null; postal_code: string | null; lat: number | null; lng: number | null; geocode_status: string | null;
    address_edited: boolean; seller_count: number; sellers?: DoorSeller[];
  } | null;
};

/** correct: the door's own address is wrong (every seller there). move: some sellers are really elsewhere. */
type Form = { mode: "correct" | "move"; street: string; number: string; locality: string; province: string; postal_code: string; picked: string[] };
type Lookup = { state: "idle" | "busy" | "found" | "missing" | "error"; message?: string; display?: string };

const AMBA_CENTER: [number, number] = [-58.55, -34.62];
const REASONS: Record<string, string> = {
  geocode_failed: "Sin geolocalizar", address_conflict: "Dirección en conflicto", outside_region: "Fuera de zona",
  duplicate_id: "ID repetido en el archivo", missing_address: "Sin dirección", missing_id: "Fila sin ID",
};

/** "Zapata 5" -> street + number, for prefilling the form from a note. */
function splitDisplay(display: string): { street: string; number: string } {
  const m = display.trim().match(/^(.*?)\s+(\d+|S\/N)$/i);
  return m ? { street: m[1], number: m[2] } : { street: display.trim(), number: "" };
}

export function ReviewApp() {
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pin, setPin] = useState<[number, number]>(AMBA_CENTER);
  /** Where the pin came from: the stored door, a drag, or a Georef lookup. */
  const [pinSource, setPinSource] = useState<"existing" | "manual" | "georef">("existing");
  const [focusSeq, setFocusSeq] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  /** The card floats over the map: it can be hidden or dragged aside to reach the pin. */
  const [collapsed, setCollapsed] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const sectionRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

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

  const focus = useCallback((it: ReviewItem | null) => {
    setSelectedId(it?.id ?? null);
    setPinSource("existing");
    setNote(null);
    setForm(null);
    setLookup({ state: "idle" });
    setCollapsed(false);
    const loc = it?.location;
    setPin(loc?.lng != null && loc?.lat != null ? [loc.lng, loc.lat] : AMBA_CENTER);
    setFocusSeq((n) => n + 1);
  }, []);

  const onMove = useCallback((lng: number, lat: number) => { setPin([lng, lat]); setPinSource("manual"); }, []);

  /** Keep the pin out from under the card when the map recenters: pad the side the card covers. */
  const getInset = useCallback(() => {
    const none = { top: 0, bottom: 0, left: 0, right: 0 };
    const sec = sectionRef.current?.getBoundingClientRect();
    const card = cardRef.current?.getBoundingClientRect();
    if (!sec || !card) return none;
    // A narrow card (docked beside the map on wide screens) covers a side; a wide one covers the top or bottom.
    if (card.width < sec.width * 0.6) {
      const leftSide = card.left + card.width / 2 < sec.left + sec.width / 2;
      return leftSide ? { ...none, left: card.right - sec.left + 8 } : { ...none, right: sec.right - card.left + 8 };
    }
    const cap = sec.height * 0.7;
    if (card.top + card.height / 2 > sec.top + sec.height / 2) return { ...none, bottom: Math.min(cap, sec.bottom - card.top + 8) };
    return { ...none, top: Math.min(cap, card.bottom - sec.top + 8) };
  }, []);

  const onDragStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button, a, input, select, label")) return;
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [offset]);
  const onDragMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current, sec = sectionRef.current?.getBoundingClientRect(), card = cardRef.current?.getBoundingClientRect();
    if (!d || !sec || !card) return;
    const baseLeft = card.left - sec.left - offset.x, baseTop = card.top - sec.top - offset.y;
    // Keep at least the header inside the map area.
    const x = Math.max(-(baseLeft + card.width - 96), Math.min(sec.width - baseLeft - 96, d.ox + e.clientX - d.x));
    const y = Math.max(-baseTop, Math.min(sec.height - baseTop - 56, d.oy + e.clientY - d.y));
    setOffset({ x, y });
  }, [offset]);
  const onDragEnd = useCallback(() => { drag.current = null; }, []);

  const openForm = useCallback((mode: Form["mode"]) => {
    if (!selected) return;
    const loc = selected.location;
    const me = selected.seller?.id;
    const mine = loc?.sellers?.find((s) => s.id === me)?.note_address ?? null;
    // Sellers whose note names the same other address usually move together.
    const picked = me ? [me, ...(loc?.sellers ?? []).filter((s) => s.id !== me && mine && s.note_address === mine).map((s) => s.id)] : [];
    if (mode === "move" && typeof selected.payload.note_address === "string") {
      const { street, number } = splitDisplay(selected.payload.note_address);
      setForm({
        mode, street, number, picked,
        locality: typeof selected.payload.note_locality === "string" ? selected.payload.note_locality : "",
        province: typeof selected.payload.note_province === "string" ? selected.payload.note_province : "",
        postal_code: String(selected.payload.note_postal ?? ""),
      });
    } else {
      setForm({ mode, picked, street: loc?.street ?? "", number: loc?.street_number ?? "", locality: loc?.locality ?? "", province: loc?.province ?? "", postal_code: loc?.postal_code ?? "" });
    }
    setLookup({ state: "idle" });
    setNote(null);
    setCollapsed(false);
  }, [selected]);

  const search = useCallback(async () => {
    if (!form) return;
    setLookup({ state: "busy" });
    try {
      const r = await fetch("/api/geocode/lookup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      const body = (await r.json().catch(() => ({}))) as { address?: { display: string; locality: string | null; postal_code: string | null }; found?: { lat: number; lng: number; match: string | null } | null; message?: string };
      if (!r.ok) { setLookup({ state: "error", message: body.message ?? "No se pudo buscar la dirección." }); return; }
      const display = body.address ? [body.address.display, body.address.locality, body.address.postal_code ? `CP ${body.address.postal_code}` : null].filter(Boolean).join(" · ") : undefined;
      if (!body.found) { setLookup({ state: "missing", display }); return; }
      setPin([body.found.lng, body.found.lat]);
      setPinSource("georef");
      setFocusSeq((n) => n + 1);
      setLookup({ state: "found", display, message: body.found.match ?? undefined });
    } catch (e) {
      setLookup({ state: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [form]);

  const act = useCallback(async (action: "locate" | "dismiss" | "retry" | "correct" | "move_seller") => {
    if (!selected) return;
    setBusy(true);
    setNote(null);
    try {
      const payload: Record<string, unknown> = { action };
      if (action !== "dismiss" && action !== "retry") { payload.lat = pin[1]; payload.lng = pin[0]; }
      if ((action === "correct" || action === "move_seller") && form) {
        const { picked, ...address } = form;
        payload.address = address;
        payload.provider = pinSource === "georef" ? "georef" : "manual";
        if (action === "move_seller") payload.seller_ids = picked;
      }
      const r = await fetch(`/api/reviews/${selected.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = (await r.json().catch(() => ({}))) as { ok?: boolean; status?: string; message?: string };
      if (!r.ok || body.ok === false) throw new Error(body.message ?? `HTTP ${r.status}`);
      if (action === "retry" && body.status !== "ok") { setNote("No se encontró la dirección automáticamente. Corregila o ubicá el pin a mano."); return; }
      // A correction can settle several items (every review of that door): reload, then advance.
      if (action === "correct" || action === "move_seller" || action === "locate") {
        const r2 = await fetch("/api/reviews", { cache: "no-store" });
        const next = r2.ok ? ((await r2.json()) as { reviews: ReviewItem[] }).reviews : (items ?? []).filter((i) => i.id !== selected.id);
        setItems(next);
        focus(next[0] ?? null);
        return;
      }
      const next = (items ?? []).filter((i) => i.id !== selected.id);
      setItems(next);
      focus(next[0] ?? null);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [selected, pin, pinSource, form, items, focus]);

  const grouped = useMemo(() => {
    const g = new Map<string, ReviewItem[]>();
    for (const it of items ?? []) { const k = it.reason; if (!g.has(k)) g.set(k, []); g.get(k)!.push(it); }
    return [...g.entries()];
  }, [items]);

  const focusKey = `${selected?.id ?? "none"}:${focusSeq}`;
  const hasCoords = selected?.location?.lat != null && selected?.location?.lng != null;
  // The stored pin is only good for the same door. Moving a seller to another address needs a new one.
  const pinReady = pinSource !== "existing" || (hasCoords && form?.mode !== "move");
  const conflict = selected?.reason === "address_conflict";
  const shared = selected?.location?.seller_count ?? 0;
  const doorSellers = selected?.location?.sellers ?? [];
  const registered = selected?.location?.address_display ?? "el domicilio registrado";
  const moveCount = form?.mode === "move" ? form.picked.length : 0;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 bg-grafito px-4 py-2 text-white">
        <div className="flex items-center gap-2 pr-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/elog-logo-white.svg" alt="ELOG" width={100} height={30} className="h-[var(--size-logo)] w-auto" />
          <span className="t-etiqueta text-white/70">Revisar domicilios</span>
        </div>
        <span className="t-dato text-white/80" data-testid="review-count">{items ? `${items.length} pendientes` : "Cargando…"}</span>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/" className="btn btn-ghost">Ver mapa</Link>
          <form method="post" action="/api/logout"><button className="btn btn-ghost">Salir</button></form>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className={`w-full overflow-auto border-gris-200 bg-white md:w-[var(--queue-w)] md:min-w-[300px] md:max-w-[var(--panel-max)] md:border-r ${selected ? "max-md:hidden" : "block"}`}>
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
                      onClick={() => focus(it)}
                      className={`block w-full border-b border-gris-200 px-4 py-2 text-left transition-colors ${selectedId === it.id ? "bg-naranja/10" : "hover:bg-papel"}`}
                      data-testid="review-row"
                    >
                      <div className="t-dato text-carbon">{it.seller?.name ?? it.location?.address_display ?? `Ítem ${it.id}`}{it.seller?.unit ? <span className="font-normal text-gris-700"> · {it.seller.unit}</span> : null}</div>
                      <div className="mt-0.5 t-meta text-gris-700">{it.location?.address_display ?? "—"}{it.location?.locality ? ` · ${it.location.locality}` : ""}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>

        <section ref={sectionRef} className={`relative min-w-0 flex-1 ${selected ? "max-md:block" : "max-md:hidden"}`}>
          {selected ? (
            <>
              <div className="absolute inset-0"><ReviewMap pin={pin} onMove={onMove} focusKey={focusKey} getInset={getInset} /></div>
              <div className="pointer-events-none absolute left-4 right-4 top-4 z-10 flex justify-center lg:justify-end">
                <div
                  ref={cardRef}
                  style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
                  className={`card pointer-events-auto flex w-full max-w-2xl flex-col shadow-pop lg:max-w-[var(--review-card-w)] ${collapsed ? "" : "max-h-[55dvh] lg:max-h-[calc(100dvh-7rem)]"}`}
                  data-testid="review-detail"
                >
                  {/* Encabezado: se arrastra para correr la tarjeta; el botón la oculta para ver el pin */}
                  <div
                    className="flex touch-none select-none items-start gap-4 border-b border-gris-200 px-4 pb-2 pt-2 md:cursor-move"
                    onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}
                    onDoubleClick={() => setOffset({ x: 0, y: 0 })}
                    title="Arrastrá para mover la tarjeta · doble clic para volver a centrarla"
                    data-testid="card-handle"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="sheet-grabber mx-auto mb-2" aria-hidden />
                      <div className="t-h3 break-words text-carbon">{selected.seller?.name ?? "Domicilio"}{selected.seller?.unit ? <span className="font-normal text-gris-700"> · {selected.seller.unit}</span> : null}</div>
                      <div className="mt-1 t-meta text-gris-700">
                        {selected.seller ? `id ${selected.seller.external_id} · ` : ""}
                        {REASONS[selected.reason] ?? selected.reason}
                        {shared > 1 ? ` · domicilio compartido por ${shared} sellers` : ""}
                        {selected.location?.address_edited ? " · dirección corregida a mano" : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 pt-4">
                      <button className="btn btn-light t-meta" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed} data-testid="card-toggle">
                        {collapsed ? "Mostrar" : "Ocultar"}
                      </button>
                      <button className="btn btn-light t-meta px-2" onClick={() => focus(null)} aria-label="Cerrar y volver a la lista" title="Cerrar" data-testid="card-close">
                        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" /></svg>
                      </button>
                    </div>
                  </div>

                  {collapsed ? (
                    <p className="px-4 py-2 t-meta text-gris-700" data-testid="card-collapsed">
                      Mové el pin en el mapa; tocá «Mostrar» para guardar. <span className="tnum">{pin[1].toFixed(5)}, {pin[0].toFixed(5)}</span>
                    </p>
                  ) : (
                  <div className="min-h-0 space-y-4 overflow-y-auto px-4 pb-4 pt-4">
                  {conflict ? (
                    <div className="grid grid-cols-1 gap-2 t-meta sm:grid-cols-2">
                      <div className="rounded-button border border-gris-200 bg-papel p-4">
                        <div className="t-etiqueta text-gris-700">Registrada</div>
                        <div className="mt-2 text-carbon">{String(selected.payload.structured ?? selected.location?.address_display ?? "—")}</div>
                        <div className="text-gris-700">CP {String(selected.payload.postal ?? selected.location?.postal_code ?? "—")}</div>
                      </div>
                      <div className="rounded-button border border-ambar/40 bg-ambar/5 p-4">
                        <div className="t-etiqueta text-ambar">En la nota</div>
                        <div className="mt-2 text-carbon">{String(selected.payload.note_address ?? "—")}</div>
                        <div className="text-gris-700">
                          {[typeof selected.payload.note_locality === "string" ? selected.payload.note_locality : null, `CP ${String(selected.payload.note_postal ?? "—")}`].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    </div>
                  ) : selected.reason === "duplicate_id" ? (
                    <div className="grid grid-cols-1 gap-2 t-meta sm:grid-cols-2" data-testid="duplicate-compare">
                      <div className="rounded-button border border-gris-200 bg-papel p-4">
                        <div className="t-etiqueta text-gris-700">Fila {String(selected.payload.first_row ?? "—")} (cargada)</div>
                        <div className="mt-2 text-carbon">{String(selected.payload.first_name ?? "—")}</div>
                        <div className="text-gris-700">{String(selected.payload.first_address ?? "—")}{selected.payload.first_unit ? ` · ${String(selected.payload.first_unit)}` : ""}</div>
                      </div>
                      <div className="rounded-button border border-ambar/40 bg-ambar/5 p-4">
                        <div className="t-etiqueta text-ambar">Fila {String(selected.payload.row_number ?? "—")} (no cargada)</div>
                        <div className="mt-2 text-carbon">{String(selected.payload.name ?? "—")}</div>
                        <div className="text-gris-700">{String(selected.payload.address ?? "—")}{selected.payload.unit ? ` · ${String(selected.payload.unit)}` : ""}</div>
                      </div>
                    </div>
                  ) : (
                    <p className="t-meta text-gris-700">{selected.location?.address_display ?? "Sin dirección"}{selected.location?.locality ? ` · ${selected.location.locality}` : ""}{selected.location?.postal_code ? ` (CP ${selected.location.postal_code})` : ""}</p>
                  )}

                  {!form && shared > 1 ? (
                    <details className="rounded-button border border-gris-200 px-4 py-2" data-testid="door-sellers">
                      <summary className="cursor-pointer t-meta text-carbon">Ver los {shared} sellers de este domicilio</summary>
                      <DoorSellerList sellers={doorSellers} currentId={selected.seller?.id} />
                    </details>
                  ) : null}

                  {form ? (
                    <div className="space-y-4 rounded-button border border-gris-200 p-4" data-testid="address-form">
                      {selected.seller && shared > 1 ? (
                        <fieldset className="space-y-2 t-meta">
                          <legend className="t-etiqueta mb-2 text-carbon">¿Qué está mal?</legend>
                          <label className="flex items-start gap-2">
                            <input type="radio" className="mt-1" checked={form.mode === "correct"} onChange={() => setForm({ ...form, mode: "correct" })} data-testid="mode-correct" />
                            <span><span className="text-carbon">La dirección del domicilio está mal escrita.</span> <span className="text-gris-700">Se corrige para los {shared} sellers.</span></span>
                          </label>
                          <label className="flex items-start gap-2">
                            <input type="radio" className="mt-1" checked={form.mode === "move"} onChange={() => setForm({ ...form, mode: "move" })} data-testid="mode-move" />
                            <span><span className="text-carbon">Algunos sellers están en otra dirección.</span> <span className="text-gris-700">Elegí cuáles; el resto se queda en {registered}.</span></span>
                          </label>
                        </fieldset>
                      ) : (
                        <div className="t-etiqueta text-carbon">{form.mode === "move" ? `Mover a ${selected.seller?.name ?? "este seller"}` : "Corregir la dirección del domicilio"}</div>
                      )}

                      {shared > 1 ? (
                        <div className="rounded-button bg-papel px-4 py-2">
                          <div className="t-meta text-gris-700">{form.mode === "move" ? "Sellers que se mueven a la nueva dirección:" : `Cambia la dirección de estos ${shared} sellers:`}</div>
                          <DoorSellerList
                            sellers={doorSellers} currentId={selected.seller?.id}
                            picked={form.mode === "move" ? form.picked : undefined}
                            onToggle={form.mode === "move" ? (id) => setForm({ ...form, picked: form.picked.includes(id) ? form.picked.filter((x) => x !== id) : [...form.picked, id] }) : undefined}
                          />
                        </div>
                      ) : null}

                      <div className="grid grid-cols-6 gap-x-2 gap-y-4">
                        <label className="col-span-4 t-meta text-gris-700">Calle<input className="field mt-1 w-full" value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} data-testid="addr-street" /></label>
                        <label className="col-span-2 t-meta text-gris-700">Número<input className="field mt-1 w-full" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="S/N" data-testid="addr-number" /></label>
                        <label className="col-span-6 t-meta text-gris-700">Localidad / barrio<input className="field mt-1 w-full" value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })} data-testid="addr-locality" /></label>
                        <label className="col-span-2 t-meta text-gris-700">CP<input className="field mt-1 w-full" value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} inputMode="numeric" data-testid="addr-postal" /></label>
                        <label className="col-span-4 t-meta text-gris-700">Provincia
                          <select className="field mt-1 w-full" value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })}>
                            <option value="">Según el CP</option><option value="CABA">CABA</option><option value="Buenos Aires">Buenos Aires</option>
                          </select>
                        </label>
                      </div>
                      {!form.locality.trim() ? (
                        <p className="t-micro text-ambar" data-testid="locality-hint">Sin localidad, la búsqueda puede encontrar la misma calle en otro partido. Completala si la sabés.</p>
                      ) : null}

                      {lookup.state !== "idle" ? (
                        <p className={`t-meta ${lookup.state === "found" ? "text-verde" : lookup.state === "busy" ? "text-gris-700" : "text-ambar"}`} data-testid="lookup-note">
                          {lookup.state === "busy" ? "Buscando…"
                            : lookup.state === "found" ? `Encontrada${lookup.message ? `: ${lookup.message}` : ""}. Revisá que sea la localidad correcta y ajustá el pin si hace falta.`
                            : lookup.state === "missing" ? "No la encontramos automáticamente. Ubicá el pin a mano y guardá."
                            : lookup.message}
                          {lookup.display && lookup.state !== "busy" ? <span className="mt-1 block text-gris-700">Se guarda como: {lookup.display}</span> : null}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-2">
                        <button className="btn btn-light" disabled={busy || lookup.state === "busy" || !form.street.trim()} onClick={search} data-testid="addr-search">Buscar en el mapa</button>
                        <button
                          className="btn btn-primary"
                          disabled={busy || !form.street.trim() || !pinReady || (form.mode === "move" && moveCount === 0)}
                          onClick={() => act(form.mode === "move" ? "move_seller" : "correct")}
                          data-testid="addr-save"
                        >
                          {form.mode === "move" ? (moveCount > 1 ? `Mover ${moveCount} sellers acá` : "Mover este seller acá") : "Guardar dirección y ubicación"}
                        </button>
                        <button className="btn btn-light" disabled={busy} onClick={() => { setForm(null); setLookup({ state: "idle" }); }}>Cancelar</button>
                      </div>
                      {!pinReady ? <p className="t-micro text-gris-700" data-testid="save-hint">Para guardar, buscá la dirección en el mapa o mové el pin a mano.</p> : null}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="t-meta text-gris-700">
                        {conflict ? "¿Dónde está realmente? Usá la de la nota, corregí la registrada, o confirmá que la registrada es correcta."
                          : selected.location ? "Corregí la dirección si está mal escrita, o arrastrá el pin sobre la puerta real y guardá." : "Este ítem no tiene domicilio para ubicar."}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {selected.location ? <button className="btn btn-primary" disabled={busy || pinSource === "existing"} onClick={() => act("locate")} data-testid="save-location" title={pinSource === "existing" ? "Mové el pin para habilitar" : ""}>Guardar pin acá</button> : null}
                        {conflict && selected.seller ? <button className="btn btn-light" disabled={busy} onClick={() => openForm("move")} data-testid="use-note">Usar la de la nota</button> : null}
                        {selected.location ? <button className="btn btn-light" disabled={busy} onClick={() => openForm("correct")} data-testid="edit-address">{conflict ? "Corregir la registrada" : "Corregir dirección"}</button> : null}
                        {!conflict && selected.location ? <button className="btn btn-light" disabled={busy} onClick={() => act("retry")} title="Vuelve a buscar el mismo texto; sirve si el servicio no respondió">Reintentar automático</button> : null}
                        <button className="btn btn-light" disabled={busy} onClick={() => act("dismiss")} data-testid="dismiss">{conflict ? "La registrada es correcta" : selected.reason === "duplicate_id" ? "Entendido" : "Descartar"}</button>
                      </div>
                    </div>
                  )}
                  <div className="tnum t-micro text-gris-700">{pin[1].toFixed(5)}, {pin[0].toFixed(5)}{pinSource === "georef" ? " · Georef" : pinSource === "manual" ? " · a mano" : ""}</div>
                  {note ? <p className="t-meta text-rojo" data-testid="review-note">{note}</p> : null}
                  </div>
                  )}
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

/** Who shares the door: read-only, or with checkboxes to choose who moves. The item's own seller always moves. */
function DoorSellerList({ sellers, currentId, picked, onToggle }: { sellers: DoorSeller[]; currentId?: string; picked?: string[]; onToggle?: (id: string) => void }) {
  return (
    <ul className="mt-2 space-y-2 t-meta" data-testid="door-seller-list">
      {sellers.map((s) => {
        const row = (
          <>
            <span className="text-carbon">{s.name}</span>
            {s.unit ? <span className="text-gris-700"> · {s.unit}</span> : null}
            {s.id === currentId ? <span className="text-gris-700"> (este)</span> : null}
            <span className="block t-micro text-gris-700">
              id {s.external_id}{s.note_address ? <span className="text-ambar"> · nota: {s.note_address}</span> : null}
            </span>
          </>
        );
        return (
          <li key={s.id}>
            {onToggle && picked ? (
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={picked.includes(s.id)} disabled={s.id === currentId} onChange={() => onToggle(s.id)} data-testid="door-seller-pick" />
                <span>{row}</span>
              </label>
            ) : <div className="pl-4">{row}</div>}
          </li>
        );
      })}
    </ul>
  );
}
