# Hub Opportunity Map Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the seller heat map into a hub-opportunity tool: one opportunity colour scale (% of a 5,000-package target reachable within a radius), a ranked list of hub candidates that never double-count a seller, a cluster panel answering "who do I need to win", and a lean UI.

**Architecture:** Phase 1 is client-only on the existing schema: pure functions in `src/lib` (bands, filters, ranking, view state) unit-tested with vitest, the ranking run in a Web Worker, and the map/panel components rewritten on top. Phases 2 (data foundation) and 3 (sales loop) are outlined here and get their own detailed plan before they start, because their migrations depend on phase 1 being in use.

**Tech Stack:** Next.js 16.3 (App Router, Turbopack), React 19, TypeScript, Tailwind 4 tokens in `src/app/globals.css`, MapLibre GL 6, h3-js 4, vitest 5, Playwright e2e scripts.

**Design:** `docs/plans/2026-11-02-hub-opportunity-map-design.md` (read it first).

---

## Ground rules for the engineer

- **Branch:** `git switch -c feature/hub-opportunity-map docs/hub-opportunity-map-design` (so the design and plan docs ride along). Never commit to `main` or `develop`; open a PR into `develop` at the end.
- **No hand-run SQL that changes data.** Phase 1 touches no database. Read-only queries are fine.
- **Next.js here is not the one you know.** Before touching `page.tsx` or bundling the worker, read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` (searchParams is a Promise) and the Magic Comments section of `node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md` (`new Worker(new URL(...))` is supported).
- **Design tokens only.** Colours, radii, shadows and type come from `src/app/globals.css` utilities (`bg-papel`, `text-gris-700`, `rounded-button`, `shadow-card`, `t-meta`, `t-etiqueta`, `tnum`, `btn`, `btn-light`, `card`, `field`, `pill`). The opportunity ramp and status colours are added as tokens in Task 7.
- **UI copy is Spanish (Argentina, voseo as in the existing app: "Seleccioná", "Acercá").**
- **Checks before every commit:** `npm run typecheck && npm run lint && npm test`.
- **Commit messages** end with a `Business:` line in plain words and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. On Windows write the message to a file and use `git commit -F <file>`.

Production facts the tests are shaped on (2026-11-02): 9,196 public profiles all with `metrics.shipments_month`; 637 door-level sellers of which 309 already carry volume; bands micro 3,258 · chico 3,602 · core 1,858 · enterprise 478 (52% of volume). Hex ring sizes at res 8: 3 km → k3 (37 cells), 5 km → k5 (91), 8 km → k9 (271).

---

# Phase 1 — Lean map (client only)

### Task 1: Size bands, countable volume and "sellers needed"

**Files:**

- Create: `src/lib/opportunity.ts`
- Test: `tests/unit/opportunity.test.ts`
- Create: `tests/unit/sellers.ts` (shared test builder)

**Step 1: Write the failing test**

```ts
// tests/unit/opportunity.test.ts
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
```

Shared seller builder, outside the test files (vitest only runs `*.test.ts`; importing one test file from another would run its tests twice):

```ts
// tests/unit/sellers.ts
import type { MapSeller } from "../../src/lib/types";

export const mk = (
  id: string,
  vol: number | null,
  over: Partial<MapSeller> = {},
): MapSeller => ({
  id,
  external_id: id,
  kind: "seller",
  kind_label: "Seller",
  counts_as_seller: true,
  name: `S${id}`,
  source: "ml_publico",
  opening_hours: null,
  note_address: null,
  location_id: `L${id}`,
  address_display: null,
  locality: "Morón",
  partido: "Morón",
  province: "Buenos Aires",
  postal_code: null,
  lat: -34.65,
  lng: -58.62,
  h3_r9: null,
  geocode_status: "ok",
  precision: "locality",
  attrs: {},
  metrics: vol == null ? {} : { shipments_month: vol },
  ...over,
});
```

```ts
// tests/unit/opportunity.test.ts (continued)
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/opportunity.test.ts`
Expected: FAIL, `Failed to resolve import "../../src/lib/opportunity"`.

**Step 3: Write minimal implementation**

```ts
// src/lib/opportunity.ts
import type { MapSeller } from "./types";

/**
 * Hub sizing rules (design doc §Decisions). A hub is worth opening at a target
 * volume; sellers are banded by monthly packages and enterprise never counts.
 */
export type Band = "micro" | "chico" | "core" | "enterprise";
export type CountedBand = Exclude<Band, "enterprise">;

export const BAND_LABELS: Record<Band, string> = {
  micro: "Micro",
  chico: "Chico",
  core: "Core",
  enterprise: "Enterprise",
};
export const COUNTED_BANDS: CountedBand[] = ["micro", "chico", "core"];

export const DEFAULT_TARGET = 5000;
export const RADII_KM = [3, 5, 8] as const;
export const DEFAULT_RADIUS_KM = 5;

export function bandOf(volume: number | null): Band | null {
  if (volume == null) return null;
  if (volume < 100) return "micro";
  if (volume < 1000) return "chico";
  if (volume <= 5000) return "core";
  return "enterprise";
}

export const volumeOf = (s: MapSeller): number | null =>
  s.metrics?.shipments_month ?? null;

/** Drop-off agencies and partners are map references, never sales targets. */
export const isReference = (s: MapSeller): boolean =>
  s.kind === "dropoff_agency" || s.kind === "partner";

/** Located at the door. Older fixtures have no precision and are doors. */
export const isExact = (s: MapSeller): boolean =>
  (s.precision ?? "street") === "street";

export function countableVolume(s: MapSeller): number {
  if (isReference(s)) return 0;
  const v = volumeOf(s);
  if (v == null || bandOf(v) === "enterprise") return 0;
  return v;
}

export type Needed = {
  picks: MapSeller[];
  reached: number;
  enough: boolean;
  byBand: Record<CountedBand, number>;
};

/** Greedy shortest path to the target: largest countable sellers first. */
export function sellersNeeded(sellers: MapSeller[], target: number): Needed {
  const ranked = sellers
    .filter((s) => countableVolume(s) > 0)
    .sort((a, b) => countableVolume(b) - countableVolume(a));
  const picks: MapSeller[] = [];
  let reached = 0;
  for (const s of ranked) {
    if (reached >= target) break;
    picks.push(s);
    reached += countableVolume(s);
  }
  const byBand: Record<CountedBand, number> = { micro: 0, chico: 0, core: 0 };
  for (const s of picks) byBand[bandOf(volumeOf(s)) as CountedBand] += 1;
  return { picks, reached, enough: reached >= target, byBand };
}

export type ShareBin = { min: number; color: string; label: string };

/** Opportunity ramp, fixed breaks (design doc §2). Colours mirror the --color-opp-* tokens. */
export const SHARE_BINS: ShareBin[] = [
  { min: 0, color: "#FAF0E6", label: "<25%" },
  { min: 0.25, color: "#FFC48F", label: "25–50%" },
  { min: 0.5, color: "#FF9038", label: "50–75%" },
  { min: 0.75, color: "#C13E06", label: "75–100%" },
  { min: 1, color: "#6E2303", label: "100%+" },
];

export function shareBin(share: number): ShareBin {
  let bin = SHARE_BINS[0];
  for (const b of SHARE_BINS) if (share >= b.min) bin = b;
  return bin;
}

export const formatPkgs = (v: number): string =>
  Math.round(v).toLocaleString("es-AR");
export const formatShare = (share: number): string =>
  `${Math.round(share * 100)}%`;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/opportunity.test.ts`
Expected: PASS (6 tests).

**Step 5: Commit**

```bash
git add src/lib/opportunity.ts tests/unit/opportunity.test.ts tests/unit/sellers.ts
git commit -F msg.txt   # feat(map): size bands, countable volume and sellers needed
```

---

### Task 2: Filters with the "Prospecto Flex" preset

**Files:**

- Create: `src/lib/filters.ts`
- Test: `tests/unit/filters.test.ts`

**Step 1: Write the failing test**

```ts
// tests/unit/filters.test.ts
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/filters.test.ts`
Expected: FAIL, cannot resolve `../../src/lib/filters`.

**Step 3: Write minimal implementation**

```ts
// src/lib/filters.ts
import type { MapSeller } from "./types";
import {
  bandOf,
  isExact,
  isReference,
  volumeOf,
  type CountedBand,
} from "./opportunity";

export type FilterState = {
  sizes: CountedBand[]; // empty = any size
  flex: "all" | "si" | "si_probable";
  repMin: number; // 0 = any; 5 = verde ... 1 = rojo
  power: "any" | "silver" | "gold" | "platinum";
  precision: "all" | "exact";
  refs: boolean; // show drop-off agencies and partners as reference dots
};

export const NO_FILTERS: FilterState = {
  sizes: [],
  flex: "all",
  repMin: 0,
  power: "any",
  precision: "all",
  refs: false,
};
/** Default view: the Flex target market (design doc §3). */
export const PROSPECTO_FLEX: FilterState = {
  ...NO_FILTERS,
  sizes: ["chico", "core"],
  flex: "si_probable",
};

