import { useMemo, useState } from "react";
import type { MapSeller } from "@/lib/types";
import type { CellAgg } from "@/lib/hexes";

type Props = {
  cell: CellAgg | null;
  catchmentValue: number | null;
  catchmentK: number;
  metricShort: string;
  onClear: () => void;
};

/** Right-hand panel: empty prompt, hex summary grouped by door, or one seller's detail. */
export function Panel({ cell, catchmentValue, catchmentK, metricShort, onClear }: Props) {
  const [selected, setSelected] = useState<MapSeller | null>(null);

  const groups = useMemo(() => {
    if (!cell) return [];
    const byLoc = new Map<string, { address: string; locality: string | null; sellers: MapSeller[] }>();
    for (const s of cell.sellers) {
      const key = s.location_id ?? s.id;
      const g = byLoc.get(key) ?? { address: s.address_display ?? "Unknown address", locality: s.locality, sellers: [] };
      g.sellers.push(s);
      byLoc.set(key, g);
    }
    return [...byLoc.values()].sort((a, b) => b.sellers.length - a.sellers.length);
  }, [cell]);

  const localities = useMemo(() => {
    if (!cell) return "";
    const counts = new Map<string, number>();
    for (const s of cell.sellers) if (s.locality) counts.set(s.locality, (counts.get(s.locality) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n).join(", ");
  }, [cell]);

  if (!cell) {
    return (
      <aside className="flex h-full flex-col p-5 text-sm text-slate-600" data-testid="panel-empty">
        <p className="font-medium text-slate-800">Select an area to see its sellers.</p>
        <p className="mt-2">Hover a hex for its count. Zoom in for finer hexes and individual doors.</p>
      </aside>
    );
  }

  if (selected && cell.sellers.includes(selected)) {
    const s = selected;
    return (
      <aside className="flex h-full flex-col overflow-y-auto p-5 text-sm" data-testid="panel-seller">
        <button onClick={() => setSelected(null)} className="mb-3 self-start text-xs text-slate-500 hover:text-slate-800">← Back to list</button>
        <h2 className="text-base font-semibold text-slate-900">{s.name}</h2>
        <p className="text-xs text-slate-500">{s.kind_label} · id {s.external_id}</p>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-slate-500">Address</dt><dd>{s.address_display ?? "—"}</dd>
          <dt className="text-slate-500">Locality</dt><dd>{[s.locality, s.partido].filter(Boolean).join(" · ") || "—"}</dd>
          <dt className="text-slate-500">Province</dt><dd>{s.province ?? "—"}{s.postal_code ? ` · CP ${s.postal_code}` : ""}</dd>
          {s.opening_hours ? <><dt className="text-slate-500">Hours</dt><dd>{s.opening_hours}</dd></> : null}
          {s.note_address ? <><dt className="text-amber-700">Note says</dt><dd className="text-amber-700">{s.note_address} (differs from registered address)</dd></> : null}
          <dt className="text-slate-500">Geocode</dt><dd>{s.geocode_status ?? "—"}</dd>
          <dt className="text-slate-500">Volume</dt><dd className="text-slate-400">phase 2</dd>
        </dl>
      </aside>
    );
  }

  return (
    <aside className="flex h-full flex-col overflow-hidden text-sm" data-testid="panel-cell">
      <div className="border-b border-slate-200 p-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{localities || "Selected area"}</h2>
            <p className="text-xs text-slate-500">hex {cell.cell}</p>
          </div>
          <button onClick={onClear} className="text-xs text-slate-500 hover:text-slate-800">Clear</button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat label={metricShort} value={cell.value} />
          <Stat label="doors" value={groups.length} />
          <Stat label={catchmentK ? `${metricShort} in +${catchmentK}` : "catchment"} value={catchmentK ? catchmentValue ?? 0 : null} />
        </div>
      </div>
      <ul className="flex-1 overflow-y-auto divide-y divide-slate-100" data-testid="door-list">
        {groups.map((g) => (
          <li key={g.address + g.locality} className="px-5 py-3">
            <p className="font-medium text-slate-800">{g.address} <span className="text-xs font-normal text-slate-400">{g.locality ?? ""}</span></p>
            <p className="text-xs text-slate-500">{g.sellers.length === 1 ? "1 seller" : `${g.sellers.length} sellers, 1 door`}</p>
            <ul className="mt-1.5 space-y-1">
              {g.sellers.map((s) => (
                <li key={s.id}>
                  <button onClick={() => setSelected(s)} className="w-full rounded px-2 py-1 text-left hover:bg-slate-100">
                    <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: kindColor(s.kind) }} />
                    {s.name}
                    <span className="ml-2 text-xs text-slate-400">{s.kind_label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <div className="text-lg font-semibold tabular-nums text-slate-900">{value ?? "—"}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

export function kindColor(kind: string): string {
  return kind === "dropoff_agency" ? "#2b8cbe" : kind === "partner" ? "#7a0177" : kind === "unknown" ? "#737373" : "#d7301f";
}
