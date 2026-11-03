# Hub Data Foundation (Phase 2) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give the opportunity map a real data model: where each seller came from, typed filter columns, size bands and volume as data, hex columns on doors, a slim map view, and an .xlsx export of a cluster's sellers (with a log and a `sales` role that can see phones).

**Architecture:** Six additive migrations in `supabase/migrations/`. Everything that can be derived is derived _in the database_ so the two loaders (`src/ingest/loaders/supabase.ts`, `sql.ts`) need no change and cannot drift: generated columns for typed attributes and hex parents, triggers for `seller_sources` and `sellers.shipments_month`. The app reads `v_map_sellers` and maps rows back to the existing `MapSeller` shape, so phase-1 components keep working. Bands come from `size_bands` through `/api/sellers` into `src/lib/opportunity.ts` (main thread and worker). Export is a pure workbook builder (`src/lib/export.ts`, unit tested) behind `POST /api/export`.

**Tech Stack:** Supabase Postgres (no h3 extension: hex parents are bit arithmetic in SQL), Next.js 16.3 route handlers, `xlsx` 0.18, vitest 5.

**Design:** `docs/plans/2026-11-02-hub-opportunity-map-design.md` §5 items 1–3, 7 (`v_map_sellers`, `v_export_sellers`), 8, 9 and §6 "Outbound". Phase-1 plan: `docs/plans/2026-11-02-hub-opportunity-map.md`.

---

## Ground rules

