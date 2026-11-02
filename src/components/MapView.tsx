"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type {
  LngLatBoundsLike,
  Map as MLMap,
  MapMouseEvent,
} from "maplibre-gl";
import { cellToLatLng } from "h3-js";
import type { MapSeller } from "@/lib/types";
import type { Pick } from "@/lib/ranking";
import { HUB_RES } from "@/lib/ranking";
import { formatPkgs, formatShare } from "@/lib/opportunity";
import {
  circlePolygon,
  displayRes,
  opportunityGeoJSON,
  pointsGeoJSON,
} from "@/lib/hexes";
import { Legend } from "./Legend";

const BASEMAP =
  process.env.NEXT_PUBLIC_BASEMAP_STYLE ??
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
/** Used when the basemap cannot be fetched (offline, blocked network): hexes still render. */
const BLANK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#E3DFDB" } },
  ],
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

const AMBA_BOUNDS: LngLatBoundsLike = [
  [-59.3, -35.1],
  [-57.9, -34.25],
];
/** The prospect files cover the whole country, so the map is no longer fenced to the metro area. */
const ARGENTINA_BOUNDS: LngLatBoundsLike = [
  [-74, -56],
  [-52, -20],
];
const HOME_CENTER: [number, number] = [-58.55, -34.62];
const HOME_ZOOM = 10;

const EMPTY: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

type Focus = { lat: number; lng: number; cell?: string; solid: boolean };

type Props = {
  scores: Map<string, number> | null;
  target: number;
  radiusKm: number;
  /** Top picks shown as numbered pins. */
  pins: Pick[];
  /** Door-level prospects, dots at street zoom. */
  exact: MapSeller[];
  /** Agencies and partners when the switch is on. */
  references: MapSeller[];
  /** The hovered (dashed) or selected (solid) hub radius. */
  focus: Focus | null;
  activeRank: number | null;
  initialView?: { center?: [number, number]; zoom?: number };
  onHexClick: (cell8: string) => void;
  onPinHover: (rank: number | null) => void;
  onPinClick: (rank: number) => void;
  onMove: (center: [number, number], zoom: number) => void;
};

