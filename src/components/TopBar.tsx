"use client";

import Link from "next/link";
import { useState } from "react";
import { METRICS } from "@/lib/metrics";
import { zoneLabel } from "@/lib/hexes";
import type { SellersResponse } from "@/lib/types";

type Props = {
  data: SellersResponse | null;
  metricId: string;
  onMetric: (id: string) => void;
  enabledKinds: Set<string>;
  onToggleKind: (kind: string) => void;
  catchmentK: number;
  onCatchment: (k: number) => void;
};

/**
 * Barra superior en Grafito (aplicación preferente del manual). Responsive:
 * en escritorio los controles y la navegación van en línea; en móvil se pliegan
 * en "Filtros" (controles del mapa) y "Menú" (navegación). Cada control existe una
 * sola vez en el DOM y se reordena por CSS, no se duplica.
 */
export function TopBar({ data, metricId, onMetric, enabledKinds, onToggleKind, catchmentK, onCatchment }: Props) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const latest = data?.batches?.[0];
  const reviewCount = data && data.stats.open_reviews > 0 ? ` (${data.stats.open_reviews})` : "";

  return (
    <header className="bg-grafito text-white shadow-ctrl">
      {/* Fila 1: marca + navegación (una sola nav, se reordena a pantalla completa en móvil) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-[var(--gutter)] py-2 lg:px-[var(--gutter-lg)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/elog-logo-white.svg" alt="ELOG" width={100} height={30} className="h-[var(--size-logo)] w-auto" />
        <span className="t-etiqueta hidden text-white/70 sm:block">Mapa de sellers · AMBA</span>

        <div className="ml-auto flex items-center gap-2">
          {data ? (
            <span
              className="t-dato hidden text-white/80 lg:block"
              data-testid="stats"
              title={latest ? `Último archivo: ${latest.filename}, ${new Date(latest.created_at).toLocaleDateString("es-AR")}` : undefined}
            >
              {data.stats.total} filas · {data.stats.located} ubicadas · {data.stats.open_reviews} a revisar
            </span>
          ) : <span className="hidden text-white/60 lg:block">Cargando…</span>}
          {data?.viewer ? <span className="hidden text-white/80 lg:block">{data.viewer}</span> : null}

          <button type="button" className="btn btn-ghost md:hidden" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>Filtros</button>
          <button type="button" className="btn btn-ghost md:hidden" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>Menú</button>
        </div>

        <nav className={`${menuOpen ? "flex" : "hidden"} w-full flex-col items-stretch gap-2 max-md:order-last md:flex md:w-auto md:flex-row md:items-center`}>
          {data ? <span className="t-meta text-white/80 md:hidden">{data.stats.total} filas · {data.stats.located} ubicadas · {data.stats.open_reviews} a revisar</span> : null}
          {data?.viewer ? <span className="t-meta text-white/70 md:hidden">{data.viewer}</span> : null}
          <Link href="/revisar" className="btn btn-ghost text-center" data-testid="review-link">Revisar{reviewCount}</Link>
          <Link href="/importar" className="btn btn-ghost text-center" data-testid="import-link">Importar</Link>
          {data?.viewer_role === "admin" ? <Link href="/usuarios" className="btn btn-ghost text-center" data-testid="users-link">Usuarios</Link> : null}
          <form method="post" action="/api/logout" className="max-md:w-full"><button className="btn btn-ghost w-full">Salir</button></form>
        </nav>
      </div>

      {/* Controles del mapa: en línea en md+, plegables en móvil (una sola instancia) */}
      <div className={`${filtersOpen ? "flex" : "hidden"} flex-col gap-2 px-[var(--gutter)] pb-2 md:flex md:flex-row md:flex-wrap md:items-center md:gap-x-6 md:gap-y-2 md:pb-2 lg:px-[var(--gutter-lg)]`}>
        <label className="flex items-center gap-2">
          <span className="t-meta text-white/80">Métrica</span>
          <select value={metricId} onChange={(e) => onMetric(e.target.value)} className="select-dark max-md:flex-1" data-testid="metric-select">
            {METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-2" data-testid="kind-filters">
          <span className="t-meta text-white/80">Mostrar</span>
          {(data?.kinds ?? []).map((k) => (
            <label key={k.kind} className={`pill t-meta flex cursor-pointer items-center gap-2 border px-2 py-1 ${enabledKinds.has(k.kind) ? "border-white/60 bg-white/10" : "border-white/25 text-white/60"}`}>
              <input type="checkbox" className="sr-only" checked={enabledKinds.has(k.kind)} onChange={() => onToggleKind(k.kind)} />
              <span className="inline-block h-2.5 w-2.5 rounded-pill" style={{ background: k.color ?? "#A3A09E" }} />
              <span>{k.label}</span>
            </label>
          ))}
        </div>

        <label className="flex items-center gap-2">
          <span className="t-meta text-white/80" title="Cuántos hexágonos de alrededor se suman al total de la zona">Zona</span>
          <select value={catchmentK} onChange={(e) => onCatchment(Number(e.target.value))} className="select-dark max-md:flex-1" data-testid="zone-select">
            {[0, 1, 2].map((k) => <option key={k} value={k}>{zoneLabel(k)}</option>)}
          </select>
        </label>
      </div>
    </header>
  );
}
