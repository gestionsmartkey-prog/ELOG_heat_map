"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { applyFilters } from "@/lib/filters";
import {
  bucketByCell,
  clusterAt,
  radiusToK,
  type Cluster,
  type Pick,
} from "@/lib/ranking";
import { countableVolume, isExact, setBands } from "@/lib/opportunity";
import { decodeView, encodeView, type ViewState } from "@/lib/viewState";
import type { MapSeller, SellersResponse } from "@/lib/types";
import { TopBar } from "./TopBar";
import { MapDock } from "./MapDock";
import { OpportunityList } from "./OpportunityList";
import { ClusterPanel } from "./ClusterPanel";
import { SellerDetail } from "./SellerDetail";
import { useRanking } from "./useRanking";

// MapLibre touches window at import time, so the map is client-only.
const MapView = dynamic(() => import("./MapView").then((m) => m.MapView), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-gris-700">
      Cargando mapa…
    </div>
  ),
});

type Selection =
  { kind: "pick"; rank: number } | { kind: "cell"; cluster: Cluster } | null;

const NO_EXCLUDED = { noData: 0, filtered: 0 };

export function HeatMapApp({ initialQuery }: { initialQuery: string }) {
  const [data, setData] = useState<SellersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewState>(() => decodeView(initialQuery));
  const [selection, setSelection] = useState<Selection>(null);
  const [seller, setSeller] = useState<MapSeller | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  // The panel starts collapsed so the map gets the full width; opening a spot expands it.
  const [panelOpen, setPanelOpen] = useState(false);
  // The map reads its start position once; later moves only update the URL.
  const [initialView] = useState(() => ({
    center: view.center,
    zoom: view.zoom,
  }));

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sellers", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 401) {
          window.location.href = "/login";
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => {
        if (cancelled || !j) return;
        // Bands first: filtering runs bandOf as soon as the data is set.
        setBands((j as SellersResponse).bands);
        setData(j as SellersResponse);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the URL in step with the view, without adding history entries.
  useEffect(() => {
    const qs = encodeView(view);
    window.history.replaceState(
      null,
      "",
      qs ? `?${qs}` : window.location.pathname,
    );
  }, [view]);

  const filtered = useMemo(
    () => (data ? applyFilters(data.sellers, view.filters) : null),
    [data, view.filters],
  );
  const ranking = useRanking(
    filtered?.kept ?? null,
    view.target,
    view.radiusKm,
    data?.bands,
  );
  const buckets = useMemo(
    () => (filtered ? bucketByCell(filtered.kept) : null),
    [filtered],
  );
  const exact = useMemo(() => filtered?.kept.filter(isExact) ?? [], [filtered]);
  // Every ranked spot gets its pin, so the map and the list always match.
  const pins = useMemo(() => ranking?.picks ?? [], [ranking]);

  // A change of target, radius or filters invalidates what is open in the panel.
  const viewKey = `${view.target}|${view.radiusKm}|${JSON.stringify(view.filters)}`;
  const [lastKey, setLastKey] = useState(viewKey);
  if (viewKey !== lastKey) {
    setLastKey(viewKey);
    setSelection(null);
    setSeller(null);
  }

  const pick: Pick | null =
    selection?.kind === "pick"
      ? (ranking?.picks.find((p) => p.rank === selection.rank) ?? null)
      : null;
  const cluster: (Cluster & { rank?: number }) | null =
    pick ?? (selection?.kind === "cell" ? selection.cluster : null);
  const hoveredPick =
    hovered != null
      ? ranking?.picks.find((p) => p.rank === hovered)
      : undefined;
  const focusOf = cluster ?? hoveredPick ?? null;
  const solid = cluster != null;
  const focus = useMemo(
    () =>
      focusOf
        ? { lat: focusOf.lat, lng: focusOf.lng, cell: focusOf.cell, solid }
        : null,
    [focusOf, solid],
  );

  const onHexClick = useCallback(
    (cell: string) => {
      if (!buckets) return;
      setSeller(null);
      setPanelOpen(true);
      setSelection({
        kind: "cell",
        cluster: clusterAt(
          cell,
          buckets,
          radiusToK(view.radiusKm),
          view.target,
        ),
      });
    },
    [buckets, view.radiusKm, view.target],
  );
  const onMove = useCallback(
    (center: [number, number], zoom: number) =>
      setView((v) => ({ ...v, center, zoom })),
    [],
  );
  const onPinClick = useCallback((rank: number) => {
    setSeller(null);
    setPanelOpen(true);
    setSelection({ kind: "pick", rank });
  }, []);

  const kpis =
    filtered && ranking
      ? {
          sellers: filtered.kept.length,
          packages: filtered.kept.reduce(
            (sum, s) => sum + countableVolume(s),
            0,
          ),
          hubs: ranking.picks.length,
        }
      : null;

  return (
    <div className="flex h-[100dvh] flex-col">
      <TopBar data={data} kpis={kpis} />
      <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative min-h-0 min-w-0 flex-1">
          {error ? (
            <div className="flex h-full items-center justify-center p-[var(--gutter)] text-center text-rojo">
              No se pudieron cargar los sellers: {error}
            </div>
          ) : (
            <>
              <MapView
                scores={ranking?.scores ?? null}
                target={view.target}
                radiusKm={view.radiusKm}
                pins={pins}
                exact={exact}
                references={filtered?.references ?? []}
                focus={focus}
                activeRank={pick?.rank ?? hovered}
                initialView={initialView}
                onHexClick={onHexClick}
                onPinHover={setHovered}
                onPinClick={onPinClick}
                onMove={onMove}
              />
              <MapDock
                target={view.target}
                onTarget={(target) => setView((v) => ({ ...v, target }))}
                radiusKm={view.radiusKm}
                onRadius={(radiusKm) => setView((v) => ({ ...v, radiusKm }))}
                filters={view.filters}
                onFilters={(filters) => setView((v) => ({ ...v, filters }))}
                excluded={filtered?.excluded ?? NO_EXCLUDED}
              />
            </>
          )}
        </div>
        {/* Panel: barra lateral en md+, hoja inferior en móvil. Arranca plegado: una franja (md+) o una barra abajo (móvil). */}
        {!panelOpen ? (
          <div className="flex bg-white md:w-12 md:border-l md:border-gris-200 max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:rounded-t-card max-md:border-t max-md:border-gris-200 max-md:shadow-pop">
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              aria-expanded={false}
              aria-label="Mostrar oportunidades"
              className="t-etiqueta flex min-h-12 w-full items-center justify-center gap-2 py-3 text-gris-700 hover:bg-papel hover:text-carbon md:h-full md:flex-col md:py-4"
              data-testid="panel-toggle"
            >
              <span className="md:hidden">
                Top oportunidades
                {ranking ? ` · ${ranking.picks.length}` : ""} ▴
              </span>
              <span className="hidden md:block" aria-hidden="true">
                ‹
              </span>
              <span className="hidden [writing-mode:vertical-rl] md:block">
                Top oportunidades
                {ranking ? ` · ${ranking.picks.length}` : ""}
              </span>
            </button>
          </div>
        ) : (
          <div
            className={`flex flex-col bg-white md:w-[var(--panel-w)] md:min-w-[var(--panel-min)] md:max-w-[var(--panel-max)] md:border-l md:border-gris-200 max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:rounded-t-card max-md:border-t max-md:border-gris-200 max-md:shadow-pop ${cluster ? "max-md:h-[var(--panel-sheet-max)]" : "max-md:max-h-[var(--panel-sheet-peek)]"}`}
          >
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              aria-expanded={true}
              aria-label="Ocultar panel"
              className="t-micro flex items-center justify-center gap-2 py-2 text-gris-700 hover:text-carbon md:justify-end md:border-b md:border-gris-200 md:px-4 lg:px-6"
              data-testid="panel-toggle"
            >
              <span className="sheet-grabber md:hidden" aria-hidden="true" />
              <span className="hidden md:inline">Ocultar panel ›</span>
            </button>
            {seller && cluster ? (
              <SellerDetail seller={seller} onBack={() => setSeller(null)} />
            ) : cluster ? (
              <ClusterPanel
                cluster={cluster}
                radiusKm={view.radiusKm}
                target={view.target}
                claimedBy={ranking?.claimedBy ?? new Map()}
                excluded={filtered?.excluded ?? NO_EXCLUDED}
                onBack={() => setSelection(null)}
                onSeller={setSeller}
              />
            ) : (
              <OpportunityList
                picks={ranking?.picks ?? null}
                radiusKm={view.radiusKm}
                target={view.target}
                hovered={hovered}
                onHover={setHovered}
                onOpen={(p) => setSelection({ kind: "pick", rank: p.rank })}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