/** Opportunity heat map: hexes coloured by the share of the target reachable from them (design doc §2). */
export function MapView({
  scores,
  target,
  radiusKm,
  pins,
  exact,
  references,
  focus,
  activeRank,
  initialView,
  onHexClick,
  onPinHover,
  onPinClick,
  onMove,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(initialView?.zoom ?? HOME_ZOOM);
  const res = displayRes(zoom);
  const hoverRef = useRef<string | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  const hexes = useMemo(
    () => opportunityGeoJSON(scores ?? new Map(), target, res),
    [scores, target, res],
  );
  const points = useMemo(() => pointsGeoJSON(exact), [exact]);
  const refs = useMemo(() => pointsGeoJSON(references), [references]);
  const focusData = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!focus) return EMPTY;
    const f = circlePolygon(focus.lat, focus.lng, radiusKm);
    f.properties = { solid: focus.solid };
    return { type: "FeatureCollection", features: [f] };
  }, [focus, radiusKm]);

  // Keep latest values reachable from map event handlers without re-binding them.
  const latest = useRef({ radiusKm, onHexClick, onMove });
  useEffect(() => {
    latest.current = { radiusKm, onHexClick, onMove };
  }, [radiusKm, onHexClick, onMove]);
  const initial = useRef(initialView);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let disposed = false;
    let map: MLMap | null = null;
    const container = containerRef.current;

    // Bundlers do not give MapLibre an import.meta.url it can derive its worker from.
    maplibregl.setWorkerUrl(
      `${window.location.origin}/maplibre/maplibre-gl-worker.mjs`,
    );
    resolveStyle().then((style) => {
      if (disposed) return;
      map = new maplibregl.Map({
        container,
        style,
        center: initial.current?.center ?? HOME_CENTER,
        zoom: initial.current?.zoom ?? HOME_ZOOM,
        minZoom: 3.5,
        maxZoom: 17,
        maxBounds: ARGENTINA_BOUNDS,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      (window as unknown as { __elogMap?: MLMap }).__elogMap = map; // debugging hook for browser tests
      // The dock sits top-left, so the zoom buttons go bottom-right.
      map.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "bottom-right",
      );

      const m = map;
      m.on("load", () => {
        m.addSource("hexes", {
          type: "geojson",
          data: EMPTY,
          promoteId: "cell",
        });
        m.addSource("focus", { type: "geojson", data: EMPTY });
        m.addSource("points", {
          type: "geojson",
          data: EMPTY,
          promoteId: "id",
        });
        m.addSource("refs", { type: "geojson", data: EMPTY, promoteId: "id" });
        const selected = [
          "boolean",
          ["feature-state", "selected"],
          false,
        ] as maplibregl.ExpressionSpecification;
        m.addLayer({
          id: "hex-fill",
          type: "fill",
          source: "hexes",
          paint: {
            "fill-color": ["get", "color"],
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "hover"], false],
              0.9,
              0.75,
            ],
          },
        });
        m.addLayer({
          id: "hex-line",
          type: "line",
          source: "hexes",
          paint: {
            "line-color": [
              "case",
              selected,
              "#2A2726",
              ["get", "top"],
              "#2A2726",
              "#FFFFFF",
            ],
            "line-width": ["case", selected, 2.5, ["get", "top"], 1.5, 0.6],
          },
        });
        m.addLayer({
          id: "focus-fill",
          type: "fill",
          source: "focus",
          filter: ["==", ["get", "solid"], true],
          paint: { "fill-color": "#2A2726", "fill-opacity": 0.04 },
        });
        m.addLayer({
          id: "focus-dash",
          type: "line",
          source: "focus",
          filter: ["==", ["get", "solid"], false],
          paint: {
            "line-color": "#2A2726",
            "line-width": 1.5,
            "line-dasharray": [2, 2],
          },
        });
        m.addLayer({
          id: "focus-line",
          type: "line",
          source: "focus",
          filter: ["==", ["get", "solid"], true],
          paint: { "line-color": "#2A2726", "line-width": 2 },
        });
        m.addLayer({
          id: "points",
          type: "circle",
          source: "points",
          minzoom: 13.5,
          paint: {
            "circle-radius": 5,
            "circle-color": "#FF9038",
            "circle-stroke-color": "#3F3E3E",
            "circle-stroke-width": 1.5,
          },
        });
        m.addLayer({
          id: "refs",
          type: "circle",
          source: "refs",
          minzoom: 11,
          paint: {
            "circle-radius": 4,
            "circle-color": [
              "match",
              ["get", "kind"],
              "dropoff_agency",
              "#2B6E8F",
              "partner",
              "#2E7D5B",
              "#A3A09E",
            ],
            "circle-stroke-color": "#FFFFFF",
            "circle-stroke-width": 1,
          },
        });
        setReady(true);
      });
      m.on("zoomend", () => setZoom(m.getZoom()));
      m.on("moveend", () => {
        const c = m.getCenter();
        latest.current.onMove([c.lng, c.lat], m.getZoom());
      });

      m.on(
        "mousemove",
        "hex-fill",
        (e: MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
          const p = e.features?.[0]?.properties;
          const cell = p?.cell as string | undefined;
          if (!cell) return;
          m.getCanvas().style.cursor = "pointer";
          if (hoverRef.current && hoverRef.current !== cell)
            m.setFeatureState(
              { source: "hexes", id: hoverRef.current },
              { hover: false },
            );
          hoverRef.current = cell;
          m.setFeatureState({ source: "hexes", id: cell }, { hover: true });
          const html = `<strong>${formatShare(Number(p?.share))}</strong> del objetivo<br/>${formatPkgs(Number(p?.volume))} paq/mes a ${latest.current.radiusKm} km`;
          if (!popupRef.current)
            popupRef.current = new maplibregl.Popup({
              closeButton: false,
              closeOnClick: false,
              offset: 8,
            });
          popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(m);
        },
      );
      m.on("mouseleave", "hex-fill", () => {
        m.getCanvas().style.cursor = "";
        if (hoverRef.current)
          m.setFeatureState(
            { source: "hexes", id: hoverRef.current },
            { hover: false },
          );
        hoverRef.current = null;
        popupRef.current?.remove();
      });
      m.on(
        "click",
        "hex-fill",
        (e: MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
          const cell = e.features?.[0]?.properties?.cell as string | undefined;
          if (!cell) return;
          // Coarse hexes are not hub spots: zoom in until the hub grid shows.
          if (displayRes(m.getZoom()) < HUB_RES) {
            const [lat, lng] = cellToLatLng(cell);
            m.flyTo({ center: [lng, lat], zoom: 12 });
            return;
          }
          latest.current.onHexClick(cell);
        },
      );
    });

    return () => {
      disposed = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Push data whenever it changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("hexes") as maplibregl.GeoJSONSource | undefined)?.setData(
      hexes,
    );
    (map.getSource("points") as maplibregl.GeoJSONSource | undefined)?.setData(
      points,
    );
    (map.getSource("refs") as maplibregl.GeoJSONSource | undefined)?.setData(
      refs,
    );
    (map.getSource("focus") as maplibregl.GeoJSONSource | undefined)?.setData(
      focusData,
    );
  }, [hexes, points, refs, focusData, ready]);

  // Numbered pins for the top picks: DOM markers, so they render without basemap fonts.
  const pinHandlers = useRef({ onPinHover, onPinClick });
  useEffect(() => {
    pinHandlers.current = { onPinHover, onPinClick };
  }, [onPinHover, onPinClick]);
  const markersRef = useRef<
    { rank: number; el: HTMLButtonElement; marker: maplibregl.Marker }[]
  >([]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const mk of markersRef.current) mk.marker.remove();
    markersRef.current = pins.map((p) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "pin";
      el.textContent = String(p.rank);
      el.setAttribute("aria-label", `Oportunidad ${p.rank}: ${p.name}`);
      el.dataset.testid = "map-pin";
      el.addEventListener("mouseenter", () =>
        pinHandlers.current.onPinHover(p.rank),
      );
      el.addEventListener("mouseleave", () =>
        pinHandlers.current.onPinHover(null),
      );
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        pinHandlers.current.onPinClick(p.rank);
      });
      return {
        rank: p.rank,
        el,
        marker: new maplibregl.Marker({ element: el })
          .setLngLat([p.lng, p.lat])
          .addTo(map),
      };
    });
    return () => {
      for (const mk of markersRef.current) mk.marker.remove();
      markersRef.current = [];
    };
  }, [pins, ready]);
  useEffect(() => {
    for (const mk of markersRef.current)
      mk.el.setAttribute("data-active", String(mk.rank === activeRank));
  }, [activeRank, pins, ready]);

  // Selection outline on the hub cell of a solid focus.
  const selectedCell = focus?.solid ? (focus.cell ?? null) : null;
  const prevSelected = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (prevSelected.current)
      map.setFeatureState(
        { source: "hexes", id: prevSelected.current },
        { selected: false },
      );
    if (selectedCell)
      map.setFeatureState(
        { source: "hexes", id: selectedCell },
        { selected: true },
      );
    prevSelected.current = selectedCell;
  }, [selectedCell, ready, hexes]);

  const fitAll = () => {
    const map = mapRef.current;
    if (!map) return;
    const b = new maplibregl.LngLatBounds();
    for (const c of scores?.keys() ?? []) {
      const [lat, lng] = cellToLatLng(c);
      b.extend([lng, lat]);
    }
    for (const s of exact)
      if (s.lat != null && s.lng != null) b.extend([s.lng, s.lat]);
    if (b.isEmpty()) {
      map.fitBounds(AMBA_BOUNDS, { padding: 20 });
      return;
    }
    map.fitBounds(b, { padding: 40, maxZoom: 12 });
  };

  return (
    <div
      className="relative h-full w-full"
      data-testid="map"
      data-ready={ready ? "1" : "0"}
      data-hexes={hexes.features.length}
    >
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute bottom-6 left-3 z-10">
        <Legend radiusKm={radiusKm} />
      </div>
      <button
        type="button"
        onClick={fitAll}
        className="btn btn-light t-meta absolute right-3 top-3 z-10 shadow-ctrl"
        title="Encuadrar todos los datos"
      >
        Ver todo
      </button>
    </div>
  );
}
