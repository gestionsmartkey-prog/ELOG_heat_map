import { describe, expect, it } from "vitest";
import { cellToLatLng, gridDisk, latLngToCell } from "h3-js";
import { bucketByCell, clusterAt, radiusToK } from "../../src/lib/ranking";
import { mk } from "./sellers";

const at = (lat: number, lng: number) => ({
  h3_r9: latLngToCell(lat, lng, 9),
  lat,
  lng,
});
const MORON = [-34.653, -58.62] as const;

describe("radius", () => {
  it("maps 3 / 5 / 8 km to 3 / 5 / 9 rings at res 8", () => {
    expect([3, 5, 8].map(radiusToK)).toEqual([3, 5, 9]);
    expect(gridDisk(latLngToCell(...MORON, 8), radiusToK(5)).length).toBe(91);
  });
});

describe("clusterAt", () => {
  const sellers = [
    mk("big", 2100, { ...at(...MORON), precision: "street" }),
    mk("mid", 1300, at(-34.66, -58.63)),
    mk("small", 400, { ...at(-34.65, -58.61), locality: "Castelar" }),
    mk("ent", 9000, at(-34.652, -58.621)),
    mk("novol", null, at(-34.652, -58.622)),
    mk("far", 3000, at(-34.9, -58.0)),
  ];
  const c = clusterAt(
    latLngToCell(...MORON, 8),
    bucketByCell(sellers),
    radiusToK(5),
    5000,
  );

  it("sums countable volume inside the radius only", () => {
    expect(c.volume).toBe(3800);
    expect(c.share).toBeCloseTo(0.76);
    expect(c.exactVolume).toBe(2100);
  });
  it("lists sellers by volume without enterprise, and counts what it left out", () => {
    expect(c.sellers.map((s) => s.id)).toEqual([
      "big",
      "mid",
      "small",
      "novol",
    ]);
    expect(c.enterprise).toBe(1);
    expect(c.noVolume).toBe(1);
  });
  it("is named after the locality with the most volume and centred on the cell", () => {
    expect(c.name).toBe("Morón");
    const [lat, lng] = cellToLatLng(c.cell);
    expect([c.lat, c.lng]).toEqual([lat, lng]);
    expect(c.needed.enough).toBe(false);
  });
});
