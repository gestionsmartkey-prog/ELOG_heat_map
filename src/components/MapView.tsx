"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { LngLatBoundsLike, Map as MLMap, MapMouseEvent } from "maplibre-gl";
import { cellToLatLng } from "h3-js";
import type { MapSeller } from "@/lib/types";
import type { Metric } from "@/lib/metrics";
import { aggregate, catchment, computeBins, pointsGeoJSON, resolutionForZoom, toGeoJSON, type Bin, type CellAgg } from "@/lib/hexes";
import { Legend } from "./Legend";

const BASEMAP = process.env.NEXT_PUBLIC_BASEMAP_STYLE ?? "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
/** Used when the basemap cannot be fetched (offline, blocked network): hexes still render. */
const BLANK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#E3DFDB" } }],
};
/** Fetch the basemap style ourselves so an unreachable CDN degrades to a blank canvas instead of a half-loaded map. */
async function resolveStyle(): Promise<maplibregl.StyleSpecification | string> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(BASEMAP, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`style ${res.status}`);
    return (await res.json()) as maplibregl.StyleSpecification;
  } catch {
    return BLANK_STYLE;
  }
}

const AMBA_BOUNDS: LngLatBoundsLike = [[-59.3, -35.1], [-57.9, -34.25]];
const HOME_CENTER: [number, number] = [-58.55, -34.62];

type Props = {
  sellers: MapSeller[];
  metric: Metric;
  catchmentK: number;
  selectedCell: string | null;
  onSelect: (cell: CellAgg | null, catchmentValue: number | null) => void;
  onResolution: (res: number) => void;
};

