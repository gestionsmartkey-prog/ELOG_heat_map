import Link from "next/link";
import { METRICS } from "@/lib/metrics";
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

/** Barra superior en Grafito con el logo en blanco, como manda el manual (aplicación preferente). */
export function TopBar({ data, metricId, onMetric, enabledKinds, onToggleKind, catchmentK, onCatchment }: Props) {
  const latest = data?.batches?.[0];
  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-grafito px-4 py-2 text-white">
      <div className="flex items-center gap-3 pr-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/elog-logo-white.svg" alt="ELOG" width={100} height={30} className="h-[30px] w-auto" />
        <span className="t-etiqueta text-white/70">Mapa de sellers · AMBA</span>
      </div>

      <label className="flex items-center gap-2">
        <span className="text-white/80">Métrica</span>
        <select value={metricId} onChange={(e) => onMetric(e.target.value)} className="select-dark" data-testid="metric-select">
          {METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>

      <div className="flex items-center gap-3" data-testid="kind-filters">
        <span className="text-white/80">Mostrar</span>
        {(data?.kinds ?? []).map((k) => (
          <label key={k.kind} className={`pill flex cursor-pointer items-center gap-1.5 border px-2 py-0.5 text-[13px] ${enabledKinds.has(k.kind) ? "border-white/60 bg-white/10" : "border-white/25 text-white/60"}`}>
            <input type="checkbox" className="sr-only" checked={enabledKinds.has(k.kind)} onChange={() => onToggleKind(k.kind)} />
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: k.color ?? "#A3A09E" }} />
            <span>{k.label}</span>
          </label>
        ))}
      </div>

      <label className="flex items-center gap-2">
        <span className="text-white/80">Alcance</span>
        <select value={catchmentK} onChange={(e) => onCatchment(Number(e.target.value))} className="select-dark">
          <option value={0}>solo el hexágono</option>
          <option value={1}>+1 anillo</option>
          <option value={2}>+2 anillos</option>
        </select>
      </label>

      <div className="ml-auto flex items-center gap-4">
        {data ? (
          <span className="t-dato text-white/80" data-testid="stats" title={latest ? `Último archivo: ${latest.filename}, ${new Date(latest.created_at).toLocaleDateString("es-AR")}` : undefined}>
            {data.stats.total} filas · {data.stats.located} ubicadas · {data.stats.open_reviews} a revisar
          </span>
        ) : <span className="text-white/60">Cargando…</span>}
        {data?.viewer ? <span className="text-white/80">{data.viewer}</span> : null}
        <Link href="/revisar" className="btn btn-ghost" data-testid="review-link">Revisar{data && data.stats.open_reviews > 0 ? ` (${data.stats.open_reviews})` : ""}</Link>
        <Link href="/importar" className="btn btn-ghost" data-testid="import-link">Importar</Link>
        {data?.viewer_role === "admin" ? <Link href="/usuarios" className="btn btn-ghost" data-testid="users-link">Usuarios</Link> : null}
        <form method="post" action="/api/logout"><button className="btn btn-ghost">Salir</button></form>
      </div>
    </header>
  );
}
