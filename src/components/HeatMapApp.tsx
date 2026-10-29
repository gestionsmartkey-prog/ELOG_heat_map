"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { metricById } from "@/lib/metrics";
import { PROSPECT_SOURCES, isApproximate, matchesAttrs, type AttrSelection } from "@/lib/layers";
import type { CellAgg } from "@/lib/hexes";
import type { SellersResponse } from "@/lib/types";
import { TopBar } from "./TopBar";
import { Panel } from "./Panel";

// MapLibre touches window at import time, so the map is client-only.
const MapView = dynamic(() => import("./MapView").then((m) => m.MapView), { ssr: false, loading: () => <div className="flex h-full items-center justify-center text-gris-700">Cargando mapa…</div> });

export function HeatMapApp() {
  const [data, setData] = useState<SellersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metricId, setMetricId] = useState("seller_count");
  const [enabledKinds, setEnabledKinds] = useState<Set<string>>(new Set(["seller", "partner", "unknown"]));
  // null = nobody touched it: every source is on except the prospect ones, which stay off until asked for.
  const [pickedSources, setPickedSources] = useState<Set<string> | null>(null);
  const [attrSel, setAttrSel] = useState<AttrSelection>({});
  const [catchmentK, setCatchmentK] = useState(1);
  const [selected, setSelected] = useState<{ cell: CellAgg; catchmentValue: number | null } | null>(null);
  const [res, setRes] = useState(8);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sellers", { cache: "no-store" })
      .then(async (r) => { if (r.status === 401) { window.location.href = "/login"; return null; } if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => { if (!cancelled && j) setData(j as SellersResponse); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, []);

  const metric = metricById(metricId);
  const sources = useMemo(() => [...new Set((data?.sellers ?? []).map((s) => s.source))].sort(), [data]);
  const enabledSources = useMemo(() => pickedSources ?? new Set(sources.filter((s) => !PROSPECT_SOURCES.includes(s))), [pickedSources, sources]);
  // Attribute filters narrow the prospect files; sellers from other sources are never hidden by them.
  const filtered = useMemo(
    () => (data?.sellers ?? []).filter((s) => enabledKinds.has(s.kind) && enabledSources.has(s.source) && s.h3_r9 && (!PROSPECT_SOURCES.includes(s.source) || matchesAttrs(s, attrSel))),
    [data, enabledKinds, enabledSources, attrSel],
  );
  const visible = useMemo(() => filtered.filter((s) => !isApproximate(s)), [filtered]);
  const approxVisible = useMemo(() => filtered.filter(isApproximate), [filtered]);

  const toggleSource = (src: string) => setPickedSources(() => { const n = new Set(enabledSources); if (n.has(src)) n.delete(src); else n.add(src); return n; });
  const toggleAttr = (key: string, value: string) => setAttrSel((prev) => { const n = new Set(prev[key] ?? []); if (n.has(value)) n.delete(value); else n.add(value); return { ...prev, [key]: n }; });
  const toggleKind = (k: string) => setEnabledKinds((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const onSelect = useCallback((cell: CellAgg | null, catchmentValue: number | null) => setSelected(cell ? { cell, catchmentValue } : null), []);

  // Selection refers to a cell at a given resolution; drop it when the grid changes underneath.
  const gridKey = `${res}|${metricId}|${[...enabledKinds].sort().join(",")}|${[...enabledSources].sort().join(",")}|${JSON.stringify(Object.entries(attrSel).map(([k, v]) => [k, [...v].sort()]))}`;
  const [lastGridKey, setLastGridKey] = useState(gridKey);
  if (gridKey !== lastGridKey) { setLastGridKey(gridKey); setSelected(null); }

  return (
    <div className="flex h-[100dvh] flex-col">
      <TopBar data={data} metricId={metricId} onMetric={setMetricId} enabledKinds={enabledKinds} onToggleKind={toggleKind} sources={sources} enabledSources={enabledSources} onToggleSource={toggleSource} attrSel={attrSel} onToggleAttr={toggleAttr} catchmentK={catchmentK} onCatchment={setCatchmentK} />
      <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative min-h-0 min-w-0 flex-1">
          {error ? (
            <div className="flex h-full items-center justify-center p-[var(--gutter)] text-center text-rojo">No se pudieron cargar los sellers: {error}</div>
          ) : (
            <MapView sellers={visible} approxSellers={approxVisible} metric={metric} catchmentK={catchmentK} selectedCell={selected?.cell.cell ?? null} onSelect={onSelect} onResolution={setRes} />
          )}
        </div>
        {/* Panel: barra lateral en md+, hoja inferior en móvil (solo cuando hay selección). */}
        <div
          className={`flex flex-col bg-white md:w-[var(--panel-w)] md:min-w-[var(--panel-min)] md:max-w-[var(--panel-max)] md:border-l md:border-gris-200 max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:h-[var(--panel-sheet-max)] max-md:rounded-t-card max-md:border-t max-md:border-gris-200 max-md:shadow-pop ${selected ? "max-md:flex" : "max-md:hidden"}`}
        >
          <div className="flex items-center justify-center py-2 md:hidden"><span className="sheet-grabber" aria-hidden="true" /></div>
          <Panel cell={selected?.cell ?? null} catchmentValue={selected?.catchmentValue ?? null} catchmentK={catchmentK} metricShort={metric.short} onClear={() => setSelected(null)} />
        </div>
      </div>
    </div>
  );
}