export const REPUTATION_OPTIONS = [
  { value: 0, label: "Cualquiera" },
  { value: 5, label: "Verde" },
  { value: 4, label: "Verde claro o mejor" },
  { value: 3, label: "Amarillo o mejor" },
  { value: 2, label: "Naranja o mejor" },
];
export const POWER_OPTIONS: { value: FilterState["power"]; label: string }[] = [
  { value: "any", label: "Cualquiera" },
  { value: "silver", label: "Silver o mejor" },
  { value: "gold", label: "Gold o mejor" },
  { value: "platinum", label: "Platinum" },
];
export const FLEX_OPTIONS: { value: FilterState["flex"]; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "si", label: "Sí" },
  { value: "si_probable", label: "Sí + probable" },
];

const POWER_RANK: Record<string, number> = { silver: 1, gold: 2, platinum: 3 };
/** "5_green" -> 5. Unknown -> 0. */
const repRank = (v: string | undefined): number =>
  v ? Number(v.split("_")[0]) || 0 : 0;

export function activeFilterCount(f: FilterState): number {
  return [
    f.sizes.length > 0,
    f.flex !== "all",
    f.repMin > 0,
    f.power !== "any",
    f.precision !== "all",
  ].filter(Boolean).length;
}

export type FilterResult = {
  kept: MapSeller[];
  references: MapSeller[];
  excluded: { noData: number; filtered: number };
};

type Verdict = "keep" | "noData" | "filtered";

function judge(s: MapSeller, f: FilterState): Verdict {
  const a = s.attrs ?? {};
  if (f.precision === "exact" && !isExact(s)) return "filtered";
  if (f.sizes.length) {
    const band = bandOf(volumeOf(s));
    if (band == null) return "noData";
    // Enterprise is kept so the cluster footnote can count it; it never adds volume.
    if (band !== "enterprise" && !f.sizes.includes(band)) return "filtered";
  }
  if (f.flex !== "all") {
    if (!a.flex_candidate) return "noData";
    const ok =
      f.flex === "si"
        ? a.flex_candidate === "si"
        : a.flex_candidate === "si" || a.flex_candidate === "probable";
    if (!ok) return "filtered";
  }
  if (f.repMin > 0) {
    if (!a.reputation) return "noData";
    if (repRank(a.reputation) < f.repMin) return "filtered";
  }
  if (f.power !== "any") {
    if (!a.power_seller) return "noData";
    if ((POWER_RANK[a.power_seller] ?? 0) < POWER_RANK[f.power])
      return "filtered";
  }
  return "keep";
}

