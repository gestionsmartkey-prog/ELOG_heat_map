import { describe, expect, it } from "vitest";
import { DEFAULT_VIEW, decodeView, encodeView } from "../../src/lib/viewState";
import { NO_FILTERS } from "../../src/lib/filters";

describe("view state", () => {
  it("an empty query is the default view with the Prospecto Flex preset", () => {
    expect(decodeView("")).toEqual(DEFAULT_VIEW);
    expect(encodeView(DEFAULT_VIEW)).toBe("");
  });
  it("round-trips target, radius, filters and map position", () => {
    const v = {
      target: 3000,
      radiusKm: 8,
      filters: {
        ...NO_FILTERS,
        sizes: ["core" as const],
        repMin: 4,
        refs: true,
      },
      center: [-58.5, -34.6] as [number, number],
      zoom: 11.5,
    };
    expect(decodeView(encodeView(v))).toEqual(v);
  });
  it("a cleared filter set survives the round trip instead of falling back to the preset", () => {
    const v = { ...DEFAULT_VIEW, filters: NO_FILTERS };
    expect(decodeView(encodeView(v)).filters).toEqual(NO_FILTERS);
  });
  it("ignores junk", () => {
    expect(decodeView("t=abc&r=7&sz=huge&rep=9")).toEqual({
      ...DEFAULT_VIEW,
      filters: { ...NO_FILTERS },
    });
  });
});
