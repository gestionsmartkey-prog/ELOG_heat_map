"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BatchSummary } from "@/lib/types";

type Report = {
  row_count: number; seller_count: number; location_count: number; review_count: number;
  by_kind: Record<string, number>; by_province: Record<string, number>;
  unmapped_columns: string[]; warnings: string[];
};
type Outcome = { status: "loaded" | "dry_run" | "duplicate"; batch_id: string | null; report: Report; sheet: string; filename?: string; created_at?: string };
type Counts = { pending: number; ok: number; failed: number; review: number; manual: number };
type Pass = { counts: Counts; processed: Record<string, number>; done: boolean };

const KIND_LABELS: Record<string, string> = { seller: "Sellers", dropoff_agency: "Centros de envío", partner: "Partners", unknown: "Sin clasificar" };
const MAX_MB = 4;

/** Página de importación: un archivo por vez, reporte inmediato, geolocalización en segundo plano. */
export function ImportApp() {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("meli");
  const [busy, setBusy] = useState<"idle" | "uploading" | "geocoding">("idle");
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pass, setPass] = useState<Pass | null>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);

  const loadBatches = useCallback(async () => {
    try {
      const r = await fetch("/api/batches", { cache: "no-store" });
      if (r.status === 401) { window.location.href = "/login"; return; }
      if (r.ok) setBatches(((await r.json()) as { batches: BatchSummary[] }).batches ?? []);
    } catch { /* history is informational */ }
  }, []);

  const loadCounts = useCallback(async () => {
    try {
      const r = await fetch("/api/geocode", { cache: "no-store" });
      if (r.ok) setPass({ counts: ((await r.json()) as { counts: Counts }).counts, processed: {}, done: true });
    } catch { /* informational */ }
  }, []);

  useEffect(() => {
    cancelRef.current = false;
    // Initial history + tally; state is only set after the responses arrive.
    (async () => { await Promise.all([loadBatches(), loadCounts()]); })();
    return () => { cancelRef.current = true; };
  }, [loadBatches, loadCounts]);

  /** Drive the database geocoder until nothing is pending. Each call is time-boxed server-side. */
  const geocode = useCallback(async (retry = false) => {
    setBusy("geocoding");
    setError(null);
    cancelRef.current = false;
    try {
      let first = true;
      for (;;) {
        if (cancelRef.current) break;
        const r = await fetch(`/api/geocode${first && retry ? "?retry=1" : ""}`, { method: "POST" });
        first = false;
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { message?: string }).message ?? `HTTP ${r.status}`);
        const p = (await r.json()) as Pass;
        setPass((prev) => ({ ...p, processed: mergeCounts(prev?.processed ?? {}, p.processed) }));
        if (p.done) break;
      }
    } catch (e) {
      setError(`La geolocalización se interrumpió: ${e instanceof Error ? e.message : String(e)}. Podés reintentar.`);
    } finally {
      setBusy("idle");
      void loadBatches();
    }
  }, [loadBatches]);

  const submit = useCallback(async (force = false) => {
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) { setError(`El archivo supera los ${MAX_MB} MB.`); return; }
    setBusy("uploading");
    setError(null);
    setOutcome(null);
    setPass(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("source", source);
    if (force) fd.set("force", "1");
    try {
      const r = await fetch("/api/import", { method: "POST", body: fd });
      if (r.status === 401) { window.location.href = "/login"; return; }
      const body = (await r.json().catch(() => ({}))) as Outcome & { message?: string };
      if (r.status === 409) { setOutcome(body); setBusy("idle"); return; }
      if (!r.ok) throw new Error(body.message ?? `HTTP ${r.status}`);
      setOutcome(body);
      await loadBatches();
      if (body.status === "loaded") await geocode(false); else setBusy("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy("idle");
    }
  }, [file, source, geocode, loadBatches]);

  const pick = (f: File | null | undefined) => { setFile(f ?? null); setOutcome(null); setError(null); };
  const report = outcome?.report;
  const counts = pass?.counts;
  const geocodeTotal = counts ? counts.pending + counts.ok + counts.failed + counts.review + counts.manual : 0;

  return (
    <div className="min-h-screen bg-papel">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-grafito px-4 py-2 text-white">
        <div className="flex items-center gap-3 pr-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/elog-logo-white.svg" alt="ELOG" width={100} height={30} className="h-[30px] w-auto" />
          <span className="t-etiqueta text-white/70">Importar sellers</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Link href="/" className="btn btn-ghost">Ver mapa</Link>
          <form method="post" action="/api/logout"><button className="btn btn-ghost">Salir</button></form>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="t-h3 text-carbon">Importar un archivo de sellers</h1>
        <p className="mt-1 text-gris-700">Subí el export tal cual llega (.xlsx, .xls o .csv, hasta {MAX_MB} MB). Las columnas se reconocen solas; lo que no se reconoce se guarda igual. Después del alta, las direcciones nuevas se geolocalizan acá mismo.</p>

        <section className="card mt-6 p-6">
          <div
            data-testid="dropzone"
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0]); }}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-[8px] border-2 border-dashed px-6 py-10 text-center transition-colors ${dragging ? "border-naranja bg-naranja/5" : "border-gris-400 hover:border-grafito"}`}
          >
            <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="sr-only" data-testid="file-input" onChange={(e) => pick(e.target.files?.[0])} />
            {file ? (
              <>
                <div className="t-dato text-carbon" data-testid="file-name">{file.name}</div>
                <div className="mt-1 text-gris-700">{(file.size / 1024).toFixed(0)} KB · hacé clic para cambiarlo</div>
              </>
            ) : (
              <>
                <div className="t-dato text-carbon">Arrastrá el archivo acá</div>
                <div className="mt-1 text-gris-700">o hacé clic para elegirlo</div>
              </>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1">
              <span className="t-etiqueta text-gris-700">Origen</span>
              <select value={source} onChange={(e) => setSource(e.target.value)} className="field" data-testid="source-select">
                <option value="meli">Mercado Libre</option>
                <option value="otro">Otro</option>
              </select>
            </label>
            <button type="button" className="btn btn-primary px-5 py-2.5" disabled={!file || busy !== "idle"} onClick={() => submit(false)} data-testid="import-button">
              {busy === "uploading" ? "Importando…" : "Importar"}
            </button>
            {busy === "geocoding" ? <span className="text-gris-700">Geolocalizando en segundo plano…</span> : null}
          </div>
          {error ? <p className="mt-4 text-rojo" role="alert" data-testid="import-error">{error}</p> : null}
        </section>

        {outcome?.status === "duplicate" ? (
          <section className="card mt-6 border-ambar/60 p-6" data-testid="duplicate-notice">
            <div className="t-dato text-carbon">Este archivo ya fue importado</div>
            <p className="mt-1 text-gris-700">Es idéntico a «{outcome.filename}» cargado el {fmtDate(outcome.created_at)}. No se cargó nada nuevo.</p>
            <button type="button" className="btn btn-light mt-4" onClick={() => submit(true)} disabled={busy !== "idle"}>Importar de todos modos</button>
          </section>
        ) : null}

        {report && outcome?.status !== "duplicate" ? (
          <section className="card mt-6 p-6" data-testid="import-report">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="t-h3 text-carbon">{outcome?.status === "dry_run" ? "Vista previa (sin cargar)" : "Archivo cargado"}</h2>
              <span className="text-gris-700">hoja «{outcome?.sheet}»</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile value={report.row_count} label="Filas" />
              <Tile value={report.seller_count} label="Sellers" />
              <Tile value={report.location_count} label="Domicilios" />
              <Tile value={report.review_count} label="A revisar" tone={report.review_count ? "ambar" : undefined} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(report.by_kind).map(([k, n]) => (
                <span key={k} className="pill border border-gris-200 bg-papel px-3 py-1 text-[13px] text-carbon"><span className="tnum font-semibold">{n}</span> {KIND_LABELS[k] ?? k}</span>
              ))}
              {Object.entries(report.by_province).map(([k, n]) => (
                <span key={k} className="pill border border-gris-200 px-3 py-1 text-[13px] text-gris-700"><span className="tnum font-semibold">{n}</span> {k}</span>
              ))}
            </div>
            {report.unmapped_columns.length ? (
              <p className="mt-4 text-gris-700">Columnas guardadas sin mapear: {report.unmapped_columns.join(", ")}.</p>
            ) : null}
            {report.warnings.length ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-gris-700">{report.warnings.length} avisos</summary>
                <ul className="mt-2 max-h-48 list-disc overflow-auto pl-5 text-[13px] text-gris-700">{report.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </details>
            ) : null}
          </section>
        ) : null}

        {counts && geocodeTotal > 0 ? (
          <section className="card mt-6 p-6" data-testid="geocode-status">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="t-h3 text-carbon">Geolocalización</h2>
              <span className="tnum text-gris-700">{counts.ok + counts.manual} de {geocodeTotal} domicilios ubicados</span>
            </div>
            <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-[999px] bg-gris-200" aria-hidden="true">
              <div className="bg-verde" style={{ width: `${((counts.ok + counts.manual) / geocodeTotal) * 100}%` }} />
              <div className="bg-ambar" style={{ width: `${(counts.review / geocodeTotal) * 100}%` }} />
              <div className="bg-rojo" style={{ width: `${(counts.failed / geocodeTotal) * 100}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-gris-700">
              <span><Dot c="var(--color-verde)" /> {counts.ok + counts.manual} ubicados</span>
              <span><Dot c="var(--color-ambar)" /> {counts.review} fuera de zona</span>
              <span><Dot c="var(--color-rojo)" /> {counts.failed} sin resolver</span>
              <span><Dot c="var(--color-gris-400)" /> {counts.pending} pendientes</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              {counts.pending > 0 && busy === "idle" ? <button type="button" className="btn btn-primary" onClick={() => geocode(false)}>Continuar geolocalizando</button> : null}
              {counts.failed + counts.review > 0 && busy === "idle" ? <button type="button" className="btn btn-light" onClick={() => geocode(true)}>Reintentar {counts.failed + counts.review} sin resolver</button> : null}
              {busy === "geocoding" ? <button type="button" className="btn btn-light" onClick={() => { cancelRef.current = true; }}>Pausar</button> : null}
              {busy === "idle" && outcome?.status === "loaded" ? <Link href="/" className="btn btn-light">Ver en el mapa</Link> : null}
            </div>
          </section>
        ) : null}

        <section className="mt-8">
          <h2 className="t-etiqueta text-gris-700">Historial de importaciones</h2>
          {batches.length ? (
            <div className="card mt-3 overflow-hidden">
              <table className="w-full text-[13px]" data-testid="batch-table">
                <thead className="bg-papel text-left text-gris-700">
                  <tr><th className="px-4 py-2 font-medium">Archivo</th><th className="px-4 py-2 font-medium">Fecha</th><th className="px-4 py-2 text-right font-medium">Filas</th><th className="px-4 py-2 text-right font-medium">Cargados</th><th className="px-4 py-2 text-right font-medium">A revisar</th><th className="px-4 py-2 font-medium">Estado</th></tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id} className="border-t border-gris-200 text-carbon">
                      <td className="max-w-[260px] truncate px-4 py-2" title={b.filename}>{b.filename}</td>
                      <td className="px-4 py-2 text-gris-700">{fmtDate(b.created_at)}</td>
                      <td className="tnum px-4 py-2 text-right">{b.row_count}</td>
                      <td className="tnum px-4 py-2 text-right">{b.loaded_count}</td>
                      <td className="tnum px-4 py-2 text-right">{b.review_count}</td>
                      <td className="px-4 py-2"><Status s={b.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="mt-2 text-gris-700">Todavía no hay importaciones.</p>}
        </section>
      </main>
    </div>
  );
}

function Tile({ value, label, tone }: { value: number; label: string; tone?: "ambar" }) {
  return (
    <div className="rounded-[8px] border border-gris-200 bg-papel px-4 py-3">
      <div className={`t-display tnum text-[26px] ${tone === "ambar" ? "text-ambar" : "text-carbon"}`}>{value}</div>
      <div className="t-etiqueta mt-1 text-gris-700">{label}</div>
    </div>
  );
}

function Dot({ c }: { c: string }) {
  return <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: c }} />;
}

function Status({ s }: { s: string }) {
  const map: Record<string, [string, string]> = { loaded: ["Cargado", "text-verde"], loading: ["Cargando", "text-ambar"], failed: ["Falló", "text-rojo"], pending: ["Pendiente", "text-gris-700"] };
  const [label, cls] = map[s] ?? [s, "text-gris-700"];
  return <span className={`pill border border-current px-2 py-0.5 text-[12px] ${cls}`}>{label}</span>;
}

function fmtDate(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

function mergeCounts(a: Record<string, number>, b: Record<string, number>) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}