export function MapView({ sellers, metric, catchmentK, selectedCell, onSelect, onResolution }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(10);
  const res = resolutionForZoom(zoom);
  const hoverRef = useRef<string | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  const agg = useMemo(() => aggregate(sellers, res, metric), [sellers, res, metric]);
  const bins: Bin[] = useMemo(() => computeBins([...agg.values()].map((a) => a.value)), [agg]);
  const hexes = useMemo(() => toGeoJSON(agg, bins), [agg, bins]);
  const points = useMemo(() => pointsGeoJSON(sellers), [sellers]);
  const labels = useMemo(() => localityLabels(sellers), [sellers]);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  // Keep latest values reachable from map event handlers without re-binding them.
  const latest = useRef({ agg, metric, catchmentK, onSelect });
  useEffect(() => { latest.current = { agg, metric, catchmentK, onSelect }; }, [agg, metric, catchmentK, onSelect]);

  useEffect(() => { onResolution(res); }, [res, onResolution]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let disposed = false;
    let map: MLMap | null = null;
    const container = containerRef.current;

    // Bundlers do not give MapLibre an import.meta.url it can derive its worker from.
    maplibregl.setWorkerUrl(`${window.location.origin}/maplibre/maplibre-gl-worker.mjs`);
    resolveStyle().then((style) => {
      if (disposed) return;
      map = new maplibregl.Map({
        container,
        style,
        center: HOME_CENTER,
        zoom: 10,
        minZoom: 8,
        maxZoom: 17,
        maxBounds: [[-60.2, -35.6], [-57.2, -33.8]],
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      (window as unknown as { __elogMap?: MLMap }).__elogMap = map; // debugging hook for browser tests
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

      const m = map;
      m.on("load", () => {
        m.addSource("hexes", { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "cell" });
        m.addSource("points", { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "id" });
        m.addLayer({
          id: "hex-fill", type: "fill", source: "hexes",
          paint: {
            "fill-color": ["get", "color"],
            "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.9, 0.7],
          },
        });
        m.addLayer({
          id: "hex-line", type: "line", source: "hexes",
          paint: {
            "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#2A2726", "#FFFFFF"],
            "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 2.5, 0.8],
          },
        });
        m.addLayer({
          id: "points", type: "circle", source: "points", minzoom: 13.5,
          paint: {
            "circle-radius": 5,
            "circle-color": ["match", ["get", "kind"], "dropoff_agency", "#2B6E8F", "partner", "#2E7D5B", "unknown", "#A3A09E", "#FF9038"],
            "circle-stroke-color": "#3F3E3E",
            "circle-stroke-width": 1.5,
          },
        });
        setReady(true);
      });
      m.on("zoomend", () => setZoom(m.getZoom()));

      m.on("mousemove", "hex-fill", (e: MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        const f = e.features?.[0];
        const cell = f?.properties?.cell as string | undefined;
        if (!cell) return;
        m.getCanvas().style.cursor = "pointer";
        if (hoverRef.current && hoverRef.current !== cell) m.setFeatureState({ source: "hexes", id: hoverRef.current }, { hover: false });
        hoverRef.current = cell;
        m.setFeatureState({ source: "hexes", id: cell }, { hover: true });
        const { agg: a, metric: met, catchmentK: k } = latest.current;
        const cellAgg = a.get(cell);
        if (!cellAgg) return;
        const ring = k > 0 ? catchment(cell, a, met, k) : null;
        const html = `<strong>${met.format(cellAgg.value)}</strong> ${met.short}` + (ring != null ? `<br/><span style="color:#606060">${met.format(ring)} en +${k} anillo${k > 1 ? "s" : ""}</span>` : "");
        if (!popupRef.current) popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
        popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(m);
      });
      m.on("mouseleave", "hex-fill", () => {
        m.getCanvas().style.cursor = "";
        if (hoverRef.current) m.setFeatureState({ source: "hexes", id: hoverRef.current }, { hover: false });
        hoverRef.current = null;
        popupRef.current?.remove();
      });
      m.on("click", (e: MapMouseEvent) => {
        const hits = m.getLayer("hex-fill") ? m.queryRenderedFeatures(e.point, { layers: ["hex-fill"] }) : [];
        const cell = hits[0]?.properties?.cell as string | undefined;
        const { agg: a, metric: met, catchmentK: k, onSelect: sel } = latest.current;
        if (!cell) { sel(null, null); return; }
        const cellAgg = a.get(cell) ?? null;
        sel(cellAgg, cellAgg && k > 0 ? catchment(cell, a, met, k) : null);
      });
    });

    return () => { disposed = true; map?.remove(); mapRef.current = null; };
  }, []);

  // Push data whenever aggregation changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("hexes") as maplibregl.GeoJSONSource | undefined)?.setData(hexes);
    (map.getSource("points") as maplibregl.GeoJSONSource | undefined)?.setData(points);
  }, [hexes, points, ready]);

  // Locality labels: plain DOM markers (render without basemap fonts), with a
  // greedy screen-space collision pass so dense clusters do not pile up.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const place = () => {
      for (const mk of markersRef.current) mk.remove();
      markersRef.current = [];
      if (res > 8) return;
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      for (const l of labels) {
        const p = map.project([l.lng, l.lat]);
        const text = `${l.name} · ${l.count}`;
        const w = text.length * 6.4 + 14, h = 22;
        const box = { x: p.x - w / 2, y: p.y - h - 6, w, h };
        if (placed.some((b) => box.x < b.x + b.w + 4 && box.x + box.w + 4 > b.x && box.y < b.y + b.h + 2 && box.y + box.h + 2 > b.y)) continue;
        placed.push(box);
        const el = document.createElement("div");
        el.className = "pointer-events-none select-none whitespace-nowrap rounded-field bg-white/90 px-1.5 py-0.5 text-[11px] font-medium text-carbon tnum shadow-ctrl";
        el.textContent = text;
        markersRef.current.push(new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -6] }).setLngLat([l.lng, l.lat]).addTo(map));
      }
    };
    place();
    map.on("moveend", place);
    return () => { map.off("moveend", place); };
  }, [labels, ready, res]);

  // Selection outline.
  const prevSelected = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (prevSelected.current) map.setFeatureState({ source: "hexes", id: prevSelected.current }, { selected: false });
    if (selectedCell) map.setFeatureState({ source: "hexes", id: selectedCell }, { selected: true });
    prevSelected.current = selectedCell;
  }, [selectedCell, ready, hexes]);

  const fitAll = () => {
    const map = mapRef.current;
    if (!map) return;
    const cells = [...agg.keys()];
    if (!cells.length) { map.fitBounds(AMBA_BOUNDS, { padding: 20 }); return; }
    const b = new maplibregl.LngLatBounds();
    for (const c of cells) { const [lat, lng] = cellToLatLng(c); b.extend([lng, lat]); }
    map.fitBounds(b, { padding: 40, maxZoom: 12 });
  };

  return (
    <div className="relative h-full w-full" data-testid="map" data-ready={ready ? "1" : "0"} data-hexes={hexes.features.length}>
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute bottom-6 left-3 z-10">
        <Legend bins={bins} metricShort={metric.short} res={res} />
      </div>
      <button onClick={fitAll} className="btn btn-light t-meta absolute right-3 top-3 z-10 shadow-ctrl" title="Encuadrar todos los datos">
        Ver todo
      </button>
    </div>
  );
}

/** One label per locality with at least two rows, placed at the mean of its geocoded doors. */
function localityLabels(sellers: MapSeller[]): { name: string; lat: number; lng: number; count: number }[] {
  const acc = new Map<string, { lat: number; lng: number; n: number }>();
  for (const s of sellers) {
    if (!s.locality || s.lat == null || s.lng == null) continue;
    const a = acc.get(s.locality) ?? { lat: 0, lng: 0, n: 0 };
    a.lat += s.lat; a.lng += s.lng; a.n += 1;
    acc.set(s.locality, a);
  }
  return [...acc.entries()]
    .filter(([, a]) => a.n >= 2)
    .map(([name, a]) => ({ name, lat: a.lat / a.n, lng: a.lng / a.n, count: a.n }))
    .sort((x, y) => y.count - x.count)
    .slice(0, 25);
}
