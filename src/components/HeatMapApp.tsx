"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { metricById } from "@/lib/metrics";
import type { CellAgg } from "@/lib/hexes";
import type { SellersResponse } from "@/lib/types";
import { TopBar } from "./TopBar";
import { Panel } from "./Panel";

// MapLibre touches window at import time, so the map is client-only.
const MapView = dynamic(() => import("./MapView").then((m) => m.MapView), { ssr: false, loading: () => <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading map…</div> });

export function HeatMapApp() {
  const [data, setData] = useState<SellersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metricId, setMetricId] = useState("seller_count");
  const [enabledKinds, setEnabledKinds] = useState<Set<string>>(new Set(["seller", "partner", "unknown"]));
  const [catchmentK, setCatchmentK] = useState(1);
  const [selected, setSelected] = useState<{ cell: CellAgg; catchmentValue: number | null } | null>(null);
  const [res, setRes] = useState(8);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sellers")
      .then(async (r) => { if (r.status === 401) { window.location.href = "/login"; return null; } if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => { if (!cancelled && j) setData(j as SellersResponse); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, []);

  const metric = metricById(metricId);
  const visible = useMemo(() => (data?.sellers ?? []).filter((s) => enabledKinds.has(s.kind) && s.h3_r9), [data, enabledKinds]);

  const toggleKind = (k: string) => setEnabledKinds((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const onSelect = useCallback((cell: CellAgg | null, catchmentValue: number | null) => setSelected(cell ? { cell, catchmentValue } : null), []);

  // Selection refers to a cell at a given resolution; drop it when the grid changes underneath.
  const gridKey = `${res}|${metricId}|${[...enabledKinds].sort().join(",")}`;
  const [lastGridKey, setLastGridKey] = useState(gridKey);
  if (gridKey !== lastGridKey) { setLastGridKey(gridKey); setSelected(null); }

  return (
    <div className="flex h-screen flex-col">
      <TopBar data={data} metricId={metricId} onMetric={setMetricId} enabledKinds={enabledKinds} onToggleKind={toggleKind} catchmentK={catchmentK} onCatchment={setCatchmentK} />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-[7]">
          {error ? (
            <div className="flex h-full items-center justify-center p-6 text-sm text-red-700">Could not load sellers: {error}</div>
          ) : (
            <MapView sellers={visible} metric={metric} catchmentK={catchmentK} selectedCell={selected?.cell.cell ?? null} onSelect={onSelect} onResolution={setRes} />
          )}
        </div>
        <div className="w-[30%] min-w-[300px] max-w-[440px] border-l border-slate-200 bg-white">
          <Panel cell={selected?.cell ?? null} catchmentValue={selected?.catchmentValue ?? null} catchmentK={catchmentK} metricShort={metric.short} onClear={() => setSelected(null)} />
        </div>
      </div>
    </div>
  );
}
