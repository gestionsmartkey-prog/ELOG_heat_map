import { describe, expect, it } from "vitest";
import { cellToLatLng, gridDisk, latLngToCell } from "h3-js";
import {
  bucketByCell,
  clusterAt,
  radiusToK,
  rankHubs,
} from "../../src/lib/ranking";
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

describe("rankHubs", () => {
  // Two clusters 20 km apart, and a third one 4 km from the first that mostly shares its sellers.
  const near = (
    lat: number,
    lng: number,
    n: number,
    vol: number,
    loc: string,
  ) =>
    Array.from({ length: n }, (_, i) =>
      mk(`${loc}${i}`, vol, { ...at(lat + i * 0.001, lng), locality: loc }),
    );
  const sellers = [
    ...near(-34.653, -58.62, 6, 1000, "Morón"), // 6,000
    ...near(-34.575, -58.49, 4, 1100, "Urquiza"), // 4,400, ~15 km away
    ...near(-34.65, -58.665, 2, 600, "Castelar"), // 1,200, ~4 km from Morón
    ...near(-34.9, -57.95, 1, 200, "La Plata"), // 200, below the 25% floor
  ];
  const r = rankHubs(sellers, { target: 5000, radiusKm: 5 });

  it("picks the biggest pool first and never counts a seller twice", () => {
    const names = r.picks.map((p) => p.name);
    expect(names[0]).toBe("Morón");
    expect(names).toContain("Urquiza");
    const ids = r.picks.flatMap((p) => p.sellers.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
    const total = r.picks.reduce((sum, p) => sum + p.volume, 0);
    expect(total).toBeLessThanOrEqual(6000 + 4400 + 1200);
  });

  it("stops below 25% of the target", () => {
    expect(r.picks.some((p) => p.name === "La Plata")).toBe(false);
  });

  it("records who claimed each seller and keeps a pre-claim score per cell for the heat map", () => {
    expect(r.claimedBy.get("Morón0")).toBe(1);
    expect(Math.max(...r.scores.values())).toBeGreaterThanOrEqual(6000);
  });

  it("ranks are 1..n in order and capped at maxPicks", () => {
    expect(r.picks.map((p) => p.rank)).toEqual(r.picks.map((_, i) => i + 1));
    expect(
      rankHubs(sellers, { target: 1000, radiusKm: 3, maxPicks: 2 }).picks,
    ).toHaveLength(2);
  });
});