/** Every filter applies to every seller (design doc §3). Unlocated rows never reach the map. */
export function applyFilters(
  sellers: MapSeller[],
  f: FilterState,
): FilterResult {
  const out: FilterResult = {
    kept: [],
    references: [],
    excluded: { noData: 0, filtered: 0 },
  };
  for (const s of sellers) {
    if (!s.h3_r9) continue;
    if (isReference(s)) {
      if (f.refs) out.references.push(s);
      continue;
    }
    const v = judge(s, f);
    if (v === "keep") out.kept.push(s);
    else out.excluded[v] += 1;
  }
  return out;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/filters.test.ts`
Expected: PASS (5 tests).

**Step 5: Commit** — `feat(map): filters with the Prospecto Flex preset`.

---

### Task 3: Radius, cell buckets and clusters

**Files:**

- Create: `src/lib/ranking.ts`
- Test: `tests/unit/ranking.test.ts`

**Step 1: Write the failing test**

```ts
// tests/unit/ranking.test.ts
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ranking.test.ts`
Expected: FAIL, cannot resolve `../../src/lib/ranking`.

**Step 3: Write minimal implementation**

```ts
// src/lib/ranking.ts
import {
  cellToLatLng,
  cellToParent,
  getHexagonEdgeLengthAvg,
  gridDisk,
} from "h3-js";
import type { MapSeller } from "./types";
import {
  bandOf,
  countableVolume,
  isExact,
  sellersNeeded,
  volumeOf,
  type Needed,
} from "./opportunity";

/** Hubs are placed on res-8 cells (about 0.9 km across). */
export const HUB_RES = 8;
const SPACING_KM = getHexagonEdgeLengthAvg(HUB_RES, "km") * Math.sqrt(3);

/** Rings of res-8 hexes that approximate a pickup radius: 3 km -> 3, 5 km -> 5, 8 km -> 9. */
export const radiusToK = (km: number): number =>
  Math.max(1, Math.round(km / SPACING_KM));

export type CellBucket = {
  volume: number;
  exact: number;
  sellers: MapSeller[];
};

export function bucketByCell(sellers: MapSeller[]): Map<string, CellBucket> {
  const out = new Map<string, CellBucket>();
  for (const s of sellers) {
    if (!s.h3_r9) continue;
    const cell = cellToParent(s.h3_r9, HUB_RES);
    const b = out.get(cell) ?? { volume: 0, exact: 0, sellers: [] };
    const v = countableVolume(s);
    b.volume += v;
    if (isExact(s)) b.exact += v;
    b.sellers.push(s);
    out.set(cell, b);
  }
  return out;
}

export type Cluster = {
  cell: string;
  lat: number;
  lng: number;
  name: string;
  volume: number;
  exactVolume: number;
  share: number;
  approxShare: number;
  /** Every seller in the radius except enterprise, by volume (no volume last). */
  sellers: MapSeller[];
  enterprise: number;
  noVolume: number;
  needed: Needed;
};

function topLocality(sellers: MapSeller[]): string {
  const byName = new Map<string, number>();
  for (const s of sellers) {
    const n = s.locality ?? s.partido;
    if (n) byName.set(n, (byName.get(n) ?? 0) + countableVolume(s));
  }
  return (
    [...byName.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    "Zona sin nombre"
  );
}

/** The catchment of a hub at `cell`: what a hub there would collect. */
export function buildCluster(
  cell: string,
  disk: string[],
  buckets: Map<string, CellBucket>,
  target: number,
): Cluster {
  const all: MapSeller[] = [];
  let volume = 0,
    exactVolume = 0;
  for (const c of disk) {
    const b = buckets.get(c);
    if (!b) continue;
    all.push(...b.sellers);
    volume += b.volume;
    exactVolume += b.exact;
  }
  const enterprise = all.filter(
    (s) => bandOf(volumeOf(s)) === "enterprise",
  ).length;
  const sellers = all
    .filter((s) => bandOf(volumeOf(s)) !== "enterprise")
    .sort((a, b) => (volumeOf(b) ?? -1) - (volumeOf(a) ?? -1));
  const [lat, lng] = cellToLatLng(cell);
  return {
    cell,
    lat,
    lng,
    name: topLocality(sellers),
    volume,
    exactVolume,
    share: volume / target,
    approxShare: volume ? (volume - exactVolume) / volume : 0,
    sellers,
    enterprise,
    noVolume: sellers.filter((s) => volumeOf(s) == null).length,
    needed: sellersNeeded(sellers, target),
  };
}

export function clusterAt(
  cell: string,
  buckets: Map<string, CellBucket>,
  k: number,
  target: number,
): Cluster {
  return buildCluster(cell, gridDisk(cell, k), buckets, target);
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ranking.test.ts`
Expected: PASS (4 tests).

**Step 5: Commit** — `feat(map): pickup radius, cell buckets and cluster catchment`.

---

### Task 4: Greedy ranking with seller claiming

**Files:**

- Modify: `src/lib/ranking.ts` (append)
- Test: `tests/unit/ranking.test.ts` (append)

**Step 1: Write the failing test** (append)

```ts
import { rankHubs } from "../../src/lib/ranking";

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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ranking.test.ts`
Expected: FAIL, `rankHubs is not a function` / not exported.

**Step 3: Write minimal implementation** (append to `src/lib/ranking.ts`)

```ts
export type Pick = Cluster & { rank: number };
export type Ranking = {
  picks: Pick[];
  /** Countable volume reachable from each res-8 cell before any claiming: the heat surface. */
  scores: Map<string, number>;
  /** seller id -> rank of the pick that claimed it. */
  claimedBy: Map<string, number>;
};
export type RankOptions = {
  target: number;
  radiusKm: number;
  maxPicks?: number;
  minShare?: number;
};

/**
 * Greedy coverage (design doc §4): score every res-8 cell within the radius of a seller,
 * take the best, claim its sellers, subtract them from every score they fed, repeat. Each package counts once.
 */
export function rankHubs(
  sellers: MapSeller[],
  { target, radiusKm, maxPicks = 10, minShare = 0.25 }: RankOptions,
): Ranking {
  const k = radiusToK(radiusKm);
  const buckets = bucketByCell(sellers);
  const live = new Map(buckets);

  // Each populated cell adds its volume to every cell within k of it (the disk is symmetric),
  // so a candidate's score is built once and later only decreases as sellers are claimed.
  const disks = new Map<string, string[]>();
  const score = new Map<string, { v: number; e: number }>();
  for (const [cell, b] of buckets) {
    if (b.volume <= 0) continue;
    const disk = gridDisk(cell, k);
    disks.set(cell, disk);
    for (const n of disk) {
      const s = score.get(n);
      if (s) { s.v += b.volume; s.e += b.exact; } else score.set(n, { v: b.volume, e: b.exact });
    }
  }
  const scores = new Map([...score].map(([c, s]) => [c, s.v] as [string, number]));

  const picks: Pick[] = [];
  const claimedBy = new Map<string, number>();
  while (picks.length < maxPicks) {
    let best: string | null = null;
    let bs = { v: 0, e: 0 };
    for (const [c, s] of score) {
      if (s.v > bs.v || (s.v === bs.v && s.v > 0 && (s.e > bs.e || (s.e === bs.e && best !== null && c < best)))) { best = c; bs = s; }
    }
    if (!best || bs.v <= 0 || bs.v < minShare * target) break;
    const disk = gridDisk(best, k);
    const rank = picks.length + 1;
    picks.push({ ...buildCluster(best, disk, live, target), rank });
    for (const n of disk) {
      const b = live.get(n);
      if (!b) continue;
      for (const s of b.sellers) claimedBy.set(s.id, rank);
      live.delete(n);
      for (const m of disks.get(n) ?? []) {
        const s = score.get(m);
        if (s) { s.v -= b.volume; s.e -= b.exact; }
      }
    }
  }
  return { picks, scores, claimedBy };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ranking.test.ts`
Expected: PASS (8 tests).

**Step 5: Performance check (not a test, run once)**

Real data is clustered (the 9,196 public profiles sit on about 511 locality centres), so time it on that shape. Save as `scripts/perf-ranking.ts` (do not commit it) and run `npx tsx scripts/perf-ranking.ts`:

```ts
import { rankHubs } from "../src/lib/ranking";
import { latLngToCell } from "h3-js";
// ~511 locality centres carrying 8,700 sellers + ~640 doors spread out
const centres = Array.from({ length: 511 }, () => [-34.4 - Math.random() * 0.6, -58.2 - Math.random() * 0.8]);
const s: never[] = [];
for (let i = 0; i < 8700; i++) { const [lat, lng] = centres[Math.floor(Math.random() ** 2 * 511)]; s.push({ id: "p" + i, kind: "seller", h3_r9: latLngToCell(lat, lng, 9), precision: "locality", locality: "x", metrics: { shipments_month: Math.random() * 3000 } } as never); }
for (let i = 0; i < 640; i++) { const lat = -34.4 - Math.random() * 0.6, lng = -58.2 - Math.random() * 0.8; s.push({ id: "d" + i, kind: "seller", h3_r9: latLngToCell(lat, lng, 9), precision: "street", locality: "x", metrics: { shipments_month: Math.random() * 3000 } } as never); }
for (const r of [3, 5, 8]) { const t = performance.now(); const out = rankHubs(s, { target: 5000, radiusKm: r }); console.log(`${r} km: ${Math.round(performance.now() - t)} ms, ${out.picks.length} picks`); }
```

Expected: roughly 100–150 ms at 3–5 km and about 350 ms at 8 km (measured 2026-11-02 while writing this plan). It runs in a Web Worker, so this never blocks the map. If 8 km goes over 1 s, stop and report before going on. A uniform random spread (every seller in its own cell) is about 2 s at 8 km; that is not the real data, but it is why the scores are built once and only decremented.

**Step 6: Commit** — `feat(map): greedy hub ranking that claims sellers`.

---

### Task 5: View state in the URL

**Files:**

- Create: `src/lib/viewState.ts`
- Test: `tests/unit/viewState.test.ts`

**Step 1: Write the failing test**

```ts
// tests/unit/viewState.test.ts
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/viewState.test.ts` — Expected: FAIL, module not found.

**Step 3: Write minimal implementation**

```ts
// src/lib/viewState.ts
import {
  DEFAULT_RADIUS_KM,
  DEFAULT_TARGET,
  RADII_KM,
  COUNTED_BANDS,
  type CountedBand,
} from "./opportunity";
import {
  NO_FILTERS,
  POWER_OPTIONS,
  FLEX_OPTIONS,
  PROSPECTO_FLEX,
  type FilterState,
} from "./filters";

export type ViewState = {
  target: number;
  radiusKm: number;
  filters: FilterState;
  center?: [number, number];
  zoom?: number;
};
export const DEFAULT_VIEW: ViewState = {
  target: DEFAULT_TARGET,
  radiusKm: DEFAULT_RADIUS_KM,
  filters: PROSPECTO_FLEX,
};

const FILTER_KEYS = ["sz", "fx", "rep", "pw", "pr", "ref"];
const sameFilters = (a: FilterState, b: FilterState) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Short query string for sharing a view; defaults are omitted. */
export function encodeView(v: ViewState): string {
  const q = new URLSearchParams();
  if (v.target !== DEFAULT_TARGET) q.set("t", String(v.target));
  if (v.radiusKm !== DEFAULT_RADIUS_KM) q.set("r", String(v.radiusKm));
  if (!sameFilters(v.filters, PROSPECTO_FLEX)) {
    const f = v.filters;
    q.set("sz", f.sizes.join(","));
    q.set("fx", f.flex);
    q.set("rep", String(f.repMin));
    q.set("pw", f.power);
    q.set("pr", f.precision);
    q.set("ref", f.refs ? "1" : "0");
  }
  if (v.center) q.set("c", v.center.map((n) => n.toFixed(4)).join(","));
  if (v.zoom != null) q.set("z", v.zoom.toFixed(2));
  return q.toString();
}

export function decodeView(query: string): ViewState {
  const q = new URLSearchParams(query);
  const t = Number(q.get("t"));
  const r = Number(q.get("r"));
  const view: ViewState = {
    target: Number.isFinite(t) && t >= 100 ? Math.round(t) : DEFAULT_TARGET,
    radiusKm: (RADII_KM as readonly number[]).includes(r)
      ? r
      : DEFAULT_RADIUS_KM,
    filters: PROSPECTO_FLEX,
  };
  if (FILTER_KEYS.some((k) => q.has(k))) {
    const rep = Number(q.get("rep"));
    view.filters = {
      sizes: (q.get("sz") ?? "")
        .split(",")
        .filter((s): s is CountedBand =>
          (COUNTED_BANDS as string[]).includes(s),
        ),
      flex:
        FLEX_OPTIONS.find((o) => o.value === q.get("fx"))?.value ??
        NO_FILTERS.flex,
      repMin: Number.isInteger(rep) && rep >= 0 && rep <= 5 ? rep : 0,
      power:
        POWER_OPTIONS.find((o) => o.value === q.get("pw"))?.value ??
        NO_FILTERS.power,
      precision: q.get("pr") === "exact" ? "exact" : "all",
      refs: q.get("ref") === "1",
    };
  }
  const c = (q.get("c") ?? "").split(",").map(Number);
  if (c.length === 2 && c.every(Number.isFinite)) view.center = [c[0], c[1]];
  const z = Number(q.get("z"));
  if (q.has("z") && Number.isFinite(z)) view.zoom = z;
  return view;
}
```

Note for the "ignores junk" test: the junk query contains `sz` and `rep`, so filter decoding runs and every invalid value falls back to `NO_FILTERS`; `t=abc` and `r=7` fall back to the defaults.

**Step 4: Run test to verify it passes** — `npx vitest run tests/unit/viewState.test.ts`, Expected: PASS (4 tests).

**Step 5: Commit** — `feat(map): shareable view state in the URL`.

---

### Task 6: Map geometry helpers (opportunity hexes, circle, points)

**Files:**

- Modify: `src/lib/hexes.ts` (replace the file)
- Modify: `tests/unit/hexes.test.ts` (replace the zone-wording and prospect-layer tests)

**Step 1: Write the failing test** (replace `tests/unit/hexes.test.ts`; keep the "zoom resolution" block as it is)

```ts
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
```

**Step 2: Run test to verify it fails** — `npx vitest run tests/unit/hexes.test.ts`, Expected: FAIL, `displayRes` / `opportunityGeoJSON` / `circlePolygon` not exported.

**Step 3: Write minimal implementation** (replace `src/lib/hexes.ts`)

```ts
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
```

`ranking.ts` must not import from `hexes.ts` (it would be circular); it does not.

**Step 4: Run test to verify it passes** — `npm test`. Expected: all unit tests pass. `typecheck` will fail until Task 10 replaces the components that still import the removed helpers; that is expected here, so commit with tests green and note it.

**Step 5: Commit** — `refactor(map): opportunity hex, circle and point helpers`.

---

### Task 7: Colour and component tokens

**Files:**

- Modify: `src/app/globals.css`

**Step 1:** In the `@theme` block, after `--color-azul`, add:

```css
/* Oportunidad: % del objetivo alcanzable (cortes fijos). Mismos valores que SHARE_BINS en src/lib/opportunity.ts */
--color-opp-1: #faf0e6;
--color-opp-2: #ffc48f;
--color-opp-3: #ff9038;
--color-opp-4: #c13e06;
--color-opp-5: #6e2303;
```

**Step 2:** At the end of the "Controles" section add the dock and chip styles:

```css
.dock {
  background: #fff;
  border: 1px solid var(--color-gris-200);
  border-radius: var(--radius-button);
  box-shadow: var(--shadow-card);
  padding: 4px;
  display: flex;
  gap: 4px;
  align-items: center;
}
.seg {
  display: flex;
  border: 1px solid var(--color-gris-200);
  border-radius: var(--radius-field);
  overflow: hidden;
}
.seg button {
  padding: 5px 10px;
  min-height: 32px;
  color: var(--color-grafito);
}
.seg button[aria-pressed="true"] {
  background: var(--color-grafito);
  color: #fff;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-gris-200);
  background: #fff;
  padding: 2px 10px;
  font-size: 12px;
}
.pin {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-pill);
  background: #fff;
  border: 2px solid var(--color-carbon);
  color: var(--color-carbon);
  font-weight: 600;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-ctrl);
  cursor: pointer;
}
.pin[data-active="true"] {
  background: var(--color-carbon);
  color: #fff;
}
:focus-visible {
  outline: 2px solid var(--color-grafito);
  outline-offset: 2px;
}
```

**Step 3:** `npm run lint` (CSS is not linted, but make sure nothing else broke). **Commit** — `style: opportunity ramp, dock, chip and pin tokens`.

---

### Task 8: Ranking in a Web Worker

**Files:**

- Create: `src/lib/ranking.worker.ts`
- Create: `src/components/useRanking.ts`

No unit test (the worker is a thin wrapper around the tested `rankHubs`); it is covered by the e2e run in Task 13.

**Step 1: Worker**

```ts
// src/lib/ranking.worker.ts
import { rankHubs } from "./ranking";
import type { MapSeller } from "./types";

export type RankRequest = {
  id: number;
  sellers: MapSeller[];
  target: number;
  radiusKm: number;
};

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<RankRequest>) => void) | null;
  postMessage: (m: unknown) => void;
};
ctx.onmessage = (e) => {
  const { id, sellers, target, radiusKm } = e.data;
  const r = rankHubs(sellers, { target, radiusKm });
  ctx.postMessage({
    id,
    picks: r.picks,
    scores: [...r.scores],
    claimedBy: [...r.claimedBy],
  });
};
```

**Step 2: Hook** (falls back to the main thread if a worker cannot start)

```ts
// src/components/useRanking.ts
"use client";

