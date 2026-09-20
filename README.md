# ELOG seller heat map

Internal map of Mercado Libre seller density across the Buenos Aires metro area (AMBA), built to decide where seller-collection hubs make sense. One password gate, one Supabase project, one Next.js app.

## How it works

```
client export (.xlsx/.csv) → ingest pipeline → Supabase → /api/sellers → browser (H3 hex aggregation)
```

- **Ingest** (`src/ingest`, no Next.js dependency): parse → map headers by alias → normalize → classify kind → split the free-text note (phone, hours, alternate address) → dedupe doors → geocode → upsert. Every source row is kept verbatim in `raw_rows`; every file is a row in `import_batches`; anything odd lands in `review_items` instead of failing the run.
- **Storage** (`supabase/migrations`): `locations` (one row per door), `sellers` (many per door), `seller_metrics` (metrics as rows, so volume later needs no schema change), `geocode_cache`, `review_items`, `seller_kinds` (kinds are data, not an enum).
- **Map**: the browser gets all active sellers once and does everything else with h3-js: hex aggregation at a zoom-dependent resolution (7 metro, 8 city, 9 street), quantile bins with labelled ranges, k-ring catchment on hover, kind filters, metric switching. Adding a metric is one entry in `src/lib/metrics.ts`.

## Run locally

```bash
cp .env.example .env.local   # fill in APP_PASSWORD, SESSION_SECRET, SUPABASE_URL, SUPABASE_SECRET_KEY
npm install
npm run dev                  # http://localhost:3000
```

Set `DATA_SOURCE=fixture` to serve `data/fixtures/sellers.json` instead of Supabase (used by the browser test).

## Ingest a file

```bash
# geocode with Argentina's free georef API (default: auto = georef, then Google if GEOCODING_API_KEY is set)
npm run ingest -- --file data/private/Sellers.xlsx --by "your name"

# no network on this machine? emit SQL instead and apply it with any SQL client, then geocode inside Postgres:
npm run ingest -- --file data/private/Sellers.xlsx --provider none --loader sql --out data/out
#   psql ... -f data/out/Sellers.sql
#   select * from public.georef_geocode_pending(50);   -- repeat until it returns nothing
```

Each run writes `<file>.review.csv` with the rows that need a human: geocode failures, notes whose address differs from the registered one, duplicate ids. Re-running a file is safe: sellers upsert on `external_id`, doors on their normalized address key, and a location a human has fixed (`manual_override`) is never overwritten.

A file with different column names needs an alias in `src/ingest/headers.ts`, nothing else. Unknown columns are kept in `sellers.extra`.

## Checks

```bash
npm run typecheck && npm run lint && npm test     # unit tests for the pipeline
DATA_SOURCE=fixture APP_PASSWORD=demo-password npm run build && npm start
npm run export:fixture                            # snapshot the database into data/fixtures/sellers.json (kept out of git)
PW_CHROMIUM=/path/to/chromium npm run test:e2e   # login gate, map, panel, metric switch; writes screenshots to data/out/shots
```

## Deploy

Vercel, root of this repo. Environment variables: `APP_PASSWORD`, `SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`. The Supabase secret key never reaches the browser; all reads go through the route handlers behind the session cookie.

## Data notes from the first sample

- 140 rows, 43 in CABA and 97 in Gran Buenos Aires. The densest clusters are Morón, Castelar, Ituzaingó and Villa Urquiza.
- 18 rows are Mercado Libre drop-off agencies (`542124431_…` ids) and 3 are partners (`ARP…` ids); they are shown as separate kinds and not counted as sellers by default.
- 16 rows share a door with another row, so the map can count doors, not only seller accounts.
- 8 rows carry a note naming a different address than the registered one; they are flagged for review, and the registered address wins.
