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

export function TopBar({ data, metricId, onMetric, enabledKinds, onToggleKind, catchmentK, onCatchment }: Props) {
  const latest = data?.batches?.[0];
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-200 bg-white px-4 py-2 text-sm">
      <div className="flex items-baseline gap-2">
        <h1 className="text-base font-semibold text-slate-900">Seller heat map</h1>
        <span className="text-xs text-slate-500">AMBA · hub planning</span>
      </div>

      <label className="flex items-center gap-2">
        <span className="text-slate-600">Metric</span>
        <select value={metricId} onChange={(e) => onMetric(e.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm" data-testid="metric-select">
          {METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>

      <div className="flex items-center gap-3" data-testid="kind-filters">
        <span className="text-slate-600">Show</span>
        {(data?.kinds ?? []).map((k) => (
          <label key={k.kind} className="flex items-center gap-1.5">
            <input type="checkbox" checked={enabledKinds.has(k.kind)} onChange={() => onToggleKind(k.kind)} />
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: k.color ?? "#999" }} />
            <span>{k.label}</span>
          </label>
        ))}
      </div>

      <label className="flex items-center gap-2">
        <span className="text-slate-600">Catchment</span>
        <select value={catchmentK} onChange={(e) => onCatchment(Number(e.target.value))} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm">
          <option value={0}>hex only</option>
          <option value={1}>+1 ring</option>
          <option value={2}>+2 rings</option>
        </select>
      </label>

      <div className="ml-auto flex items-center gap-4 text-xs text-slate-500">
        {data ? (
          <span data-testid="stats">
            {data.stats.total} rows · {data.stats.located} located · {data.stats.open_reviews} to review
            {latest ? ` · ${latest.filename} (${new Date(latest.created_at).toLocaleDateString()})` : ""}
          </span>
        ) : <span>Loading…</span>}
        {data?.viewer ? <span className="text-slate-600">{data.viewer}</span> : null}
        <form method="post" action="/api/logout"><button className="rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50">Sign out</button></form>
      </div>
    </header>
  );
}
