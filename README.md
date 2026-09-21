# ELOG seller heat map

Internal map of Mercado Libre seller density across the Buenos Aires metro area (AMBA), built to decide where seller-collection hubs make sense. One password gate, one Supabase project, one Next.js app.

## How it works

```
client export (.xlsx/.csv) → ingest pipeline → Supabase → /api/sellers → browser (H3 hex aggregation)
```

- **Ingest** (`src/ingest`, no Next.js dependency): parse → map headers by alias → normalize → classify kind → split the free-text note (phone, hours, alternate address) → dedupe doors → geocode → upsert. Every source row is kept verbatim in `raw_rows`; every file is a row in `import_batches`; anything odd lands in `review_items` instead of failing the run.
- **Storage** (`supabase/migrations`): `locations` (one row per door), `sellers` (many per door), `seller_metrics` (metrics as rows, so volume later needs no schema change), `geocode_cache`, `review_items`, `seller_kinds` (kinds are data, not an enum).
- **Map**: the browser gets all active sellers once and does everything else with h3-js: hex aggregation at a zoom-dependent resolution (7 metro, 8 city, 9 street), quantile bins with labelled ranges, k-ring catchment on hover, kind filters, metric switching. Adding a metric is one entry in `src/lib/metrics.ts`.

## Importar desde el navegador

`/importar` (link "Importar" en la barra superior) sube un archivo por vez a `POST /api/import` (multipart, campo `file`, opcional `source`, `force=1` para recargar un archivo idéntico ya cargado). El servidor parsea, corre el pipeline sin red y carga a Supabase en una sola llamada; devuelve el reporte (`row_count`, `seller_count`, `location_count`, `review_count`, `by_kind`, avisos) y `409` con el lote existente cuando el hash del archivo ya está cargado. Límite 4 MB por archivo (límite de cuerpo de Vercel).

La geolocalización corre dentro de Postgres (`georef_geocode_pending`) en tandas: la página llama `POST /api/geocode` hasta que `done` es `true` (cada llamada procesa unos segundos y devuelve el conteo); `?retry=1` reintenta los fallidos y los "fuera de zona". `GET /api/geocode` devuelve el conteo por estado. Con `DATA_SOURCE=fixture` la importación es una vista previa y no escribe nada.

## Revisar domicilios (cola de revisión)

`/revisar` (link "Revisar" en la barra) lista los ítems abiertos de `review_items`: domicilios sin geolocalizar y direcciones en conflicto (registrada vs. nota). El revisor elige uno, arrastra el pin sobre la puerta real y guarda; eso fija el domicilio como `manual_override` (nunca lo pisa una importación posterior) y resuelve el ítem. Botones: **Guardar acá** (`POST /api/reviews/:id {action:"locate",lat,lng}`), **Reintentar automático** (`{action:"retry"}`, corre el geocoder georef sobre ese domicilio) y **Descartar** (`{action:"dismiss"}`, para "la registrada es correcta" o "dejar sin ubicar"). `GET /api/reviews` devuelve la cola. Todo detrás del gate de sesión.

## Usuarios (whitelist)

Los usuarios viven en la tabla `app_users` (email, contraseña con hash bcrypt de pgcrypto, rol viewer/admin). El login prueba primero los usuarios del entorno (`APP_USERS`/`APP_ADMINS` + `APP_PASSWORD`) y después la tabla, así que se puede habilitar gente sin redeploy.

- Bootstrap: definí al menos un admin en `APP_ADMINS` (mismo formato que `APP_USERS`).
- En el navegador: un admin abre `/usuarios` y da de alta email + contraseña (mínimo 8) con rol.
- Por API/automatización: `POST /api/users` con `{email,password,role}`. Se autoriza con una **sesión admin** (cookie) **o** un token firmado `Authorization: Bearer <token>`. El token es un JWT corto con `scope:"admin"` firmado con `SESSION_SECRET`; generalo con `npm run mint:admin -- 3600` (usa el `SESSION_SECRET` de producción). `GET /api/users` (admin) lista; `POST /api/users {email,active:false}` desactiva.

## Run locally

```bash
cp .env.example .env.local   # fill in APP_USERS, SESSION_SECRET, SUPABASE_URL, SUPABASE_SECRET_KEY
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

Vercel, root of this repo (`vercel.json` pins the framework, region and security headers). Environment variables: `APP_USERS` (or `APP_PASSWORD`), `SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`. `GET /api/health` is public and reports whether they are set and whether Supabase answers. The Supabase secret key never reaches the browser; all reads go through the route handlers behind the session cookie.

## Data notes from the first sample

- 140 rows, 43 in CABA and 97 in Gran Buenos Aires. The densest clusters are Morón, Castelar, Ituzaingó and Villa Urquiza.
- 18 rows are Mercado Libre drop-off agencies (`542124431_…` ids) and 3 are partners (`ARP…` ids); they are shown as separate kinds and not counted as sellers by default.
- 16 rows share a door with another row, so the map can count doors, not only seller accounts.
- 8 rows carry a note naming a different address than the registered one; they are flagged for review, and the registered address wins.
