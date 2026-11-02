import { describe, expect, it } from "vitest";
import { cellToLatLng, gridDisk, gridDistance, latLngToCell } from "h3-js";
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
  it("is named after the locality nearest its centre, and centred on the cell", () => {
    expect(c.name).toBe("Morón");
    const castelar = latLngToCell(-34.65, -58.665, 8);
    const off = clusterAt(
      castelar,
      bucketByCell([
        mk("c", 200, { ...at(-34.65, -58.665), locality: "Castelar" }),
        mk("m", 4000, at(-34.652, -58.635)),
      ]),
      radiusToK(5),
      5000,
    );
    expect(off.volume).toBe(4200);
    expect(off.name).toBe("Castelar"); // Morón has more volume but is ~3 km away
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

  it("picks the biggest pool first and never claims a seller twice", () => {
    const names = r.picks.map((p) => p.name);
    expect(names[0]).toBe("Morón");
    expect(names).toContain("Urquiza");
    const claimed = r.picks.flatMap((p) => p.needed.picks.map((s) => s.id));
    expect(new Set(claimed).size).toBe(claimed.length);
    expect([...r.claimedBy.keys()].sort()).toEqual([...claimed].sort());
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

describe("rankHubs caps each hub at the target", () => {
  // Six sellers in a 5 km line through Morón, biggest in the middle; together they fill three hubs of 2,500.
  const vols = [1000, 1200, 1500, 1400, 1300, 1100];
  const line = vols.map((v, i) =>
    mk(`M${i}`, v, at(-34.653, -58.64 + i * 0.009)),
  );
  const k = radiusToK(5);
  const r = rankHubs(line, { target: 2500, radiusKm: 5 });

  it("a hub claims only the sellers it needs, biggest first", () => {
    expect(r.picks[0].needed.picks.map((s) => s.id)).toEqual(["M2", "M3"]);
    expect([...r.claimedBy].filter(([, rank]) => rank === 1)).toHaveLength(2);
  });

  it("what a hub leaves feeds later hubs, each claim reaching the target or taking what is left", () => {
    expect(r.picks.length).toBeGreaterThanOrEqual(2);
    expect(r.claimedBy.size).toBeGreaterThan(2);
    const claimed = r.picks.flatMap((p) => p.needed.picks.map((s) => s.id));
    expect(new Set(claimed).size).toBe(claimed.length);
    for (const p of r.picks)
      expect(
        p.needed.enough || p.needed.picks.length === p.sellers.length,
      ).toBe(true);
  });

  it("no hub is centred inside an earlier hub's radius", () => {
    for (let i = 0; i < r.picks.length; i++)
      for (let j = i + 1; j < r.picks.length; j++)
        expect(gridDistance(r.picks[i].cell, r.picks[j].cell)).toBeGreaterThan(
          k,
        );
  });
});
