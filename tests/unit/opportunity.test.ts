import { describe, expect, it } from "vitest";
import {
  bandOf,
  countableVolume,
  isExact,
  isReference,
  sellersNeeded,
  shareBin,
  volumeOf,
} from "../../src/lib/opportunity";
import { mk } from "./sellers";

describe("size bands", () => {
  it("cuts at 100, 1,000 and 5,000 with 5,000 still core", () => {
    expect([0, 99, 100, 999, 1000, 5000, 5001].map(bandOf)).toEqual([
      "micro",
      "micro",
      "chico",
      "chico",
      "core",
      "core",
      "enterprise",
    ]);
    expect(bandOf(null)).toBeNull();
  });
});

describe("countable volume", () => {
  it("counts micro, chico and core, never enterprise, references or missing volume", () => {
    expect(countableVolume(mk("1", 1200))).toBe(1200);
    expect(countableVolume(mk("2", 9000))).toBe(0);
    expect(countableVolume(mk("3", null))).toBe(0);
    expect(countableVolume(mk("4", 300, { kind: "dropoff_agency" }))).toBe(0);
  });
  it("reads volume and precision from the map row", () => {
    expect(volumeOf(mk("1", 40))).toBe(40);
    expect(isExact(mk("1", 40, { precision: "street" }))).toBe(true);
    expect(isExact(mk("1", 40, { precision: undefined }))).toBe(true); // older fixtures = doors
    expect(isExact(mk("1", 40))).toBe(false);
    expect(isReference(mk("1", 40, { kind: "partner" }))).toBe(true);
  });
});

describe("sellers needed", () => {
  it("takes the biggest sellers first until the target is reached", () => {
    const r = sellersNeeded(
      [mk("a", 800), mk("b", 2100), mk("c", 920), mk("d", 1300), mk("e", 50)],
      5000,
    );
    expect(r.picks.map((s) => s.id)).toEqual(["b", "d", "c", "a"]);
    expect(r.reached).toBe(5120);
    expect(r.enough).toBe(true);
    expect(r.byBand).toEqual({ micro: 0, chico: 2, core: 2 });
  });
  it("reports a shortfall when everyone together is not enough", () => {
    const r = sellersNeeded([mk("a", 800), mk("b", 9000)], 5000);
    expect(r.picks.map((s) => s.id)).toEqual(["a"]); // enterprise never counts
    expect(r.enough).toBe(false);
    expect(r.reached).toBe(800);
  });
});

describe("opportunity bins", () => {
  it("uses fixed breaks of the target share", () => {
    expect([0.1, 0.25, 0.6, 0.99, 1, 3].map((s) => shareBin(s).label)).toEqual([
      "<25%",
      "25–50%",
      "50–75%",
      "75–100%",
      "100%+",
      "100%+",
    ]);
  });
});
