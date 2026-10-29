import { describe, expect, it } from "vitest";
import { gridDisk, latLngToCell } from "h3-js";
import { neighbourCount, zoneLabel } from "../../src/lib/hexes";

describe("zone wording", () => {
  it("counts the neighbours the catchment actually sums", () => {
    const cell = latLngToCell(-34.56, -58.46, 9);
    for (const k of [1, 2]) expect(gridDisk(cell, k).length - 1).toBe(neighbourCount(k));
  });

  it("names each zone option in plain words", () => {
    expect(zoneLabel(0)).toBe("solo este hexágono");
    expect(zoneLabel(1)).toBe("este + 6 vecinos");
    expect(zoneLabel(2)).toBe("este + 18 vecinos");
  });
});

describe("zoom resolution", () => {
  it("goes coarser for the country view and keeps the street-level steps", async () => {
    const { resolutionForZoom } = await import("../../src/lib/hexes");
    expect([3.5, 6, 8, 9, 12, 15].map(resolutionForZoom)).toEqual([4, 5, 6, 7, 8, 9]);
  });
});

describe("prospect layer helpers", () => {
  const seller = (over: Record<string, unknown>) => ({ id: "1", source: "ml_publico", attrs: {}, ...over }) as never;
  it("treats anything but a door as approximate", async () => {
    const { isApproximate } = await import("../../src/lib/layers");
    expect(isApproximate(seller({ precision: "locality" }))).toBe(true);
    expect(isApproximate(seller({ precision: "street" }))).toBe(false);
    expect(isApproximate(seller({}))).toBe(false); // older fixtures have no precision
  });
  it("filters on attributes: empty selection = everything, a selection needs the attribute to match", async () => {
    const { matchesAttrs } = await import("../../src/lib/layers");
    const s = seller({ attrs: { flex_candidate: "si", reputation: "5_green" } });
    expect(matchesAttrs(s, {})).toBe(true);
    expect(matchesAttrs(s, { flex_candidate: new Set() })).toBe(true);
    expect(matchesAttrs(s, { flex_candidate: new Set(["si", "probable"]), reputation: new Set(["5_green"]) })).toBe(true);
    expect(matchesAttrs(s, { reputation: new Set(["3_yellow"]) })).toBe(false);
    expect(matchesAttrs(seller({}), { flex_candidate: new Set(["si"]) })).toBe(false); // no data never matches a filter
  });
  it("sums shipments and counts Flex candidates per hexagon", async () => {
    const { metricById } = await import("../../src/lib/metrics");
    const rows = [seller({ metrics: { shipments_month: 10 }, attrs: { flex_candidate: "si" } }), seller({ metrics: { shipments_month: 5 }, attrs: { flex_candidate: "probable" } }), seller({})];
    expect(metricById("shipments_month").reduce(rows)).toBe(15);
    expect(metricById("flex_candidates").reduce(rows)).toBe(1);
  });
});