import { useEffect, useRef, useState } from "react";
import { rankHubs, type Ranking } from "@/lib/ranking";
import type { MapSeller } from "@/lib/types";

/** Runs the hub ranking off the main thread; the newest request wins. */
export function useRanking(
  sellers: MapSeller[] | null,
  target: number,
  radiusKm: number,
): Ranking | null {
  const [ranking, setRanking] = useState<Ranking | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    try {
      const w = new Worker(
        new URL("../lib/ranking.worker.ts", import.meta.url),
        { type: "module" },
      );
      w.onmessage = (
        e: MessageEvent<{
          id: number;
          picks: Ranking["picks"];
          scores: [string, number][];
          claimedBy: [string, number][];
        }>,
      ) => {
        if (e.data.id !== reqId.current) return;
        setRanking({
          picks: e.data.picks,
          scores: new Map(e.data.scores),
          claimedBy: new Map(e.data.claimedBy),
        });
      };
      workerRef.current = w;
      return () => {
        w.terminate();
        workerRef.current = null;
      };
    } catch {
      workerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!sellers) return;
    const id = ++reqId.current;
    const w = workerRef.current;
    if (w) {
      w.postMessage({ id, sellers, target, radiusKm });
      return;
    }
    const t = setTimeout(() => {
      if (id === reqId.current)
        setRanking(rankHubs(sellers, { target, radiusKm }));
    }, 0);
    return () => clearTimeout(t);
  }, [sellers, target, radiusKm]);

  return ranking;
}
```

**Step 3:** `npm run typecheck` will still fail on old components; check only these two files compile: `npx tsc --noEmit -p . 2>&1 | grep -E "ranking.worker|useRanking"` → Expected: no lines.

**Step 4: Commit** — `feat(map): run the hub ranking in a web worker`.

---

### Task 9: Panel components (list, cluster, seller)

**Files:**

- Create: `src/components/OpportunityList.tsx`
- Create: `src/components/ClusterPanel.tsx`
- Create: `src/components/SellerDetail.tsx`
- Delete: `src/components/Panel.tsx` (one file, `git rm src/components/Panel.tsx`)

**Step 1: OpportunityList**

```tsx
// src/components/OpportunityList.tsx
import { useMemo, useState } from "react";
import type { Pick } from "@/lib/ranking";
import { formatPkgs, formatShare, shareBin } from "@/lib/opportunity";

type Props = {
  picks: Pick[] | null;
  radiusKm: number;
  hovered: number | null;
  onHover: (rank: number | null) => void;
  onOpen: (p: Pick) => void;
};

