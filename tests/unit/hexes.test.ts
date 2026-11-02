import { describe, expect, it } from "vitest";
import { cellToParent, latLngToCell } from "h3-js";
import {
  circlePolygon,
  displayRes,
  opportunityGeoJSON,
  resolutionForZoom,
} from "../../src/lib/hexes";

describe("zoom resolution", () => {
  it("goes coarser for the country view and keeps the street-level steps", () => {
    expect([3.5, 6, 8, 9, 12, 15].map(resolutionForZoom)).toEqual([
      4, 5, 6, 7, 8, 9,
    ]);
  });
  it("opportunity hexes never go finer than the hub grid", () => {
    expect([8, 12, 15].map(displayRes)).toEqual([6, 8, 8]);
  });
});

describe("opportunityGeoJSON", () => {
  const a = latLngToCell(-34.65, -58.62, 8),
    b = latLngToCell(-34.66, -58.64, 8);
  const scores = new Map([
    [a, 6000],
    [b, 1000],
  ]);
  it("colours each hub cell by its share of the target and flags covered ones", () => {
    const fc = opportunityGeoJSON(scores, 5000, 8);
    const pa = fc.features.find((f) => f.properties?.cell === a)!.properties!;
    expect(pa.share).toBeCloseTo(1.2);
    expect(pa.color).toBe("#6E2303");
    expect(pa.top).toBe(true);
  });
  it("at coarser zoom keeps the best spot inside each parent", () => {
    const fc = opportunityGeoJSON(scores, 5000, 6);
    const parent = cellToParent(a, 6);
    expect(
      fc.features.find((f) => f.properties?.cell === parent)!.properties!
        .volume,
    ).toBe(6000);
  });
});

describe("circlePolygon", () => {
  it("draws a closed ring about the given radius", () => {
    const ring = circlePolygon(-34.65, -58.62, 5).geometry.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    const [lng] = ring[0];
    expect(
      Math.abs(lng - -58.62) * 111.32 * Math.cos((34.65 * Math.PI) / 180),
    ).toBeCloseTo(5, 1);
  });
});
