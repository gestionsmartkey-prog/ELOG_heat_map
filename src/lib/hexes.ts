import { cellToBoundary, cellToParent } from "h3-js";
import type { MapSeller } from "./types";
import { shareBin } from "./opportunity";
import { HUB_RES } from "./ranking";

/** Display resolution follows zoom: coarse for the country, 7 at metro view, 8 at city view, 9 up close. */
export function resolutionForZoom(zoom: number): number {
  if (zoom < 5.5) return 4;
  if (zoom < 7) return 5;
  if (zoom < 8.5) return 6;
  if (zoom < 10.5) return 7;
  if (zoom < 13) return 8;
  return 9;
}

/** Opportunity is scored per hub cell (res 8); the map never draws it finer. */
export const displayRes = (zoom: number): number =>
  Math.min(resolutionForZoom(zoom), HUB_RES);

/**
 * Heat surface: one polygon per cell, coloured by the share of the target a hub there reaches.
 * Coarser than res 8, a parent shows the best spot inside it.
 */
export function opportunityGeoJSON(
  scores: Map<string, number>,
  target: number,
  res: number,
): GeoJSON.FeatureCollection {
  const byCell = new Map<string, number>();
  for (const [cell, v] of scores) {
    if (v <= 0) continue;
    const c = res >= HUB_RES ? cell : cellToParent(cell, res);
    if ((byCell.get(c) ?? 0) < v) byCell.set(c, v);
  }
  const features: GeoJSON.Feature[] = [];
  for (const [cell, volume] of byCell) {
    const ring = cellToBoundary(cell, true);
    ring.push(ring[0]);
    const share = volume / target;
    features.push({
      type: "Feature",
      id: cell,
      properties: {
        cell,
        volume,
        share,
        color: shareBin(share).color,
        top: share >= 1,
      },
      geometry: { type: "Polygon", coordinates: [ring] },
    });
  }
  return { type: "FeatureCollection", features };
}

/** A circle of `km` around a point, for the hovered or selected hub radius. */
export function circlePolygon(
  lat: number,
  lng: number,
  km: number,
  steps = 64,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const dLat = km / 110.574;
  const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)]);
  }
  ring[steps] = ring[0];
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

export function pointsGeoJSON(sellers: MapSeller[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: sellers
      .filter((s) => s.lat != null && s.lng != null)
      .map((s) => ({
        type: "Feature",
        id: s.id,
        properties: { id: s.id, name: s.name, kind: s.kind },
        geometry: {
          type: "Point",
          coordinates: [s.lng as number, s.lat as number],
        },
      })),
  };
}
