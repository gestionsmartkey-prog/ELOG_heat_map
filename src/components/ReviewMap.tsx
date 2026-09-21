"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap } from "maplibre-gl";

const BASEMAP = process.env.NEXT_PUBLIC_BASEMAP_STYLE ?? "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const BLANK_STYLE: maplibregl.StyleSpecification = { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#E3DFDB" } }] };

async function resolveStyle(): Promise<maplibregl.StyleSpecification | string> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(BASEMAP, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`style ${res.status}`);
    return (await res.json()) as maplibregl.StyleSpecification;
  } catch { return BLANK_STYLE; }
}

type Props = {
  /** Where to drop the draggable pin, [lng, lat]. */
  pin: [number, number];
  /** Fired on drag end with the new pin position. */
  onMove: (lng: number, lat: number) => void;
  /** Bumps whenever a new review item is selected, so the map recenters on it. */
  focusKey: string;
};

/** A single draggable marker on a basemap. The reviewer drags it onto the real door. */
export function ReviewMap({ pin, onMove, focusKey }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onMoveRef = useRef(onMove);
  useEffect(() => { onMoveRef.current = onMove; }, [onMove]);
  const pinRef = useRef(pin);
  useEffect(() => { pinRef.current = pin; }, [pin]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let disposed = false;
    const container = containerRef.current;
    maplibregl.setWorkerUrl(`${window.location.origin}/maplibre/maplibre-gl-worker.mjs`);
    resolveStyle().then((style) => {
      if (disposed) return;
      const map = new maplibregl.Map({ container, style, center: pinRef.current, zoom: 13, minZoom: 8, maxZoom: 18, attributionControl: { compact: true } });
      mapRef.current = map;
      (window as unknown as { __elogReviewMap?: MLMap }).__elogReviewMap = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
      const el = document.createElement("div");
      el.className = "review-pin";
      el.setAttribute("data-testid", "review-pin");
      const marker = new maplibregl.Marker({ element: el, draggable: true, anchor: "bottom" }).setLngLat(pinRef.current).addTo(map);
      marker.on("dragend", () => { const p = marker.getLngLat(); onMoveRef.current(p.lng, p.lat); });
      markerRef.current = marker;
    });
    return () => { disposed = true; markerRef.current = null; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  // Recenter and reset the pin whenever the selected item changes.
  useEffect(() => {
    const map = mapRef.current, marker = markerRef.current;
    if (!map || !marker) return;
    marker.setLngLat(pin);
    map.flyTo({ center: pin, zoom: 15, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  return <div ref={containerRef} className="h-full w-full" data-testid="review-map" />;
}
