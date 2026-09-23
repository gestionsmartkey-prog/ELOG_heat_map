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