/** Default panel: ranked hub candidates (design doc §4). */
export function OpportunityList({
  picks,
  radiusKm,
  hovered,
  onHover,
  onOpen,
}: Props) {
  const [sort, setSort] = useState<"volume" | "fewest">("volume");
  const rows = useMemo(() => {
    const list = [...(picks ?? [])];
    if (sort === "fewest")
      list.sort(
        (a, b) =>
          Number(b.needed.enough) - Number(a.needed.enough) ||
          a.needed.picks.length - b.needed.picks.length,
      );
    return list;
  }, [picks, sort]);

  return (
    <aside
      className="flex min-h-0 flex-1 flex-col"
      data-testid="opportunity-list"
    >
      <div className="flex items-center justify-between gap-2 border-b border-gris-200 px-4 py-3 lg:px-6">
        <h2 className="t-etiqueta text-gris-700">
          Top oportunidades · {radiusKm} km
        </h2>
        <div className="seg t-micro" role="group" aria-label="Ordenar">
          <button
            type="button"
            aria-pressed={sort === "volume"}
            onClick={() => setSort("volume")}
          >
            Más volumen
          </button>
          <button
            type="button"
            aria-pressed={sort === "fewest"}
            onClick={() => setSort("fewest")}
          >
            Menos sellers
          </button>
        </div>
      </div>
      {picks == null ? (
        <p className="p-4 text-gris-700 lg:p-6">Calculando oportunidades…</p>
      ) : rows.length === 0 ? (
        <p className="p-4 text-gris-700 lg:p-6">
          Ninguna zona llega al 25% del objetivo con estos filtros. Probá un
          radio mayor o limpiá los filtros.
        </p>
      ) : (
        <ol className="flex-1 divide-y divide-gris-200 overflow-y-auto">
          {rows.map((p) => (
            <li key={p.cell}>
              <button
                type="button"
                className={`grid w-full grid-cols-[28px_1fr_auto] items-center gap-3 px-4 py-3 text-left lg:px-6 ${hovered === p.rank ? "bg-papel" : "hover:bg-papel"}`}
                onMouseEnter={() => onHover(p.rank)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(p.rank)}
                onBlur={() => onHover(null)}
                onClick={() => onOpen(p)}
                data-testid="opportunity-row"
              >
                <span className="pin" aria-hidden="true">
                  {p.rank}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-carbon">
                    {p.name}
                  </span>
                  <span className="t-micro block text-gris-700 tnum">
                    {formatPkgs(p.volume)} paq/mes ·{" "}
                    {p.needed.enough
                      ? `necesitás ${p.needed.picks.length} (${neededMix(p)})`
                      : "no llega al objetivo"}
                  </span>
                  <span className="mt-1 block h-1 overflow-hidden rounded-pill bg-gris-200">
                    <span
                      className="block h-full"
                      style={{
                        width: `${Math.min(100, p.share * 100)}%`,
                        background: shareBin(p.share).color,
                      }}
                    />
                  </span>
                </span>
                <span className="t-dato tnum text-carbon">
                  {formatShare(p.share)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

export function neededMix(p: Pick): string {
  const { core, chico, micro } = p.needed.byBand;
  return [
    core && `${core} core`,
    chico && `${chico} ${chico === 1 ? "chico" : "chicos"}`,
    micro && `${micro} micro`,
  ]
    .filter(Boolean)
    .join(" + ");
}
```

**Step 2: ClusterPanel**

```tsx
// src/components/ClusterPanel.tsx
import type { Cluster } from "@/lib/ranking";
import type { MapSeller } from "@/lib/types";
import {
  BAND_LABELS,
  bandOf,
  formatPkgs,
  formatShare,
  isExact,
  shareBin,
  volumeOf,
} from "@/lib/opportunity";

type Props = {
  cluster: Cluster & { rank?: number };
  radiusKm: number;
  target: number;
  claimedBy: Map<string, number>;
  excluded: { noData: number; filtered: number };
  onBack: () => void;
  onSeller: (s: MapSeller) => void;
};

const MIX_COLORS = {
  micro: "var(--color-opp-2)",
  chico: "var(--color-opp-3)",
  core: "var(--color-opp-4)",
} as const;

export function ClusterPanel({
  cluster: c,
  radiusKm,
  target,
  claimedBy,
  excluded,
  onBack,
  onSeller,
}: Props) {
  const mix = (["micro", "chico", "core"] as const).map((band) => {
    const rows = c.sellers.filter((s) => bandOf(volumeOf(s)) === band);
    return {
      band,
      count: rows.length,
      volume: rows.reduce((sum, s) => sum + (volumeOf(s) ?? 0), 0),
    };
  });
  const missing = Math.max(0, target - c.volume);
  const copyLink = () => {
    void navigator.clipboard?.writeText(window.location.href);
  };

  return (
    <aside
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      data-testid="panel-cell"
    >
      <div className="space-y-4 border-b border-gris-200 p-4 lg:p-6">
        <button
          type="button"
          onClick={onBack}
          className="text-tostado hover:underline"
        >
          ← Oportunidades
        </button>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="t-h3 text-carbon">
              {c.rank ? `${c.rank} · ` : ""}
              {c.name}
            </h2>
            <p className="t-micro text-gris-700">radio {radiusKm} km</p>
          </div>
          <button
            type="button"
            className="btn btn-light t-meta"
            onClick={copyLink}
          >
            Copiar link
          </button>
        </div>
        <div>
          <div className="flex items-baseline gap-2">
            <span className="t-display-lg text-carbon">
              {formatPkgs(c.volume)}
            </span>
            <span className="text-gris-700">paq/mes alcanzables (est.)</span>
            <span className="t-dato ml-auto tnum">{formatShare(c.share)}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-pill bg-gris-200">
            <div
              className="h-full"
              style={{
                width: `${Math.min(100, c.share * 100)}%`,
                background: shareBin(c.share).color,
              }}
            />
          </div>
          <p className="t-micro mt-1 text-gris-700">
            {missing
              ? `Faltan ${formatPkgs(missing)} paq/mes para el objetivo de ${formatPkgs(target)}`
              : `Cubre el objetivo de ${formatPkgs(target)}`}
          </p>
        </div>
        {c.needed.picks.length ? (
          <div className="rounded-button bg-papel p-3" data-testid="needed">
            <p className="font-medium text-carbon">
              {c.needed.enough
                ? `Ganando estos ${c.needed.picks.length} llegás a ${formatPkgs(c.needed.reached)}`
                : `Todos juntos suman ${formatPkgs(c.needed.reached)}`}
            </p>
            <ul className="t-meta mt-2 space-y-1">
              {c.needed.picks.slice(0, 8).map((s) => (
                <li key={s.id} className="grid grid-cols-[1fr_auto_auto] gap-3">
                  <span className="truncate">
                    {s.name}
                    {isExact(s) ? "" : " ≈"}
                  </span>
                  <span className="text-gris-700">
                    {BAND_LABELS[bandOf(volumeOf(s))!]}
                  </span>
                  <span className="tnum">{formatPkgs(volumeOf(s)!)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div>
          <p className="t-micro mb-1 text-gris-700">
            Mix por tamaño (sellers · paq/mes)
          </p>
          <div className="flex h-2.5 gap-px overflow-hidden rounded-field">
            {mix.map((m) =>
              m.volume ? (
                <div
                  key={m.band}
                  style={{ flex: m.volume, background: MIX_COLORS[m.band] }}
                />
              ) : null,
            )}
          </div>
          <div className="t-micro mt-1 flex justify-between text-gris-700 tnum">
            {mix.map((m) => (
              <span key={m.band}>
                {BAND_LABELS[m.band].toLowerCase()} {m.count} ·{" "}
                {formatPkgs(m.volume)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="t-micro px-4 pt-4 text-gris-700 lg:px-6">
        Sellers ({c.sellers.length}) · por volumen
      </p>
      <ul className="divide-y divide-gris-200" data-testid="door-list">
        {c.sellers.map((s) => {
          const v = volumeOf(s);
          const other = claimedBy.get(s.id);
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSeller(s)}
                className="grid w-full grid-cols-[1fr_auto] gap-3 px-4 py-3 text-left hover:bg-papel lg:px-6"
              >
                <span className="min-w-0">
                  <span className="block truncate text-carbon">
                    {s.name}
                    {isExact(s) ? "" : " ≈"}
                  </span>
                  <span className="t-micro block text-gris-700">
                    {[
                      v == null ? "sin volumen" : BAND_LABELS[bandOf(v)!],
                      flexLabel(s),
                      repLabel(s),
                      other && other !== c.rank ? `en hub #${other}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="tnum text-carbon">
                  {v == null ? "—" : formatPkgs(v)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p
        className="t-micro border-t border-gris-200 p-4 text-gris-700 lg:px-6"
        data-testid="cluster-footnote"
      >
        {[
          `${Math.round(c.approxShare * 100)}% ubicación aproximada`,
          c.noVolume && `${c.noVolume} sin volumen`,
          c.enterprise && `${c.enterprise} enterprise excluidos`,
          excluded.noData + excluded.filtered &&
            `${excluded.noData + excluded.filtered} excluidos por filtros en todo el mapa`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </aside>
  );
}

const flexLabel = (s: MapSeller) =>
  s.attrs?.flex_candidate === "si"
    ? "Flex sí"
    : s.attrs?.flex_candidate === "probable"
      ? "Flex probable"
      : null;
const REP: Record<string, string> = {
  "5": "verde",
  "4": "verde claro",
  "3": "amarillo",
  "2": "naranja",
  "1": "rojo",
};
const repLabel = (s: MapSeller) =>
  s.attrs?.reputation ? (REP[s.attrs.reputation.split("_")[0]] ?? null) : null;
```

Note: the footnote's filter count is map-wide because `applyFilters` does not know cells. Say "en todo el mapa" as written; per-cluster counts arrive with phase 2's views.

**Step 3: SellerDetail** — move the seller branch of the old `Panel.tsx` into its own component and add volume and profile:

```tsx
// src/components/SellerDetail.tsx
import type { MapSeller } from "@/lib/types";
import {
  BAND_LABELS,
  bandOf,
  formatPkgs,
  isExact,
  volumeOf,
} from "@/lib/opportunity";

export function SellerDetail({
  seller: s,
  onBack,
}: {
  seller: MapSeller;
  onBack: () => void;
}) {
  const v = volumeOf(s);
  const profile = s.attrs?.profile_url;
  return (
    <aside
      className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 lg:p-6"
      data-testid="panel-seller"
    >
      <button
        type="button"
        onClick={onBack}
        className="mb-4 self-start text-tostado hover:underline"
      >
        ← Volver al cluster
      </button>
      <h2 className="t-h3 text-carbon">{s.name}</h2>
      <p className="mt-1 text-gris-700">id {s.external_id}</p>
      <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
        <dt className="text-gris-700">Volumen</dt>
        <dd className="tnum">
          {v == null
            ? "sin dato"
            : `${formatPkgs(v)} paq/mes (est.) · ${BAND_LABELS[bandOf(v)!]}`}
        </dd>
        <dt className="text-gris-700">Domicilio</dt>
        <dd>
          {isExact(s)
            ? (s.address_display ?? "—")
            : `Aproximado: centro de ${s.locality ?? s.partido ?? "la zona"}`}
          {s.address_edited ? (
            <span className="t-micro ml-2 text-gris-700">
              (corregido a mano)
            </span>
          ) : null}
        </dd>
        {s.unit ? (
          <>
            <dt className="text-gris-700">Unidad</dt>
            <dd>{s.unit}</dd>
          </>
        ) : null}
        <dt className="text-gris-700">Localidad</dt>
        <dd>{[s.locality, s.partido].filter(Boolean).join(" · ") || "—"}</dd>
        <dt className="text-gris-700">Provincia</dt>
        <dd>
          {s.province ?? "—"}
          {s.postal_code ? ` · CP ${s.postal_code}` : ""}
        </dd>
        {s.attrs?.flex_candidate ? (
          <>
            <dt className="text-gris-700">Candidato Flex</dt>
            <dd>{s.attrs.flex_candidate}</dd>
          </>
        ) : null}
        {s.attrs?.reputation ? (
          <>
            <dt className="text-gris-700">Reputación</dt>
            <dd>{s.attrs.reputation.replace(/^\d_/, "").replace("_", " ")}</dd>
          </>
        ) : null}
        {s.attrs?.power_seller ? (
          <>
            <dt className="text-gris-700">Power seller</dt>
            <dd>{s.attrs.power_seller}</dd>
          </>
        ) : null}
        {s.opening_hours ? (
          <>
            <dt className="text-gris-700">Horario</dt>
            <dd>{s.opening_hours}</dd>
          </>
        ) : null}
        {s.note_address ? (
          <>
            <dt className="text-ambar">Nota</dt>
            <dd className="text-ambar">
              Indica {s.note_address}, distinto del domicilio registrado.
            </dd>
          </>
        ) : null}
      </dl>
      {profile ? (
        <a
          href={profile}
          target="_blank"
          rel="noreferrer"
          className="btn btn-light mt-6 self-start"
        >
          Ver perfil en Mercado Libre
        </a>
      ) : null}
    </aside>
  );
}
```

Check first that `profile_url` reaches `attrs`: `grep -n "ATTR_FIELDS" src/ingest/pipeline.ts`. If `profile_url` is not in `ATTR_FIELDS`, the link simply does not render in phase 1 (phase 2 adds the typed column). Do not change the ingest pipeline in this phase.

**Step 4:** `npx tsc --noEmit -p . 2>&1 | grep -E "OpportunityList|ClusterPanel|SellerDetail"` → no lines. **Commit** — `feat(map): opportunity list, cluster panel and seller detail`.

---

### Task 10: Map view rewrite

**Files:**

- Modify: `src/components/MapView.tsx` (replace)
- Modify: `src/components/Legend.tsx` (replace)

**Step 1: Legend**

```tsx
// src/components/Legend.tsx
import { SHARE_BINS } from "@/lib/opportunity";

/** One legend on the opportunity scale. Fixed breaks, so a colour always means the same share. */
export function Legend({ radiusKm }: { radiusKm: number }) {
  return (
    <div
      className="card t-micro pointer-events-auto px-3 py-2 shadow-card"
      data-testid="legend"
    >
      <p className="mb-1 text-gris-700">% del objetivo a {radiusKm} km</p>
      <div className="flex gap-0.5">
        {SHARE_BINS.map((b) => (
          <span
            key={b.label}
            className="block h-2.5 w-7 rounded-field"
            style={{ background: b.color }}
            title={b.label}
          />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-gris-700">
        <span>&lt;25%</span>
        <span>100%+</span>
      </div>
    </div>
  );
}
```

**Step 2: MapView** — keep `BASEMAP`, `BLANK_STYLE`, `resolveStyle`, `AMBA_BOUNDS`, `ARGENTINA_BOUNDS`, `HOME_CENTER` and the worker URL setup from the current file verbatim; replace the rest:

```tsx
type Props = {
  scores: Map<string, number> | null;
  target: number;
  radiusKm: number;
  pins: Pick[]; // top 5
  exact: MapSeller[]; // door-level prospects, dots at street zoom
  references: MapSeller[]; // agencies and partners when the switch is on
  focus: { lat: number; lng: number; solid: boolean } | null;
  activeRank: number | null;
  initialView?: { center?: [number, number]; zoom?: number };
  onHexClick: (cell8: string) => void;
  onPinHover: (rank: number | null) => void;
  onPinClick: (rank: number) => void;
  onMove: (center: [number, number], zoom: number) => void;
};
```

Behaviour to implement (each bullet maps to code in the component):

- Sources: `hexes` (opportunity polygons, `promoteId: "cell"`), `focus` (one circle), `points` (exact sellers), `refs` (references).
- Layers, bottom to top: `hex-fill` (`fill-color: ["get","color"]`, opacity 0.75, 0.9 on hover feature-state); `hex-line` (`line-color`: selected → `#2A2726`, `top` → `#2A2726`, else `#FFFFFF`; width selected 2.5, top 1.5, else 0.6); `focus-fill` (`#2A2726` at 0.04 opacity, filter `["==",["get","solid"],true]`); `focus-dash` (dasharray `[2,2]`, width 1.5, filter solid false); `focus-line` (width 2, filter solid true); `points` (minzoom 13.5, orange `#FF9038`, stroke `#3F3E3E`); `refs` (minzoom 11, `match` on kind: dropoff_agency `#2B6E8F`, partner `#2E7D5B`).
- `hexes` data: `opportunityGeoJSON(scores ?? new Map(), target, displayRes(zoom))`, memoised on `[scores, target, zoom-derived res]`. Keep `data-hexes={features.length}` and `data-ready` on the wrapper (e2e reads them).
- Hover on `hex-fill`: popup `<strong>{formatShare(share)}</strong> del objetivo<br/>{formatPkgs(volume)} paq/mes a {radiusKm} km`.
- Click on `hex-fill`: if `displayRes(zoom) < 8`, `flyTo` the cell centre at zoom 12 (coarse hexes are not hubs); else `onHexClick(cell)`. Click on empty map: `onHexClick` is not called (the panel stays as it is).
- Pins: DOM markers (`maplibregl.Marker` with a `<button class="pin">` element, `aria-label="Oportunidad {rank}: {name}"`), recreated when `pins` change; `data-active` set when `rank === activeRank`; mouseenter/leave → `onPinHover`; click → `onPinClick`. DOM markers render without basemap fonts, like the old locality labels.
- `focus`: `circlePolygon(focus.lat, focus.lng, radiusKm)` with `properties.solid = focus.solid`; empty collection when null.
- Selection outline: `setFeatureState({source:"hexes", id}, {selected})` for `focus` cell when solid (pass the cell via `focus`, add `cell?: string` to the type).
- `moveend` → `onMove([lng, lat], zoom)`; initial `center`/`zoom` from `initialView` when present.
- Remove: locality label markers, approximate layer, two legends, "Ver todo" stays (fit to `scores` keys plus `exact` points).
- Legend: `<Legend radiusKm={radiusKm} />` bottom-left.

**Step 3:** `npx tsc --noEmit -p . 2>&1 | grep MapView` → no lines. **Commit** — `feat(map): opportunity heat, numbered pins and hub radius on the map`.

---

### Task 11: Header, dock and filters popover

**Files:**

- Modify: `src/components/TopBar.tsx` (replace)
- Create: `src/components/MapDock.tsx`

**Step 1: TopBar** — one row: logo, `t-etiqueta` "Oportunidades", KPIs in the middle, one menu.

```tsx
// src/components/TopBar.tsx
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SellersResponse } from "@/lib/types";
import { formatPkgs } from "@/lib/opportunity";

type Props = {
  data: SellersResponse | null;
  kpis: { sellers: number; packages: number; hubs: number } | null;
};

export function TopBar({ data, kpis }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !ref.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const latest = data?.batches?.[0];
  const reviews = data?.stats.open_reviews ?? 0;

  return (
    <header className="flex items-center gap-4 bg-grafito px-[var(--gutter)] py-2 text-white shadow-ctrl lg:px-[var(--gutter-lg)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/elog-logo-white.svg"
        alt="ELOG"
        width={100}
        height={30}
        className="h-[var(--size-logo)] w-auto"
      />
      <span className="t-etiqueta hidden text-white/70 sm:block">
        Oportunidades
      </span>
      <div
        className="mx-auto hidden items-baseline gap-6 md:flex"
        data-testid="stats"
      >
        {kpis ? (
          <>
            <span>
              <b className="t-dato">{formatPkgs(kpis.sellers)}</b>{" "}
              <span className="t-meta text-white/70">sellers</span>
            </span>
            <span>
              <b className="t-dato">{formatPkgs(kpis.packages)}</b>{" "}
              <span className="t-meta text-white/70">paq/mes</span>
            </span>
            <span>
              <b className="t-dato">{kpis.hubs}</b>{" "}
              <span className="t-meta text-white/70">oportunidades</span>
            </span>
          </>
        ) : (
          <span className="text-white/60">Cargando…</span>
        )}
      </div>
      <div className="relative ml-auto md:ml-0" ref={ref}>
        <button
          type="button"
          className="btn btn-ghost"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((o) => !o)}
          data-testid="menu-button"
        >
          Menú
          {reviews ? (
            <span className="ml-2 rounded-pill bg-naranja px-1.5 text-carbon t-micro">
              {reviews}
            </span>
          ) : null}
        </button>
        {open ? (
          <nav
            role="menu"
            className="card absolute right-0 top-full z-40 mt-2 flex w-64 flex-col p-2 text-carbon shadow-pop"
          >
            {data?.viewer ? (
              <p className="t-micro px-2 py-1 text-gris-700">{data.viewer}</p>
            ) : null}
            {latest ? (
              <p className="t-micro px-2 pb-2 text-gris-700">
                Último archivo: {latest.filename},{" "}
                {new Date(latest.created_at).toLocaleDateString("es-AR")}
              </p>
            ) : null}
            <Link
              role="menuitem"
              href="/revisar"
              className="rounded-button px-2 py-2 hover:bg-papel"
              data-testid="review-link"
            >
              Revisar{reviews ? ` (${reviews})` : ""}
            </Link>
            <Link
              role="menuitem"
              href="/importar"
              className="rounded-button px-2 py-2 hover:bg-papel"
              data-testid="import-link"
            >
              Importar
            </Link>
            {data?.viewer_role === "admin" ? (
              <Link
                role="menuitem"
                href="/usuarios"
                className="rounded-button px-2 py-2 hover:bg-papel"
                data-testid="users-link"
              >
                Usuarios
              </Link>
            ) : null}
            <form method="post" action="/api/logout">
              <button
                role="menuitem"
                className="w-full rounded-button px-2 py-2 text-left hover:bg-papel"
              >
                Salir
              </button>
            </form>
          </nav>
        ) : null}
      </div>
    </header>
  );
}
```

"Hubs en curso" becomes "oportunidades" (count of picks) in phase 1; phase 3 switches it to saved hubs in progress.

**Step 2: MapDock** — target, radius, filters button, popover, chips.

```tsx
// src/components/MapDock.tsx
"use client";

import { useState } from "react";
import { RADII_KM, BAND_LABELS, COUNTED_BANDS } from "@/lib/opportunity";
import {
  FLEX_OPTIONS,
  NO_FILTERS,
  POWER_OPTIONS,
  PROSPECTO_FLEX,
  REPUTATION_OPTIONS,
  activeFilterCount,
  type FilterState,
} from "@/lib/filters";

type Props = {
  target: number;
  onTarget: (n: number) => void;
  radiusKm: number;
  onRadius: (km: number) => void;
  filters: FilterState;
  onFilters: (f: FilterState) => void;
  excluded: { noData: number; filtered: number };
};

export function MapDock({
  target,
  onTarget,
  radiusKm,
  onRadius,
  filters,
  onFilters,
  excluded,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(target));
  const set = (patch: Partial<FilterState>) =>
    onFilters({ ...filters, ...patch });
  const commitTarget = () => {
    const n = Math.round(Number(draft));
    if (Number.isFinite(n) && n >= 100) onTarget(n);
    else setDraft(String(target));
  };
  const chips = filterChips(filters, set);

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-20 flex max-w-[calc(100%-24px)] flex-col items-start gap-2">
      <div className="dock pointer-events-auto t-meta">
        <label className="flex items-center gap-2 px-2">
          <span className="text-gris-700">Objetivo</span>
          <input
            className="field w-20 py-1 tnum"
            inputMode="numeric"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitTarget}
            onKeyDown={(e) => e.key === "Enter" && commitTarget()}
            aria-label="Objetivo de paquetes por mes"
            data-testid="target-input"
          />
        </label>
        <div className="seg" role="group" aria-label="Radio del hub">
          {RADII_KM.map((km) => (
            <button
              key={km}
              type="button"
              aria-pressed={radiusKm === km}
              onClick={() => onRadius(km)}
              data-testid={`radius-${km}`}
            >
              {km}
              {km === RADII_KM[RADII_KM.length - 1] ? " km" : ""}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-light"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          data-testid="filters-button"
        >
          Filtros
          {activeFilterCount(filters) ? ` · ${activeFilterCount(filters)}` : ""}
        </button>
      </div>
      {chips.length ? (
        <div
          className="pointer-events-auto flex flex-wrap items-center gap-1"
          data-testid="filter-chips"
        >
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              className="chip"
              onClick={c.clear}
              aria-label={`Quitar filtro ${c.label}`}
            >
              {c.label} ×
            </button>
          ))}
          <button
            type="button"
            className="t-micro text-tostado hover:underline"
            onClick={() => onFilters(NO_FILTERS)}
          >
            Limpiar
          </button>
        </div>
      ) : null}
      {open ? (
        <div
          className="card pointer-events-auto t-meta grid w-[min(360px,calc(100vw-24px))] grid-cols-[120px_1fr] items-center gap-x-3 gap-y-3 p-4 shadow-pop"
          data-testid="filters-popover"
        >
          <span className="text-gris-700">Tamaño</span>
          <div className="seg" role="group" aria-label="Tamaño">
            {COUNTED_BANDS.map((b) => (
              <button
                key={b}
                type="button"
                aria-pressed={filters.sizes.includes(b)}
                onClick={() =>
                  set({
                    sizes: filters.sizes.includes(b)
                      ? filters.sizes.filter((x) => x !== b)
                      : [...filters.sizes, b],
                  })
                }
              >
                {BAND_LABELS[b]}
              </button>
            ))}
          </div>
          <span className="text-gris-700">Candidato Flex</span>
          <select
            className="field py-1"
            value={filters.flex}
            onChange={(e) =>
              set({ flex: e.target.value as FilterState["flex"] })
            }
          >
            {FLEX_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="text-gris-700">Reputación mín.</span>
          <select
            className="field py-1"
            value={filters.repMin}
            onChange={(e) => set({ repMin: Number(e.target.value) })}
          >
            {REPUTATION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="text-gris-700">Power seller</span>
          <select
            className="field py-1"
            value={filters.power}
            onChange={(e) =>
              set({ power: e.target.value as FilterState["power"] })
            }
          >
            {POWER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="text-gris-700">Ubicación</span>
          <select
            className="field py-1"
            value={filters.precision}
            onChange={(e) =>
              set({ precision: e.target.value as FilterState["precision"] })
            }
          >
            <option value="all">Todas</option>
            <option value="exact">Solo domicilio exacto</option>
          </select>
          <span className="text-gris-700">Referencias</span>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={filters.refs}
              onChange={(e) => set({ refs: e.target.checked })}
            />{" "}
            Centros de envío y partners
          </label>
          <span />
          <div className="t-micro flex flex-wrap items-center justify-between gap-2 text-gris-700">
            <span>
              {excluded.noData ? `${excluded.noData} sin dato, excluidos` : ""}
            </span>
            <button
              type="button"
              className="text-tostado hover:underline"
              onClick={() => onFilters(PROSPECTO_FLEX)}
            >
              Volver a Prospecto Flex
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function filterChips(
  f: FilterState,
  set: (p: Partial<FilterState>) => void,
): { label: string; clear: () => void }[] {
  const out: { label: string; clear: () => void }[] = [];
  if (f.sizes.length)
    out.push({
      label: f.sizes.map((b) => BAND_LABELS[b]).join(" + "),
      clear: () => set({ sizes: [] }),
    });
  if (f.flex !== "all")
    out.push({
      label: `Flex ${FLEX_OPTIONS.find((o) => o.value === f.flex)!.label.toLowerCase()}`,
      clear: () => set({ flex: "all" }),
    });
  if (f.repMin)
    out.push({
      label: `Rep. ${REPUTATION_OPTIONS.find((o) => o.value === f.repMin)!.label.toLowerCase()}`,
      clear: () => set({ repMin: 0 }),
    });
  if (f.power !== "any")
    out.push({
      label: `Power ${POWER_OPTIONS.find((o) => o.value === f.power)!.label.toLowerCase()}`,
      clear: () => set({ power: "any" }),
    });
  if (f.precision !== "all")
    out.push({
      label: "Solo domicilio exacto",
      clear: () => set({ precision: "all" }),
    });
  return out;
}
```

On mobile (`max-md`), wrap the dock contents behind one "Ajustes" button: render the same `dock` div inside a toggled container with `max-md:hidden` / a `md:hidden` button that toggles it. Keep a single instance in the DOM (the existing TopBar pattern).

**Step 3:** `npx tsc --noEmit -p . 2>&1 | grep -E "TopBar|MapDock"` → no lines. **Commit** — `feat(map): one-row header and floating map dock with filters`.

---

### Task 12: Wire it together and remove the old layer code

**Files:**

- Modify: `src/app/page.tsx`
- Modify: `src/components/HeatMapApp.tsx` (replace)
- Delete: `src/lib/metrics.ts`, `src/lib/layers.ts` (`git rm` each, one at a time)

**Step 1: page.tsx** — read the query on the server so the first render matches the URL.

```tsx
import { HeatMapApp } from "@/components/HeatMapApp";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp))
    if (typeof v === "string") q.set(k, v);
  return <HeatMapApp initialQuery={q.toString()} />;
}
```

**Step 2: HeatMapApp**

```tsx
"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { applyFilters } from "@/lib/filters";
import {
  bucketByCell,
  clusterAt,
  radiusToK,
  type Cluster,
  type Pick,
} from "@/lib/ranking";
import { countableVolume, isExact } from "@/lib/opportunity";
import { decodeView, encodeView, type ViewState } from "@/lib/viewState";
import type { MapSeller, SellersResponse } from "@/lib/types";
import { TopBar } from "./TopBar";
import { MapDock } from "./MapDock";
import { OpportunityList } from "./OpportunityList";
import { ClusterPanel } from "./ClusterPanel";
import { SellerDetail } from "./SellerDetail";
import { useRanking } from "./useRanking";

const MapView = dynamic(() => import("./MapView").then((m) => m.MapView), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-gris-700">
      Cargando mapa…
    </div>
  ),
});

type Selection =
  { kind: "pick"; rank: number } | { kind: "cell"; cluster: Cluster } | null;

export function HeatMapApp({ initialQuery }: { initialQuery: string }) {
  const [data, setData] = useState<SellersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewState>(() => decodeView(initialQuery));
  const [selection, setSelection] = useState<Selection>(null);
  const [seller, setSeller] = useState<MapSeller | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sellers", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 401) {
          window.location.href = "/login";
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => {
        if (!cancelled && j) setData(j as SellersResponse);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the URL in step with the view, without adding history entries.
  useEffect(() => {
    const qs = encodeView(view);
    window.history.replaceState(
      null,
      "",
      qs ? `?${qs}` : window.location.pathname,
    );
  }, [view]);

  const filtered = useMemo(
    () => (data ? applyFilters(data.sellers, view.filters) : null),
    [data, view.filters],
  );
  const ranking = useRanking(
    filtered?.kept ?? null,
    view.target,
    view.radiusKm,
  );
  const buckets = useMemo(
    () => (filtered ? bucketByCell(filtered.kept) : null),
    [filtered],
  );

  // A change of target, radius or filters invalidates what is open in the panel.
  const viewKey = `${view.target}|${view.radiusKm}|${JSON.stringify(view.filters)}`;
  const [lastKey, setLastKey] = useState(viewKey);
  if (viewKey !== lastKey) {
    setLastKey(viewKey);
    setSelection(null);
    setSeller(null);
  }

  const pick: Pick | null =
    selection?.kind === "pick"
      ? (ranking?.picks.find((p) => p.rank === selection.rank) ?? null)
      : null;
  const cluster: (Cluster & { rank?: number }) | null =
    pick ?? (selection?.kind === "cell" ? selection.cluster : null);
  const focusOf = (
    c: { lat: number; lng: number; cell: string } | null | undefined,
    solid: boolean,
  ) => (c ? { lat: c.lat, lng: c.lng, cell: c.cell, solid } : null);
  const hoveredPick =
    hovered != null
      ? ranking?.picks.find((p) => p.rank === hovered)
      : undefined;
  const focus = cluster ? focusOf(cluster, true) : focusOf(hoveredPick, false);

  const onHexClick = useCallback(
    (cell: string) => {
      if (!buckets) return;
      setSeller(null);
      setSelection({
        kind: "cell",
        cluster: clusterAt(
          cell,
          buckets,
          radiusToK(view.radiusKm),
          view.target,
        ),
      });
    },
    [buckets, view.radiusKm, view.target],
  );
  const onMove = useCallback(
    (center: [number, number], zoom: number) =>
      setView((v) => ({ ...v, center, zoom })),
    [],
  );

  const kpis =
    filtered && ranking
      ? {
          sellers: filtered.kept.length,
          packages: filtered.kept.reduce(
            (sum, s) => sum + countableVolume(s),
            0,
          ),
          hubs: ranking.picks.length,
        }
      : null;

  return (
    <div className="flex h-[100dvh] flex-col">
      <TopBar data={data} kpis={kpis} />
      <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative min-h-0 min-w-0 flex-1">
          {error ? (
            <div className="flex h-full items-center justify-center p-[var(--gutter)] text-center text-rojo">
              No se pudieron cargar los sellers: {error}
            </div>
          ) : (
            <>
              <MapView
                scores={ranking?.scores ?? null}
                target={view.target}
                radiusKm={view.radiusKm}
                pins={ranking?.picks.slice(0, 5) ?? []}
                exact={filtered?.kept.filter(isExact) ?? []}
                references={filtered?.references ?? []}
                focus={focus}
                activeRank={pick?.rank ?? hovered}
                initialView={{ center: view.center, zoom: view.zoom }}
                onHexClick={onHexClick}
                onPinHover={setHovered}
                onPinClick={(rank) => {
                  setSeller(null);
                  setSelection({ kind: "pick", rank });
                }}
                onMove={onMove}
              />
              <MapDock
                target={view.target}
                onTarget={(target) => setView((v) => ({ ...v, target }))}
                radiusKm={view.radiusKm}
                onRadius={(radiusKm) => setView((v) => ({ ...v, radiusKm }))}
                filters={view.filters}
                onFilters={(filters) => setView((v) => ({ ...v, filters }))}
                excluded={filtered?.excluded ?? { noData: 0, filtered: 0 }}
              />
            </>
          )}
        </div>
        <div className="flex flex-col bg-white md:w-[var(--panel-w)] md:min-w-[var(--panel-min)] md:max-w-[var(--panel-max)] md:border-l md:border-gris-200 max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:max-h-[var(--panel-sheet-max)] max-md:rounded-t-card max-md:border-t max-md:border-gris-200 max-md:shadow-pop">
          <div className="flex items-center justify-center py-2 md:hidden">
            <span className="sheet-grabber" aria-hidden="true" />
          </div>
          {seller && cluster ? (
            <SellerDetail seller={seller} onBack={() => setSeller(null)} />
          ) : cluster ? (
            <ClusterPanel
              cluster={cluster}
              radiusKm={view.radiusKm}
              target={view.target}
              claimedBy={ranking?.claimedBy ?? new Map()}
              excluded={filtered?.excluded ?? { noData: 0, filtered: 0 }}
              onBack={() => setSelection(null)}
              onSeller={setSeller}
            />
          ) : (
            <OpportunityList
              picks={ranking?.picks ?? null}
              radiusKm={view.radiusKm}
              hovered={hovered}
              onHover={setHovered}
              onOpen={(p) => setSelection({ kind: "pick", rank: p.rank })}
            />
          )}
        </div>
      </div>
    </div>
  );
}
```

Mobile peek: with no selection the sheet shows the list capped by `--panel-sheet-max`; add a token `--panel-sheet-peek: 34dvh` in `:root` and use `max-md:max-h-[var(--panel-sheet-peek)]` when nothing is selected, `--panel-sheet-max` otherwise. Keep `onMove` from firing `replaceState` on every frame: MapView only calls it on `moveend`.

**Step 3: Remove the old modules**

```bash
git rm src/lib/metrics.ts
git rm src/lib/layers.ts
```

Then `grep -rn "lib/metrics\|lib/layers\|kindColor" src tests` → Expected: no matches. If `tests/unit/*.test.ts` still import `layers`, move the `isApproximate` case to `isExact` in `opportunity.test.ts` and drop the `matchesAttrs` cases (replaced by `filters.test.ts`).

**Step 4: Full checks**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all three pass.

**Step 5: Commit** — `feat(map): wire the opportunity map and drop the old layer controls`.

---

### Task 13: Fixture, browser tests and a real look

**Files:**

- Modify: `tests/e2e/smoke.mjs`
- Modify: `tests/e2e/responsive.mjs`

**Step 1: Fresh fixture with volume** (needs `.env.local` with `SUPABASE_URL` and `SUPABASE_SECRET_KEY`; read-only):

```bash
npm run export:fixture
```

Expected: `data/fixtures/sellers.json` written (git-ignored), with `metrics.shipments_month` on most rows. If there is no `.env.local`, ask the user; do not invent a fixture.

**Step 2: Update smoke.mjs** — replace the old panel/filter steps (from "click a hex" to the metric switch) with:

```js
// 4. Ranked list renders and opens a cluster
await page.waitForSelector('[data-testid="opportunity-row"]', {
  timeout: 30000,
});
const rows = await page.locator('[data-testid="opportunity-row"]').count();
if (!rows) throw new Error("no opportunities ranked");
await page.locator('[data-testid="opportunity-row"]').first().click();
await page.waitForSelector('[data-testid="panel-cell"]');
await page.waitForSelector('[data-testid="needed"]');
await page.screenshot({ path: `${out}/cluster.png` });

// 5. A seller opens, and back returns to the cluster
await page.locator('[data-testid="door-list"] button').first().click();
await page.waitForSelector('[data-testid="panel-seller"]');
await page.getByText("← Volver al cluster").click();

// 6. Changing the radius re-ranks and lands in the URL
await page.getByText("← Oportunidades").click();
await page.click('[data-testid="radius-8"]');
await page.waitForFunction(() => location.search.includes("r=8"));
await page.reload();
await page.waitForSelector('[data-testid="radius-8"][aria-pressed="true"]');

// 7. Filters: clearing them adds sellers to the header count
const before = await page.textContent('[data-testid="stats"]');
await page.click('[data-testid="filters-button"]');
await page.getByText("Limpiar").click();
await page.waitForFunction(
  (b) => document.querySelector('[data-testid="stats"]')?.textContent !== b,
  before,
);
```

Keep the login steps, the `data-ready`/`data-hexes` waits and the console-error check as they are. Replace the legend step: `[data-testid="legend"]` must contain "% del objetivo".

**Step 3: Update responsive.mjs** — the panel is now always present; replace the "click a hex until panel-cell" loop with clicking the first `opportunity-row`, and keep the no-horizontal-scroll assertions at 390 / 834 / 1440.

**Step 4: Run**

```bash
npm run build   # with DATA_SOURCE=fixture APP_PASSWORD=demo-password in the env
npm start       # separate terminal
npm run test:e2e && npm run test:responsive
```

Expected: both scripts finish without throwing; screenshots in `data/out/shots`. Open `cluster.png` and check it against the wireframe in the design doc. Also run the app against production data (`npm run dev` with `.env.local`) and look at the AMBA view: the top 5 should be distinct areas, and La Matanza's locality-centre stacking should show its "≈" share in the footnote.

**Step 5: Commit** — `test(e2e): ranked list, cluster panel, radius in the URL and filters`.

---

### Task 14: README and PR

**Files:**

- Modify: `README.md` ("How it works → Map" paragraph, and the Responsive section)

**Step 1:** Replace the Map bullet with: the browser receives all active sellers once, filters them, and ranks hub candidates in a Web Worker (greedy coverage on res-8 hexes within a 3/5/8 km radius; each seller counts once); hexes are coloured by the share of the target (default 5,000 paq/mes) reachable from them, with fixed breaks; the view (target, radius, filters, position) is in the URL. Remove the "metric switching / adding a metric is one entry in metrics.ts" sentence.

**Step 2:** `npm run typecheck && npm run lint && npm test`, commit — `docs: README for the opportunity map`.

**Step 3:** Push the branch and open a PR into `develop` using `.github/pull_request_template.md`. PR body: what changed for the user (morning view, cluster panel, filters), screenshots from `data/out/shots`, and "Phase 1 of docs/plans/2026-11-02-hub-opportunity-map-design.md; no database changes". End with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Ask the user before pushing.

---

# Phase 2 — Data foundation (outline; write its detailed plan before starting)

Starts after phase 1 is merged and used for a few days. Each item becomes TDD tasks in its own plan. All schema changes are migration files `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`, verified on a Supabase preview branch, never run by hand.

1. **`seller_sources`** table + backfill from `first_batch_id` / `last_seen_batch_id`; the two loaders (`src/ingest/loaders/supabase.ts`, `sql.ts`) write it. Check: 309 sellers with two sources, 328 door-only.
2. **Typed columns** on `sellers`: `flex_candidate`, `reputation_rank`, `power_seller_rank`, `categories text[]`, `profile_url`, populated from `attrs` in the migration and by the pipeline; indexes on each.
3. **`size_bands`** table seeded with the phase-1 thresholds; `sellers.shipments_month` maintained by a trigger on `seller_metrics`; `src/lib/opportunity.ts` reads bands from the API instead of constants.
4. **Hex columns** `h3_r7`, `h3_r8` on `locations` (computed in the pipeline; backfilled by a one-off script that writes a migration, since Postgres has no h3 here), indexed.
5. **Views**: `v_map_sellers` (slim payload, replaces `map_sellers` in `src/lib/data.ts`), `v_export_sellers`.
6. **Export**: `GET /api/export?cells=...` returning .xlsx (the `xlsx` dependency is already installed), two sheets as in the design doc; phone column only for `admin` and `sales`; `export_log` table.
7. **`sales` role** in `app_users` and `src/lib/auth.ts`.

# Phase 3 — Sales loop (outline; write its detailed plan before starting)

1. `pipeline_statuses`, `seller_status_events` (append-only), `sellers.status` via trigger.
2. `hubs`, `hub_sellers` (snapshot on save), `v_hub_progress`.
3. API: `POST /api/sellers/:id/status`, `POST /api/hubs`, `GET /api/hubs`, `POST /api/hubs/:id/sellers` (add new sellers in radius).
4. UI: status chip menu on seller rows, "Guardar hub" in the cluster panel, "Mis hubs" under the ranked list, hub rings (grey / amber / green) and tags on the map, hub activity feed; header KPI switches to hubs in progress.
5. Spreadsheet round-trip at `/importar`: detect a returned export, preview changes, apply as events with `via = 'planilla'`.
6. Address confirmation from seller detail → street-precision `manual_override` location, reusing `src/lib/reviews.ts`.
