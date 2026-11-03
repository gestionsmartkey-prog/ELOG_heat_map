import { describe, expect, it } from "vitest";
import {
  NO_FILTERS,
  PROSPECTO_FLEX,
  activeFilterCount,
  applyFilters,
} from "../../src/lib/filters";
import { mk } from "./sellers";

const located = { h3_r9: "89c2e3a2a9bffff" };

describe("applyFilters", () => {
  const sellers = [
    mk("core-si", 2000, {
      ...located,
      attrs: {
        flex_candidate: "si",
        reputation: "5_green",
        power_seller: "gold",
      },
    }),
    mk("chico-prob", 300, {
      ...located,
      attrs: { flex_candidate: "probable", reputation: "3_yellow" },
    }),
    mk("micro-si", 40, { ...located, attrs: { flex_candidate: "si" } }),
    mk("ent", 9000, { ...located, attrs: { flex_candidate: "si" } }),
    mk("novol", null, { ...located, precision: "street" }),
    mk("agency", null, {
      ...located,
      kind: "dropoff_agency",
      precision: "street",
    }),
    mk("unlocated", 500, { h3_r9: null }),
  ];

  it("with no filters keeps every located prospect and splits off references", () => {
    const r = applyFilters(sellers, NO_FILTERS);
    expect(r.kept.map((s) => s.id)).toEqual([
      "core-si",
      "chico-prob",
      "micro-si",
      "ent",
      "novol",
    ]);
    expect(r.references).toEqual([]); // refs switch is off
  });

  it("Prospecto Flex keeps chico + core with Flex sí/probable, and keeps enterprise for the footnote", () => {
    const r = applyFilters(sellers, PROSPECTO_FLEX);
    expect(r.kept.map((s) => s.id)).toEqual(["core-si", "chico-prob", "ent"]);
    expect(r.excluded).toEqual({ noData: 1, filtered: 1 }); // novol has no Flex data, micro-si is too small
  });

  it("reputation and power seller are minimums; missing data never matches", () => {
    const r = applyFilters(sellers, {
      ...NO_FILTERS,
      repMin: 4,
      power: "silver",
    });
    expect(r.kept.map((s) => s.id)).toEqual(["core-si"]);
  });

  it("exact precision keeps doors only and the refs switch returns references", () => {
    const r = applyFilters(sellers, {
      ...NO_FILTERS,
      precision: "exact",
      refs: true,
    });
    expect(r.kept.map((s) => s.id)).toEqual(["novol"]);
    expect(r.references.map((s) => s.id)).toEqual(["agency"]);
  });

  it("counts active filters for the badge", () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
    expect(activeFilterCount(PROSPECTO_FLEX)).toBe(2);
  });
});