- **Branch:** `git switch -c feature/hub-data-foundation feature/hub-opportunity-map`. Phase 1 (PR #12) is not merged yet, so this branch stacks on it. Open the PR into `develop` once #12 is merged (rebase onto `develop` first); until then it can be a draft PR with base `feature/hub-opportunity-map`. Never commit to `main` or `develop`.
- **Never run DDL or data-changing SQL by hand.** Migrations are applied by the Supabase GitHub integration: a PR creates a preview branch (branching is on for project `qgbftqazblunhhnuuhom`), merge applies to production. Read-only `select`s against production or the preview branch are fine and are how each migration is verified.
- **Migrations are new files only.** Never edit `0001`–`20261029190000`. Names are `YYYYMMDDHHMMSS_name.sql`; the timestamps below are fixed so the order is fixed.
- **Checks before every commit:** `npm run typecheck && npm run lint && npm test`.
- **Commits:** message in a file, `git commit -F <file>`, ending with a `Business:` line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **UI copy:** Spanish (Argentina, voseo).

Production facts these tasks are checked against (read-only, 2026-11-03):

| Fact                                                        | Value                                                                                                          |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Sellers (all kinds)                                         | 9,545                                                                                                          |
| First batch `meli`, last batch `ml_publico` (merged)        | 309                                                                                                            |
| `kind = 'seller'` still only door-level (`source = 'meli'`) | 328                                                                                                            |
| `shipments_month` rows (one period, `2026-10-08`)           | 9,196, all whole numbers                                                                                       |
| `attrs.flex_candidate`                                      | si 7,007 · probable 851 · null 1,687                                                                           |
| `attrs.reputation`                                          | `1_red`…`5_green`, null 992                                                                                    |
| `attrs.power_seller`                                        | silver 704 · gold 959 · platinum 4,799 · null 3,083                                                            |
| `extra.categories`                                          | 9,156 rows, one category name each (names contain commas: "Arte, Librería y Mercería")                         |
| `extra.profile_url`                                         | 9,196 rows (the map currently reads `attrs.profile_url`, which is never set: the "Perfil ML" link never shows) |
| `app_users` role check                                      | `app_users_role_check`: `viewer`, `admin`                                                                      |

Deviation from the phase-2 outline, on purpose: hex columns are **generated columns** computed by a pure-SQL `h3_parent()` (verified against h3-js on production cells: `89a94106a6fffff` → `88a94106a7fffff` / `87a94106affffff`), not a script-written backfill. Typed attributes are generated columns too. Both stay correct when the review screen moves a door or a new file changes `attrs`.

---

### Task 1: Branch and `seller_sources`

**Files:**

- Create: `supabase/migrations/20261103120000_seller_sources.sql`

**Step 1: Branch**

```bash
git switch feature/hub-opportunity-map && git pull --ff-only
git switch -c feature/hub-data-foundation
```

**Step 2: Write the migration**

```sql
-- Provenance: every source a seller came from. One row per (seller, source); batch_id is the
-- latest file of that source. Written by a trigger on sellers, so both loaders record it for free.
-- sellers.source keeps meaning "latest source"; this table is the history the ML-id merge lost.

create table if not exists public.seller_sources (
  seller_id uuid not null references public.sellers(id) on delete cascade,
  source text not null,
  batch_id uuid references public.import_batches(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (seller_id, source)
);
create index if not exists seller_sources_source_idx on public.seller_sources(source);
alter table public.seller_sources enable row level security;

create or replace function public._record_seller_source() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.last_seen_batch_id is null then return null; end if;
  insert into public.seller_sources(seller_id, source, batch_id)
  select new.id, b.source, b.id from public.import_batches b where b.id = new.last_seen_batch_id
  on conflict (seller_id, source) do update
    set batch_id = excluded.batch_id, last_seen_at = now();
  return null;
end $$;
revoke all on function public._record_seller_source() from public, anon, authenticated;

drop trigger if exists sellers_record_source on public.sellers;
create trigger sellers_record_source
  after insert or update of last_seen_batch_id on public.sellers
  for each row execute function public._record_seller_source();

-- Backfill from what survived the merge: the first and the last batch of each seller.
insert into public.seller_sources(seller_id, source, batch_id, first_seen_at, last_seen_at)
select s.id, b.source,
       (array_agg(b.id order by b.created_at desc))[1],
       min(b.created_at), max(b.created_at)
from public.sellers s
join public.import_batches b on b.id in (s.first_batch_id, s.last_seen_batch_id)
group by s.id, b.source
on conflict (seller_id, source) do nothing;
```

Note the backfill groups by `(seller, source)` before inserting: a seller whose first and last batch share a source would otherwise hit the same conflict row twice in one statement and fail.

**Step 3: Checks and commit**

Run: `npm run typecheck && npm run lint && npm test` → all pass (no TS changed).

Commit `feat(db): record every source a seller came from`. Business: "We can tell again which sellers came from our own door-level files and which from the public profiles, so the 309 merged sellers no longer lose their origin."

---

### Task 2: Typed filter columns on `sellers`

**Files:**

- Create: `supabase/migrations/20261103120100_typed_seller_columns.sql`

**Step 1: Write the migration**

```sql
-- Typed, indexed filter columns derived from attrs/extra. Generated, so the pipeline keeps writing
-- attrs/extra as today and these can never disagree with them.

alter table public.sellers
  add column if not exists flex_candidate text
    generated always as (nullif(attrs->>'flex_candidate', '')) stored,
  add column if not exists reputation_rank smallint
    generated always as (case when attrs->>'reputation' ~ '^[1-5]_' then left(attrs->>'reputation', 1)::smallint end) stored,
  add column if not exists power_seller_rank smallint
    generated always as (case attrs->>'power_seller' when 'silver' then 1 when 'gold' then 2 when 'platinum' then 3 end) stored,
  -- One category per seller today; an array so a multi-category source fits later without a migration.
  add column if not exists categories text[]
    generated always as (case when nullif(extra->>'categories', '') is not null then array[extra->>'categories'] end) stored,
  add column if not exists profile_url text
    generated always as (nullif(extra->>'profile_url', '')) stored;

create index if not exists sellers_flex_candidate_idx on public.sellers(flex_candidate);
create index if not exists sellers_reputation_rank_idx on public.sellers(reputation_rank);
create index if not exists sellers_power_seller_rank_idx on public.sellers(power_seller_rank);
create index if not exists sellers_categories_idx on public.sellers using gin(categories);
```

**Step 2: Checks and commit**

Commit `feat(db): typed filter columns for Flex, reputation, power seller, category and profile`. Business: "Filters and the export read clean columns, and the Mercado Libre profile link becomes available for every public-profile seller."

---

### Task 3: `size_bands` and `sellers.shipments_month`

**Files:**

- Create: `supabase/migrations/20261103120200_size_bands_and_volume.sql`

**Step 1: Write the migration**

```sql
-- Size bands are data. A band starts at min_value (inclusive) and runs up to the next band's
-- min_value; max_value is that next start, kept for readability (null = no ceiling). Volumes are
-- whole packages, so enterprise starting at 5001 keeps 5,000 in core.
create table if not exists public.size_bands (
  band text primary key check (band in ('micro', 'chico', 'core', 'enterprise')),
  label text not null,
  min_value numeric not null unique,
  max_value numeric,
  counts_toward_target boolean not null,
  sort smallint not null unique
);
alter table public.size_bands enable row level security;
insert into public.size_bands(band, label, min_value, max_value, counts_toward_target, sort) values
  ('micro', 'Micro', 0, 100, true, 1),
  ('chico', 'Chico', 100, 1000, true, 2),
  ('core', 'Core', 1000, 5001, true, 3),
  ('enterprise', 'Enterprise', 5001, null, false, 4)
on conflict (band) do nothing;

-- Latest monthly volume on the seller row; seller_metrics keeps the dated history.
alter table public.sellers add column if not exists shipments_month numeric;
create index if not exists sellers_shipments_month_idx on public.sellers(shipments_month);

create or replace function public._refresh_shipments_month() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  sid uuid;
begin
  if tg_op = 'DELETE' then
    if old.metric <> 'shipments_month' then return null; end if;
    sid := old.seller_id;
  else
    if new.metric <> 'shipments_month' then return null; end if;
    sid := new.seller_id;
  end if;
  update public.sellers s
     set shipments_month = latest.value
    from (select (select m.value from public.seller_metrics m
                   where m.seller_id = sid and m.metric = 'shipments_month'
                   order by m.period desc nulls last, m.created_at desc limit 1) as value) latest
   where s.id = sid and s.shipments_month is distinct from latest.value;
  return null;
end $$;
revoke all on function public._refresh_shipments_month() from public, anon, authenticated;

drop trigger if exists seller_metrics_shipments_month on public.seller_metrics;
create trigger seller_metrics_shipments_month
  after insert or update or delete on public.seller_metrics
  for each row execute function public._refresh_shipments_month();

update public.sellers s
   set shipments_month = m.value
  from (select distinct on (seller_id) seller_id, value
          from public.seller_metrics where metric = 'shipments_month'
         order by seller_id, period desc nulls last, created_at desc) m
 where m.seller_id = s.id;
```

**Step 2: Checks and commit**

Commit `feat(db): size bands as data and the latest monthly volume on each seller`. Business: "Band thresholds can be changed without a code release, and each seller carries its current volume directly."

---

### Task 4: Hex columns on `locations`

**Files:**

- Create: `supabase/migrations/20261103120300_location_hex_columns.sql`
- Create: `tests/unit/h3Parent.test.ts`

**Step 1: Write the failing test** — it transcribes the SQL formula into TypeScript and checks it against h3-js, so the SQL is locked to the library the browser uses.

```ts
import { describe, expect, it } from "vitest";
import { cellToParent, gridDisk, latLngToCell } from "h3-js";

/**
 * Exactly the arithmetic of public.h3_parent() in
 * supabase/migrations/20261103120300_location_hex_columns.sql: set the resolution
 * nibble (bits 52–55) and fill every digit finer than `res` with 7.
 */
function sqlH3Parent(cell: string, res: number): string {
  let v = BigInt(`0x${cell}`);
  v =
    (v & ~(15n << 52n)) |
    (BigInt(res) << 52n) |
    ((1n << BigInt(45 - 3 * res)) - 1n);
  return v.toString(16);
}

describe("h3_parent (SQL formula)", () => {
  // Cells across CABA and GBA, plus their neighbours.
  const seeds = [
    [-34.6037, -58.3816],
    [-34.65, -58.62],
    [-34.77, -58.4],
    [-34.45, -58.91],
    [-34.92, -57.95],
  ].map(([lat, lng]) => latLngToCell(lat, lng, 9));
  const cells = seeds.flatMap((c) => gridDisk(c, 4));

  it("matches h3-js for res 8 and 7 from res-9 cells", () => {
    for (const c of cells) {
      expect(sqlH3Parent(c, 8)).toBe(cellToParent(c, 8));
      expect(sqlH3Parent(c, 7)).toBe(cellToParent(c, 7));
    }
  });

  it("matches cells read from production", () => {
    expect(sqlH3Parent("89a94106a6fffff", 8)).toBe("88a94106a7fffff");
    expect(sqlH3Parent("89a94106a6fffff", 7)).toBe("87a94106affffff");
  });
});
```

**Step 2: Run it** — `npx vitest run tests/unit/h3Parent.test.ts` → PASS (the formula is already right; this test guards the SQL from now on). If it fails, fix the formula in the test _and_ the migration together.

**Step 3: Write the migration**

```sql
-- Hex columns for the ranking and any future SQL catchment. Postgres here has no h3 extension;
-- the parent of an H3 cell is bit arithmetic on its 64-bit index: set the resolution nibble and
-- fill finer digits with 7. Locked to h3-js by tests/unit/h3Parent.test.ts.
create or replace function public.h3_parent(cell text, res integer) returns text
language sql immutable strict parallel safe as $$
  select to_hex(
    (('x' || lpad(cell, 16, '0'))::bit(64)::bigint & ~(15::bigint << 52))
    | (res::bigint << 52)
    | ((1::bigint << (45 - 3 * res)) - 1)
  )
$$;

alter table public.locations
  add column if not exists h3_r8 text generated always as (public.h3_parent(h3_r9, 8)) stored,
  add column if not exists h3_r7 text generated always as (public.h3_parent(h3_r9, 7)) stored;
create index if not exists locations_h3_r8_idx on public.locations(h3_r8);
create index if not exists locations_h3_r7_idx on public.locations(h3_r7);
```

`h3_parent` stays executable by `public`: it is a pure function and the generated columns need it whoever writes the row.

**Step 4: Checks and commit** — `feat(db): res-7 and res-8 hex columns on every door`. Business: "Each location knows its hub-grid cell, ready for counting catchments in the database when the data outgrows the browser."

---

### Task 5: `v_map_sellers` and `v_export_sellers`

**Files:**

- Create: `supabase/migrations/20261103120400_map_and_export_views.sql`

**Step 1: Write the migration**

```sql
-- Slim map payload: typed columns instead of attrs/extra and the per-row metrics subquery.
-- map_sellers stays for one release so a deploy that lands before this migration still works.
create or replace view public.v_map_sellers with (security_invoker = true) as
select s.id, s.external_id, s.kind, s.name, s.source, s.unit,
       s.opening_hours, s.note_address,
       l.address_display, l.locality, l.partido, l.province, l.postal_code,
       l.lat, l.lng, l.h3_r8, l.h3_r9,
       coalesce(l.precision, 'street') as precision,
       coalesce(l.address_edited, false) as address_edited,
       s.shipments_month, s.flex_candidate,
       s.attrs->>'reputation' as reputation,
       s.attrs->>'power_seller' as power_seller,
       s.profile_url
from public.sellers s
left join public.locations l on l.id = s.location_id
where s.active;

-- One flat row per seller for the sales export (and later the CRM). Holds the phone: only the
-- export route reads it, and it drops the column for roles that may not see it.
create or replace view public.v_export_sellers with (security_invoker = true) as
select s.id, s.external_id, s.name, s.profile_url, s.phone,
       case when coalesce(l.precision, 'street') = 'street' then l.address_display
            else coalesce(l.locality, l.partido, l.address_display) end as address,
       coalesce(l.precision, 'street') <> 'street' as approximate,
       l.locality, l.partido, l.province,
       s.shipments_month,
       (select b.band from public.size_bands b
         where s.shipments_month is not null and b.min_value <= s.shipments_month
         order by b.min_value desc limit 1) as band,
       s.flex_candidate,
       s.attrs->>'reputation' as reputation,
       s.attrs->>'power_seller' as power_seller,
       (select array_agg(x.source order by x.first_seen_at) from public.seller_sources x
         where x.seller_id = s.id) as sources
from public.sellers s
left join public.locations l on l.id = s.location_id
where s.active;
```

**Step 2: Checks and commit** — `feat(db): slim map view and a flat export view`. Business: "The map loads less data per seller, and sales exports read one consistent row per seller."

---

### Task 6: Bands as data in `opportunity.ts`

**Files:**

- Modify: `src/lib/opportunity.ts`
- Modify: `tests/unit/opportunity.test.ts`

**Step 1: Write the failing tests** (append to `tests/unit/opportunity.test.ts`; add `DEFAULT_BANDS, setBands` to the import and `afterEach` to the vitest import)

```ts
describe("bands from data", () => {
  afterEach(() => setBands(undefined));

  it("defaults to the phase-1 thresholds", () => {
    expect(DEFAULT_BANDS.map((b) => [b.band, b.min_value])).toEqual([
      ["micro", 0],
      ["chico", 100],
      ["core", 1000],
      ["enterprise", 5001],
    ]);
  });

  it("follows bands served by the API", () => {
    setBands([
      {
        band: "micro",
        label: "Micro",
        min_value: 0,
        counts_toward_target: true,
        sort: 1,
      },
      {
        band: "chico",
        label: "Chico",
        min_value: 50,
        counts_toward_target: true,
        sort: 2,
      },
      {
        band: "core",
        label: "Core",
        min_value: 500,
        counts_toward_target: true,
        sort: 3,
      },
      {
        band: "enterprise",
        label: "Enterprise",
        min_value: 3001,
        counts_toward_target: false,
        sort: 4,
      },
    ]);
    expect([49, 50, 499, 500, 3000, 3001].map(bandOf)).toEqual([
      "micro",
      "chico",
      "chico",
      "core",
      "core",
      "enterprise",
    ]);
    expect(countableVolume(mk("1", 3500))).toBe(0);
  });

  it("lets a band stop counting toward the target", () => {
    setBands(
      DEFAULT_BANDS.map((b) =>
        b.band === "micro" ? { ...b, counts_toward_target: false } : b,
      ),
    );
    expect(countableVolume(mk("1", 40))).toBe(0);
    expect(countableVolume(mk("2", 400))).toBe(400);
  });

  it("ignores unknown or empty band lists", () => {
    setBands([]);
    expect(bandOf(5000)).toBe("core");
    setBands([
      {
        band: "huge" as never,
        label: "?",
        min_value: 0,
        counts_toward_target: true,
        sort: 1,
      },
    ]);
    expect(bandOf(5000)).toBe("core");
  });
});
```

**Step 2: Run** `npx vitest run tests/unit/opportunity.test.ts` → FAIL (`setBands` / `DEFAULT_BANDS` not exported).

**Step 3: Implement** — in `src/lib/opportunity.ts` replace `bandOf` and `countableVolume`:

```ts
/** One row of public.size_bands. A band starts at min_value and runs to the next band's start. */
export type BandRule = {
  band: Band;
  label: string;
  min_value: number;
  counts_toward_target: boolean;
  sort: number;
};

export const DEFAULT_BANDS: BandRule[] = [
  {
    band: "micro",
    label: "Micro",
    min_value: 0,
    counts_toward_target: true,
    sort: 1,
  },
  {
    band: "chico",
    label: "Chico",
    min_value: 100,
    counts_toward_target: true,
    sort: 2,
  },
  {
    band: "core",
    label: "Core",
    min_value: 1000,
    counts_toward_target: true,
    sort: 3,
  },
  {
    band: "enterprise",
    label: "Enterprise",
    min_value: 5001,
    counts_toward_target: false,
    sort: 4,
  },
];

let bands: BandRule[] = DEFAULT_BANDS;

/**
 * Use the bands served by /api/sellers. Called on the main thread when data arrives and in the
 * ranking worker per request. Anything unusable falls back to the defaults.
 */
export function setBands(next: BandRule[] | undefined): void {
  const ok = (next ?? []).filter(
    (b) => b.band in BAND_LABELS && Number.isFinite(Number(b.min_value)),
  );
  bands = ok.length
    ? ok
        .map((b) => ({ ...b, min_value: Number(b.min_value) }))
        .sort((a, b) => a.min_value - b.min_value)
    : DEFAULT_BANDS;
}

export function bandOf(volume: number | null): Band | null {
  if (volume == null) return null;
  let out: Band = bands[0].band;
  for (const b of bands) if (volume >= b.min_value) out = b.band;
  return out;
}

const countsTowardTarget = (band: Band): boolean =>
  bands.find((b) => b.band === band)?.counts_toward_target ?? false;
```

and

```ts
export function countableVolume(s: MapSeller): number {
  if (isReference(s)) return 0;
  const v = volumeOf(s);
  const band = bandOf(v);
  if (v == null || band == null || !countsTowardTarget(band)) return 0;
  return v;
}
```

`min_value` arrives from PostgREST as a number for `numeric` only when small; `Number()` makes strings safe too.

**Step 4: Run** `npm test` → all pass (the existing band tests still hold with the defaults).

**Step 5: Commit** — `feat(map): size bands come from the database`. Business: "Changing where Chico ends or whether Micro counts is a data change, not a release."

---

### Task 7: Read `v_map_sellers`, serve bands, use `h3_r8`

**Files:**

- Create: `src/lib/mapRows.ts`
- Create: `tests/unit/mapRows.test.ts`
- Modify: `src/lib/types.ts`, `src/lib/data.ts`, `src/lib/ranking.ts`, `src/lib/ranking.worker.ts`, `src/components/useRanking.ts`, `src/components/HeatMapApp.tsx`, `src/components/SellerDetail.tsx`

**Step 1: Types** — in `src/lib/types.ts`, add to `MapSeller` after `h3_r9`:

```ts
  /** Hub-grid cell (res 8), precomputed by the database. Absent in older fixtures. */
  h3_r8?: string | null;
```

and to `SellersResponse`:

```ts
  /** Size bands from public.size_bands. Absent in older fixtures (defaults apply). */
  bands?: BandRule[];
```

with `import type { BandRule } from "./opportunity";` at the top (`opportunity.ts` already imports from `types.ts` with `import type`, so the cycle is type-only).

**Step 2: Write the failing test** `tests/unit/mapRows.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { toMapSeller, type MapRow } from "../../src/lib/mapRows";

const kinds = [
  { kind: "seller", label: "Seller", counts_as_seller: true, color: null },
  {
    kind: "dropoff_agency",
    label: "Centro de envío",
    counts_as_seller: false,
    color: null,
  },
];

const row = (over: Partial<MapRow> = {}): MapRow => ({
  id: "u1",
  external_id: "123",
  kind: "seller",
  name: "Tienda",
  source: "ml_publico",
  unit: null,
  opening_hours: null,
  note_address: null,
  address_display: "Morón",
  locality: "Morón",
  partido: "Morón",
  province: "Buenos Aires",
  postal_code: null,
  lat: -34.65,
  lng: -58.62,
  h3_r8: "88c2e310abfffff",
  h3_r9: "89c2e310aa7ffff",
  precision: "locality",
  address_edited: false,
  shipments_month: 1200,
  flex_candidate: "si",
  reputation: "5_green",
  power_seller: "gold",
  profile_url: "http://perfil.mercadolibre.com.ar/TIENDA",
  ...over,
});

describe("v_map_sellers rows", () => {
  it("keep the MapSeller shape the map and filters read", () => {
    const s = toMapSeller(row(), kinds);
    expect(s.metrics).toEqual({ shipments_month: 1200 });
    expect(s.attrs).toEqual({
      flex_candidate: "si",
      reputation: "5_green",
      power_seller: "gold",
      profile_url: "http://perfil.mercadolibre.com.ar/TIENDA",
    });
    expect(s.kind_label).toBe("Seller");
    expect(s.counts_as_seller).toBe(true);
    expect(s.h3_r8).toBe("88c2e310abfffff");
  });

  it("omits what the row does not have", () => {
    const s = toMapSeller(
      row({
        shipments_month: null,
        flex_candidate: null,
        reputation: null,
        power_seller: null,
        profile_url: null,
      }),
      kinds,
    );
    expect(s.metrics).toEqual({});
    expect(s.attrs).toEqual({});
  });

  it("reads numeric volume served as a string", () => {
    expect(
      toMapSeller(row({ shipments_month: "250" as unknown as number }), kinds)
        .metrics,
    ).toEqual({ shipments_month: 250 });
  });

  it("labels kinds from the lookup, falling back to the kind", () => {
    expect(
      toMapSeller(row({ kind: "dropoff_agency" }), kinds).counts_as_seller,
    ).toBe(false);
    expect(toMapSeller(row({ kind: "nuevo" }), kinds).kind_label).toBe("nuevo");
  });
});
```

**Step 3: Run** `npx vitest run tests/unit/mapRows.test.ts` → FAIL (module missing).

**Step 4: Implement** `src/lib/mapRows.ts`

```ts
import type { MapSeller, SellersResponse } from "./types";

/** One row of public.v_map_sellers. */
export type MapRow = {
  id: string;
  external_id: string;
  kind: string;
  name: string;
  source: string;
  unit: string | null;
  opening_hours: string | null;
  note_address: string | null;
  address_display: string | null;
  locality: string | null;
  partido: string | null;
  province: string | null;
  postal_code: string | null;
  lat: number | null;
  lng: number | null;
  h3_r8: string | null;
  h3_r9: string | null;
  precision: string;
  address_edited: boolean;
  shipments_month: number | null;
  flex_candidate: string | null;
  reputation: string | null;
  power_seller: string | null;
  profile_url: string | null;
};

/** The slim view keeps typed columns; the client still reads attrs/metrics, so rebuild them here. */
export function toMapSeller(
  r: MapRow,
  kinds: SellersResponse["kinds"],
): MapSeller {
  const kind = kinds.find((k) => k.kind === r.kind);
  const attrs: Record<string, string> = {};
  if (r.flex_candidate) attrs.flex_candidate = r.flex_candidate;
  if (r.reputation) attrs.reputation = r.reputation;
  if (r.power_seller) attrs.power_seller = r.power_seller;
  if (r.profile_url) attrs.profile_url = r.profile_url;
  const volume = r.shipments_month == null ? null : Number(r.shipments_month);
  return {
    id: r.id,
    external_id: r.external_id,
    kind: r.kind,
    kind_label: kind?.label ?? r.kind,
    counts_as_seller: kind?.counts_as_seller ?? true,
    name: r.name,
    source: r.source,
    opening_hours: r.opening_hours,
    note_address: r.note_address,
    location_id: null,
    address_display: r.address_display,
    locality: r.locality,
    partido: r.partido,
    province: r.province,
    postal_code: r.postal_code,
    lat: r.lat,
    lng: r.lng,
    h3_r8: r.h3_r8,
    h3_r9: r.h3_r9,
    geocode_status: null,
    unit: r.unit,
    address_edited: r.address_edited,
    precision: r.precision,
    attrs,
    metrics:
      volume == null || !Number.isFinite(volume)
        ? {}
        : { shipments_month: volume },
  };
}
```

`SellerDetail.tsx` already reads `s.attrs?.profile_url`, so the "Perfil ML" link starts showing with no component change. Grep first: `location_id` and `geocode_status` must have no reader in `src/components` or `src/lib/{ranking,filters,hexes}.ts` (checked 2026-11-03: none).

**Step 5: Run** the test → PASS.

**Step 6: `data.ts`** — in `getSellersResponse`:

- Read `kinds` first is not needed; keep `Promise.all` and map afterwards. Replace the `map_sellers` fetch with:

```ts
    fetchAllPages<MapRow>((from, to) => sb.from("v_map_sellers").select("*").order("name").order("id").range(from, to))
      .catch((e: Error) => { throw new Error(`v_map_sellers: ${e.message}`); }),
```

(the view already filters `active`).

- Add a fifth read: `sb.from("size_bands").select("band,label,min_value,counts_toward_target,sort").order("sort")`, throwing `size_bands: …` on error.
- Build sellers as `sellersRes.map((r) => withH3(toMapSeller(r, kindsRes.data ?? [])))` and return `bands: (bandsRes.data ?? []) as BandRule[]` in the response.
- In `loadFixture` set `raw.bands ??= DEFAULT_BANDS;`.

**Step 7: Ranking uses the stored cell** — `src/lib/ranking.ts`, in `bucketByCell`:

```ts
const cell = s.h3_r8 ?? cellToParent(s.h3_r9, HUB_RES);
```

**Step 8: Bands reach the worker**

- `src/lib/ranking.worker.ts`: add `bands?: BandRule[]` to `RankRequest`, destructure it, call `setBands(bands)` before `rankHubs`.
- `src/components/useRanking.ts`: add a fourth parameter `bands: BandRule[] | undefined`, include it in the `postMessage` payload and in the effect's dependency list; in the no-worker fallback call `setBands(bands)` before `rankHubs`.
- `src/components/HeatMapApp.tsx`: in the fetch `.then`, call `setBands((j as SellersResponse).bands)` _before_ `setData(...)` (filters run `bandOf` on the main thread as soon as data is set), and pass `data?.bands` to `useRanking`.

**Step 9: Checks** — `npm run typecheck && npm run lint && npm test` → pass. Then run the app against the fixture and look: `DATA_SOURCE=fixture npm run dev`, open http://localhost:3000, the ranked list and pins appear as before.

**Step 10: Commit** — `feat(map): read the slim map view and serve size bands`. Business: "The map reads the new typed data, ranks hubs on the stored grid cell, and shows each seller's Mercado Libre profile link."

---

### Task 8: `sales` role

**Files:**

- Create: `supabase/migrations/20261103120500_sales_role_and_export_log.sql`
- Modify: `src/lib/auth.ts`, `src/lib/users.ts`, `src/app/api/users/route.ts`, `src/components/UsersApp.tsx`
- Create: `tests/unit/auth.test.ts`

**Step 1: Migration**

```sql
-- sales: sees the map, exports with phone numbers and (phase 3) changes seller status.
alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check check (role in ('viewer', 'sales', 'admin'));

-- create_app_user: same as 0005, with sales accepted.
create or replace function public.create_app_user(p_email text, p_password text, p_role text default 'viewer', p_created_by text default null)
returns table(email text, role text, active boolean, created_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_email text := lower(trim(p_email));
  v_role text := coalesce(nullif(trim(p_role), ''), 'viewer');
begin
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'weak_password' using errcode = '22023';
  end if;
  if v_role not in ('viewer', 'sales', 'admin') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;

  insert into public.app_users(email, password_hash, role, created_by)
  values (v_email, extensions.crypt(p_password, extensions.gen_salt('bf')), v_role, p_created_by)
  on conflict (email) do update
    set password_hash = excluded.password_hash, role = excluded.role, active = true, updated_at = now();

  return query select u.email, u.role, u.active, u.created_at from public.app_users u where u.email = v_email;
end $$;
revoke all on function public.create_app_user(text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_app_user(text, text, text, text) to service_role;

-- Every export is logged: who, what, how many rows, whether phones went out.
create table if not exists public.export_log (
  id bigint generated always as identity primary key,
  actor text not null,
  role text not null,
  scope text not null check (scope in ('cluster', 'hub')),
  hub_id uuid,          -- references hubs(id) once phase 3 adds the table
  label text,
  row_count integer not null,
  with_phone boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists export_log_created_idx on public.export_log(created_at desc);
alter table public.export_log enable row level security;
```

**Step 2: Write the failing test** `tests/unit/auth.test.ts`

```ts
import { beforeAll, describe, expect, it } from "vitest";
import {
  canSeePhone,
  createSessionToken,
  toRole,
  verifySessionToken,
} from "../../src/lib/auth";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-0123456789";
});

describe("roles", () => {
  it("normalises anything unknown to viewer", () => {
    expect(["admin", "sales", "viewer", "root", undefined].map(toRole)).toEqual(
      ["admin", "sales", "viewer", "viewer", "viewer"],
    );
  });
  it("shows phones to admin and sales only", () => {
    expect(canSeePhone("admin")).toBe(true);
    expect(canSeePhone("sales")).toBe(true);
    expect(canSeePhone("viewer")).toBe(false);
  });
  it("keeps the sales role through a session token", async () => {
    const t = await createSessionToken({ user: "ana@elog.com", role: "sales" });
    expect(await verifySessionToken(t)).toEqual({
      user: "ana@elog.com",
      role: "sales",
    });
  });
});
```

**Step 3: Run** → FAIL (`toRole`, `canSeePhone` missing).

**Step 4: Implement** in `src/lib/auth.ts`:

```ts
export type Role = "viewer" | "sales" | "admin";

/** Anything that is not a known role is a viewer. */
export const toRole = (v: unknown): Role =>
  v === "admin" || v === "sales" ? v : "viewer";

/** Phones leave the app only for admin and sales, and only in a logged export. */
export const canSeePhone = (role: Role): boolean =>
  role === "admin" || role === "sales";
```

and in `verifySessionToken` replace the role line with `const role = toRole(payload.role);`.

- `src/lib/users.ts` `verifyDbUser`: `return { user: row.email, role: toRole(row.role) };` (import `toRole`).
- `src/app/api/users/route.ts`: `const role = toRole(body.role);` (drop the `Role` import if unused).
- `src/components/UsersApp.tsx`: add `<option value="sales">Ventas</option>` between Viewer and Admin, and render the role cell with `{ admin: "Admin", sales: "Ventas", viewer: "Viewer" }[u.role] ?? u.role`.

**Step 5: Run** `npm test` → pass.

**Step 6: Commit** — `feat(auth): sales role and the export log table`. Business: "Salespeople get their own role, which is the only one besides admin that will see seller phones in exports."

---

### Task 9: Export workbook builder

**Files:**

- Create: `src/lib/export.ts`
- Create: `tests/unit/export.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  buildExportWorkbook,
  exportFilename,
  exportRows,
  type ExportSeller,
} from "../../src/lib/export";

const seller = (over: Partial<ExportSeller> = {}): ExportSeller => ({
  id: "u1",
  external_id: "123",
  name: "Tienda",
  profile_url: "http://perfil.mercadolibre.com.ar/TIENDA",
  phone: "11 5555-0000",
  address: "Av. Rivadavia 1000",
  approximate: false,
  locality: "Morón",
  partido: "Morón",
  province: "Buenos Aires",
  shipments_month: 1200,
  band: "core",
  flex_candidate: "si",
  reputation: "5_green",
  power_seller: "gold",
  sources: ["meli", "ml_publico"],
  ...over,
});
const summary = {
  hub: "Morón",
  radiusKm: 5,
  target: 5000,
  needed: 4,
  reached: 5600,
  exportedAt: new Date("2026-11-03T12:00:00Z"),
  exportedBy: "ana@elog.com",
};

describe("export rows", () => {
  it("sort by volume, label bands and leave the sales columns empty", () => {
    const rows = exportRows(
      [
        seller({ id: "a", shipments_month: 300, band: "chico" }),
        seller({ id: "b" }),
      ],
      { withPhone: true },
    );
    expect(rows.map((r) => r.paq_mes)).toEqual([1200, 300]);
    expect(rows[0]).toMatchObject({
      ml_id: "123",
      nombre: "Tienda",
      tamano: "Core",
      flex: "si",
      reputacion: "verde",
      power_seller: "gold",
      ubicacion: "exacta",
      telefono: "11 5555-0000",
      estado: "Target",
      nuevo_estado: "",
      nota: "",
    });
  });

  it("drop the phone column entirely without permission", () => {
    const [r] = exportRows([seller()], { withPhone: false });
    expect("telefono" in r).toBe(false);
  });

  it("mark approximate locations and missing volume", () => {
    const [r] = exportRows(
      [
        seller({
          approximate: true,
          address: "Morón",
          shipments_month: null,
          band: null,
        }),
      ],
      { withPhone: false },
    );
    expect(r).toMatchObject({
      domicilio: "Morón",
      ubicacion: "aproximada (centro de la localidad)",
      paq_mes: "",
      tamano: "sin volumen",
    });
  });
});

describe("export workbook", () => {
  it("has the sellers sheet and a summary sheet", () => {
    const wb = XLSX.read(
      buildExportWorkbook([seller()], summary, { withPhone: false }),
    );
    expect(wb.SheetNames).toEqual(["Sellers", "Resumen"]);
    const resumen = XLSX.utils.sheet_to_json<{ campo: string; valor: unknown }>(
      wb.Sheets.Resumen,
    );
    expect(resumen.find((r) => r.campo === "Sellers necesarios")?.valor).toBe(
      4,
    );
    expect(XLSX.utils.sheet_to_json(wb.Sheets.Sellers)).toHaveLength(1);
  });

  it("names the file after the hub and the date", () => {
    expect(
      exportFilename(
        "Villa Luzuriaga · Morón",
        new Date("2026-11-03T12:00:00Z"),
      ),
    ).toBe("elog-hub-villa-luzuriaga-moron-2026-11-03.xlsx");
  });
});
```

**Step 2: Run** `npx vitest run tests/unit/export.test.ts` → FAIL (module missing).

**Step 3: Implement** `src/lib/export.ts`

```ts
import * as XLSX from "xlsx";
import { BAND_LABELS, type Band } from "./opportunity";

/** One row of public.v_export_sellers. */
export type ExportSeller = {
  id: string;
  external_id: string;
  name: string;
  profile_url: string | null;
  phone: string | null;
  address: string | null;
  approximate: boolean;
  locality: string | null;
  partido: string | null;
  province: string | null;
  shipments_month: number | null;
  band: Band | null;
  flex_candidate: string | null;
  reputation: string | null;
  power_seller: string | null;
  sources: string[] | null;
};

export type ExportSummary = {
  hub: string;
  radiusKm: number;
  target: number;
  needed: number;
  reached: number;
  exportedAt: Date;
  exportedBy: string;
};

const REPUTATION_ES: Record<string, string> = {
  "5_green": "verde",
  "4_light_green": "verde claro",
  "3_yellow": "amarillo",
  "2_orange": "naranja",
  "1_red": "rojo",
};

/**
 * Sheet 1 of the sales export (design doc §6). nuevo_estado and nota are left for the salesperson;
 * the file comes back through /importar in phase 3. Phone is a column only when allowed.
 */
export function exportRows(
  sellers: ExportSeller[],
  opts: { withPhone: boolean },
): Record<string, string | number>[] {
  return [...sellers]
    .sort(
      (a, b) =>
        (Number(b.shipments_month) || 0) - (Number(a.shipments_month) || 0),
    )
    .map((s) => ({
      ml_id: s.external_id,
      nombre: s.name,
      perfil: s.profile_url ?? "",
      domicilio: s.address ?? "",
      ubicacion: s.approximate
        ? "aproximada (centro de la localidad)"
        : "exacta",
      localidad: [s.locality, s.partido]
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(" · "),
      ...(opts.withPhone ? { telefono: s.phone ?? "" } : {}),
      paq_mes: s.shipments_month == null ? "" : Number(s.shipments_month),
      tamano: s.band ? BAND_LABELS[s.band] : "sin volumen",
      flex: s.flex_candidate ?? "",
      reputacion: s.reputation
        ? (REPUTATION_ES[s.reputation] ?? s.reputation)
        : "",
      power_seller: s.power_seller ?? "",
      estado: "Target",
      nuevo_estado: "",
      nota: "",
    }));
}

export function buildExportWorkbook(
  sellers: ExportSeller[],
  summary: ExportSummary,
  opts: { withPhone: boolean },
): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(exportRows(sellers, opts)),
    "Sellers",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { campo: "Hub", valor: summary.hub },
      { campo: "Radio (km)", valor: summary.radiusKm },
      { campo: "Objetivo (paq/mes)", valor: summary.target },
      { campo: "Sellers necesarios", valor: summary.needed },
      { campo: "Paq/mes con esos sellers (est.)", valor: summary.reached },
      { campo: "Sellers en el archivo", valor: sellers.length },
      {
        campo: "Exportado",
        valor: summary.exportedAt.toISOString().slice(0, 16).replace("T", " "),
      },
      { campo: "Por", valor: summary.exportedBy },
    ]),
    "Resumen",
  );
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function exportFilename(hub: string, date: Date): string {
  const slug = hub
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `elog-hub-${slug || "cluster"}-${date.toISOString().slice(0, 10)}.xlsx`;
}
```

**Step 4: Run** the test → PASS; `npm test` → all pass.

**Step 5: Commit** — `feat(export): sales workbook for a hub cluster`. Business: "A cluster's sellers become a spreadsheet the sales team can work through, with a summary of the hub they are building."

---

### Task 10: `POST /api/export`

**Files:**

- Modify: `src/lib/data.ts` (add `getExportSellers`, `logExport`)
- Create: `src/app/api/export/route.ts`

**Step 1: Data access** — append to `src/lib/data.ts`:

```ts
/** Sellers for an export, read in chunks so the `in (...)` filter stays under URL limits. */
export async function getExportSellers(ids: string[]): Promise<ExportSeller[]> {
  if (process.env.DATA_SOURCE === "fixture") {
    const want = new Set(ids);
    return loadFixture()
      .sellers.filter((s) => want.has(s.id))
      .map((s) => {
        const v = s.metrics?.shipments_month ?? null;
        const approximate = (s.precision ?? "street") !== "street";
        return {
          id: s.id,
          external_id: s.external_id,
          name: s.name,
          profile_url: s.attrs?.profile_url ?? null,
          phone: null,
          address: approximate
            ? (s.locality ?? s.partido ?? s.address_display)
            : s.address_display,
          approximate,
          locality: s.locality,
          partido: s.partido,
          province: s.province,
          shipments_month: v,
          band: bandOf(v),
          flex_candidate: s.attrs?.flex_candidate ?? null,
          reputation: s.attrs?.reputation ?? null,
          power_seller: s.attrs?.power_seller ?? null,
          sources: [s.source],
        };
      });
  }
  const sb = supabaseAdmin();
  const out: ExportSeller[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb
      .from("v_export_sellers")
      .select("*")
      .in("id", ids.slice(i, i + 200));
    if (error) throw new Error(`v_export_sellers: ${error.message}`);
    out.push(...((data ?? []) as ExportSeller[]));
  }
  return out;
}

export async function logExport(entry: {
  actor: string;
  role: string;
  scope: "cluster" | "hub";
  label: string;
  row_count: number;
  with_phone: boolean;
}): Promise<void> {
  if (process.env.DATA_SOURCE === "fixture") return;
  const { error } = await supabaseAdmin().from("export_log").insert(entry);
  if (error) throw new Error(`export_log: ${error.message}`);
}
```

(imports: `type ExportSeller` from `./export`, `bandOf` from `./opportunity`.)

**Step 2: Route** `src/app/api/export/route.ts`

```ts
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { canSeePhone } from "@/lib/auth";
import { getExportSellers, logExport } from "@/lib/data";
import { buildExportWorkbook, exportFilename } from "@/lib/export";

export const dynamic = "force-dynamic";

const MAX_IDS = 3000;

/** POST {hub, radiusKm, target, needed, reached, seller_ids}: the cluster's sellers as .xlsx. Logged. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    hub?: string;
    radiusKm?: number;
    target?: number;
    needed?: number;
    reached?: number;
    seller_ids?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "bad_request", message: "Se esperaba un cuerpo JSON." },
      { status: 400 },
    );
  }
  const ids = Array.isArray(body.seller_ids)
    ? [
        ...new Set(
          body.seller_ids.filter((x): x is string => typeof x === "string"),
        ),
      ]
    : [];
  if (!ids.length)
    return NextResponse.json(
      { error: "empty", message: "No hay sellers para exportar." },
      { status: 400 },
    );
  if (ids.length > MAX_IDS)
    return NextResponse.json(
      {
        error: "too_many",
        message: `Se pueden exportar hasta ${MAX_IDS} sellers.`,
      },
      { status: 413 },
    );

  const hub = String(body.hub ?? "cluster").slice(0, 120);
  const withPhone = canSeePhone(session.role);
  try {
    const sellers = await getExportSellers(ids);
    const now = new Date();
    const file = buildExportWorkbook(
      sellers,
      {
        hub,
        radiusKm: Number(body.radiusKm) || 0,
        target: Number(body.target) || 0,
        needed: Number(body.needed) || 0,
        reached: Number(body.reached) || 0,
        exportedAt: now,
        exportedBy: session.user,
      },
      { withPhone },
    );
    await logExport({
      actor: session.user,
      role: session.role,
      scope: "cluster",
      label: hub,
      row_count: sellers.length,
      with_phone: withPhone,
    });
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${exportFilename(hub, now)}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    console.error("POST /api/export failed", e);
    return NextResponse.json(
      { error: "export_failed", message: "No se pudo generar el archivo." },
      { status: 500 },
    );
  }
}
```

The log write happens before the file is returned: an export that cannot be logged is not served. `src/proxy.ts` already guards `/api/*`; the session check here is for the role.

**Step 3: Checks, then try it** — `npm run typecheck && npm run lint && npm test`. With `DATA_SOURCE=fixture npm run dev` and a logged-in cookie, `POST /api/export` with two fixture ids returns a file that opens in Excel with both sheets and no `telefono` column for a viewer.

**Step 4: Commit** — `feat(export): download a cluster as .xlsx, logged`. Business: "Exports are traceable: each one records who took how many sellers and whether phone numbers went out."

---

### Task 11: "Exportar" in the cluster panel

**Files:**

- Modify: `src/components/ClusterPanel.tsx`
- Modify: `tests/e2e/smoke.mjs`

**Step 1: Button** — next to "Copiar link", add an "Exportar" button (`btn btn-light t-meta`, `data-testid="export"`). On click:

```ts
const [exporting, setExporting] = useState(false);
const [exportError, setExportError] = useState<string | null>(null);
const exportCluster = async () => {
  setExporting(true);
  setExportError(null);
  try {
    const r = await fetch("/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hub: c.name,
        radiusKm,
        target,
        needed: c.needed.picks.length,
        reached: c.needed.reached,
        seller_ids: c.sellers.map((s) => s.id),
      }),
    });
    if (!r.ok)
      throw new Error(
        (await r.json().catch(() => null))?.message ?? `HTTP ${r.status}`,
      );
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download =
      /filename="([^"]+)"/.exec(
        r.headers.get("content-disposition") ?? "",
      )?.[1] ?? "elog-hub.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    setExportError(e instanceof Error ? e.message : "No se pudo exportar.");
  } finally {
    setExporting(false);
  }
};
```

Label while busy: "Exportando…" (button `disabled`). Show `exportError` as `t-micro` text under the buttons. Wrap the two buttons in a `flex gap-2`. Add `useState` to the React import (the component currently imports nothing from React; add `import { useState } from "react";` and, if the file has no `"use client"`, check its parent — `HeatMapApp.tsx` is a client component, so the panel is already client-rendered).

**Step 2: E2E** — in `tests/e2e/smoke.mjs`, after the first `waitForSelector('[data-testid="panel-cell"]')`:

```js
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.click('[data-testid="export"]'),
]);
if (!/^elog-hub-.+\.xlsx$/.test(download.suggestedFilename()))
  throw new Error(`unexpected export name ${download.suggestedFilename()}`);
```

(Match the file's existing assertion style; open it first.)

**Step 3: Checks** — `npm run typecheck && npm run lint && npm test`, then with the fixture dev server running `npm run test:e2e` and `npm run test:responsive` → pass. Look at the panel at 390 px: the two buttons fit on one row.

**Step 4: Commit** — `feat(map): export a hub cluster from its panel`. Business: "From any hub spot, one click gives the sales team the list of sellers to call."

---

### Task 12: Verify on the Supabase preview branch

No code. Push the branch (ask the user first) and open the draft PR; the Supabase integration creates a preview branch and applies the six migrations. Then, **read-only** against the preview branch (`mcp__supabase__list_branches` gives its project ref; preview branches start without data, so seed checks that need data run against production _after_ merge instead — see Step 3):

**Step 1:** Migrations applied cleanly: the integration's check on the PR is green and `list_migrations` on the branch shows `20261103120000`–`20261103120500`.

**Step 2:** Objects exist: `select count(*) from size_bands` → 4; `select h3_parent('89a94106a6fffff', 8)` → `88a94106a7fffff`; `select * from v_map_sellers limit 1` and `v_export_sellers limit 1` run.

**Step 3: After merge to production** (read-only), expect:

```sql
select count(*) filter (where n = 2) as merged,           -- 309
       count(*) filter (where n = 1 and only_meli) as door_only_rows  -- 349 (328 kind=seller + 21 agencies/partners)
from (select seller_id, count(*) n, bool_and(source = 'meli') only_meli from seller_sources group by 1) x;

select count(*) from sellers where shipments_month is not null;   -- 9196
select count(*) from sellers where profile_url is not null;       -- 9196
select flex_candidate, count(*) from sellers group by 1;          -- si 7007, probable 851, null 1687
select count(*) from locations where h3_r9 is not null and h3_r8 is null;  -- 0
```

Then load the map in production: same ranked list as before the release (bands and volumes unchanged), the "Perfil ML" link shows in seller detail, and an export from a viewer account has no phone column; `select * from export_log order by created_at desc limit 1` shows it.

**Deploy note for the PR:** the code reads `v_map_sellers` and `size_bands`, which exist only after the migrations run. Merge order on release: migrations apply on merge to `main` together with the Vercel deploy; if the deploy wins the race, `/api/sellers` returns 500 for the minute until migrations finish. Acceptable for an internal tool; say so in the PR.

---

### Task 13: README and PR

**Files:**

- Modify: `README.md`

**Step 1:** In "How it works", add: sources per seller (`seller_sources`), typed filter columns and `shipments_month` derived in the database, bands in `size_bands`, hex columns via `h3_parent()`, the map reading `v_map_sellers`, the export (`POST /api/export`, logged in `export_log`, phone only for `admin`/`sales`). In the users section, add the `sales` role.

**Step 2:** `npm run typecheck && npm run lint && npm test && npm run build`, commit `docs: README for the data foundation`.

**Step 3:** Once #12 is merged: `git rebase origin/develop`, push (ask first), open the PR into `develop` with `.github/pull_request_template.md`. Body: what changed for the user (profile links, Exportar, Ventas role), the six migrations and what each derives, the verification numbers from Task 12, the deploy note, "Phase 2 of docs/plans/2026-11-02-hub-opportunity-map-design.md". End with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
