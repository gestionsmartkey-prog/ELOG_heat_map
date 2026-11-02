# Hub opportunity map — design

Date: 2026-11-02 · Status: approved in brainstorm, pending implementation plan

## Goal

Turn the seller heat map into ELOG's "sniper tool" for Flex hubs. Opening the map in the morning, a user can tell within five seconds which cluster to tackle this week, click it, and see how many packages a hub there would collect, which sellers to win to reach the target, and how sales is progressing. The cluster's seller list can be exported for the sales team, and their results come back into the map.

## Decisions

| Topic                  | Decision                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data layers            | Both files are prospects (none are ELOG clients). Door-level files (`meli`) have exact addresses; the public-profile file (`ml_publico`) has volume and attributes but only a locality centre. |
| Hub target             | 5,000 packages/month by default, editable in the map.                                                                                                                                          |
| Size bands (pkg/month) | Micro <100 · Chico 100–999 · Core 1,000–5,000 · Enterprise >5,000. Enterprise never counts toward a target and is left out of cluster views (only counted in the footnote).                    |
| Missing volume         | Door-level sellers get volume and attributes from the public profile with the same ML seller id. Unmatched ones show "sin volumen".                                                            |
| Catchment              | Pickup radius 3 / 5 / 8 km, default 5.                                                                                                                                                         |
| First view             | Ranked list of hub opportunities plus the map.                                                                                                                                                 |
| Default filters        | "Prospecto Flex" preset: Chico + Core, Flex sí + probable. "Limpiar" shows everyone.                                                                                                           |
| Sales loop             | Both in-app status changes and an Excel round-trip.                                                                                                                                            |
| Phone in export        | Yes, for admin and sales roles only; every export is logged.                                                                                                                                   |
| Deferred               | "Stalled hub" colour (no activity for N days): not now; closing speed is not ours to set.                                                                                                      |

## What the data says (production, read-only, 2026-11-02)

- 9,196 public profiles, all with volume. 8,706 at locality precision, 75 partido, 65 ciudad, 41 unlocated.
- 658 door-level rows over two files (`Sellers.xlsx`, `Sellers 2.xlsx`): 637 sellers, 18 drop-off agencies, 3 partners.
- **The ML id match already happens**: `external_id` is unique, so 309 of the 637 door-level sellers (49%) merged with their public profile and kept their exact door. 328 have no volume. Side effect: the merge overwrote `source` with `ml_publico`, so provenance is lost; the data model fixes that.
- Volume by band: micro 3,258 sellers / 87k pkg · chico 3,602 / 1.46M · core 1,858 / 4.16M · enterprise 478 / 6.20M. Enterprise is 52% of all volume, so excluding it changes the map a lot — as intended.
- CABA + Buenos Aires province hold about 8,100 of the sellers.
- **Phones are nearly absent**: 2 of 637 door-level sellers have one; public profiles have none. The export carries the column, but the ML profile link is the practical contact path.
- **Locality stacking**: approximate sellers sit on the locality centre (Balvanera 272, La Matanza 253, Palermo 235 on single points). A 5 km radius absorbs this for CABA barrios but not for large partidos like La Matanza. The panel shows the approximate share, and the sales loop lets a salesperson confirm a real door (see below).

## 1. Layout

- **Header**: one slim row. Logo, page name "Oportunidades", three headline numbers for the current filters (sellers in scope, packages/month, hubs in progress), and one menu (Revisar with open-count badge, Importar, Usuarios, Salir; viewer name and last file inside).
- **Map dock** (top-left, floating): Objetivo (editable, default 5.000), Radio segmented 3 / 5 / 8 km, Filtros button with active count.
- **Legend**: one, bottom-left, on the opportunity scale.
- **Panel**: opens on the ranked list ("Top oportunidades") with "Mis hubs" below; a row or a hex click opens cluster detail with "← Oportunidades".
- **Mobile**: panel is a bottom sheet that always peeks the top 3; the dock collapses into "Ajustes".
- **Accessibility**: 40 px touch targets, visible focus, colour always paired with a number or label, text contrast ≥ 4.5:1.

Removed: the second header row, the stats text strip, Métrica, Zona, Fuente, Mostrar and the attribute pill rows, the blue approximate layer and its legend, the empty-panel state.

## 2. Colour

- **Opportunity scale** (hex fill): % of the hub target reachable within the radius from that hex. Single warm ramp in brand colours with **fixed breaks**: <25% `#FAF0E6`, 25–50% `#FFC48F`, 50–75% `#FF9038`, 75–100% `#C13E06`, ≥100% `#6E2303` plus a dark outline. Empty hexes are not drawn.
- **One layer**: door-level and approximate sellers feed the same scale. At street zoom, exact-door sellers show as dots.
- **Hub progress** (outline of the saved hub's radius + map tag "Morón 2/5"): grey dashed = saved, no wins; amber = in progress, with what is missing; green = won volume covers the target.
- **Seller status chips** (always text): Target grey, Contactado blue, Negociando amber, Ganado green, Perdido muted red.
- Size bands are text tags, not colours.

## 3. Filters

Popover from the dock, one row per filter: Tamaño (Micro / Chico / Core), Candidato Flex (Todos / Sí / Sí + probable), Reputación mínima (single threshold), Power seller (Cualquiera / Silver+ / Gold+ / Platinum), Estado de venta (e.g. only open), Ubicación (Todas / Solo domicilio exacto), Referencias switch (drop-off agencies and partners as dots, never counted).

- Every filter applies to every seller. A seller without the attribute an active filter needs is excluded, and the panel says how many.
- Active filters show as removable chips under the dock, with "Limpiar".
- The whole view (filters, target, radius, map position) lives in the URL so it can be shared.

## 4. Ranked list and cluster panel

**Ranking (greedy coverage).**

1. Every res-8 hex (about 0.9 km across) within the radius of any countable seller is a candidate hub centre — empty hexes included, since the best spot is often between two clusters.
2. Score each candidate: countable volume (passes filters, not enterprise, not lost, not yet claimed) within the radius. The radius is a hex disk: 3 km ≈ k3, 5 km ≈ k5 (91 cells), 8 km ≈ k9.
3. Pick the highest score. Ties go to the candidate with more exact-door volume.
4. **Claim** the sellers inside the pick's radius; they are removed from every other candidate, so each package counts once. A claimed seller shows "en hub #N" in other clusters.
5. Re-score the candidates near the pick and repeat, until 10 picks or the best remaining score is below 25% of the target.

Name each pick after the locality with the most volume in it. "Más volumen" (default) keeps pick order; "Menos sellers" re-sorts the same picks by wins needed — it never picks different spots.

The ranking runs in the browser, in a Web Worker, and re-runs on every change of target, radius or filters (tens of milliseconds at today's size). It moves to SQL only if data grows past ~100k sellers or something other than the map needs it.

**On the map.** The top 5 picks show as numbered pins (1–5) at their centres, matching the list; no circles by default so the heat stays readable. Hovering a pin or a list row draws its circle dashed; clicking makes it solid, keeps it, and opens the cluster. Saved hubs always show their progress ring.

Row: `1 Morón · 112% · 5.600 paq/mes · necesitás 4 (2 core + 2 chicos)`. "Necesitás N" is greedy: largest sellers first until the target is met.

**Cluster detail.**

1. Name, radius, top localities; actions Guardar hub, Exportar, Copiar link.
2. Packages/month reachable, % of target, progress bar (won vs open for a saved hub).
3. "Ganando estos N llegás a X": the greedy minimum set. Size mix bar for micro / chico / core.
4. All sellers by volume: name, size tag, packages, Flex, reputation, status chip, "≈" if approximate. A seller opens its detail (volume, ML profile link, address, status, history).
5. Footnote: % approximate location, how many without volume, how many excluded by filters, enterprise count.

## 5. Data model

All changes ship as migration files in `supabase/migrations/`.

1. **One seller, many sources.** `sellers` stays one row per ML seller id. New `seller_sources (seller_id, source, batch_id, first_seen_at, last_seen_at)` records every file a seller came from; the pipeline writes it on each load and a migration backfills it from `first_batch_id` / `last_seen_batch_id`. The more precise location keeps winning (`_pick_location`).
2. **Typed filter columns** on `sellers`: `flex_candidate`, `reputation_rank` (1–5), `power_seller_rank` (1–3), `categories text[]`, `profile_url`; indexed. Remaining attributes stay in `attrs`.
3. **Volume and band.** `seller_metrics` keeps dated history. `sellers.shipments_month` holds the latest value (trigger on `seller_metrics`). `size_bands (band, min_value, max_value, counts_toward_target, sort)` holds the thresholds as data.
4. **Pipeline.** `pipeline_statuses` lookup; `seller_status_events (seller_id, status, hub_id, actor, via, note, created_at)` append-only; `sellers.status` current value maintained by trigger.
5. **Hubs.** `hubs (id, name, center_h3_r8, lat, lng, radius_km, target_monthly, created_by, created_at, archived_at)` and `hub_sellers (hub_id, seller_id, added_at)`. Membership is snapshotted when the hub is saved; sellers that later appear inside its radius surface as "N nuevos en el radio → agregar".
6. **Location precision upgrade.** A salesperson who confirms a seller's real address sets it from the seller detail; it becomes a street-precision `manual_override` location, using the existing review-screen mechanism.
7. **Views.**
   - `v_map_sellers`: slim map payload (~12 fields) with `h3_r7`, `h3_r8`, `h3_r9` as indexed columns on `locations`.
   - `v_hub_progress`: per hub — target, won volume, open volume, won count, missing volume.
   - `v_export_sellers`: one flat row per seller for the sales export and, later, the CRM.
8. **Export log.** `export_log (actor, scope, hub_id, row_count, created_at)`.
9. **Roles.** `app_users.role` adds `sales` (map, export, status changes). Admin keeps import, review and users.

Room for later, no tables now: an ELOG `clients` table joined on ML seller id, so hub progress becomes won volume plus volume already collected (`v_hub_progress` is shaped for it); CRM sync from `v_export_sellers` and `seller_status_events`; routing from hub and seller locations.

Catchment and ranking stay in the browser (about 9k sellers × 91 hexes at 5 km is instant). The precomputed hex columns keep a move to SQL straightforward.

## 6. Sales loop

- **Outbound.** "Exportar" on a cluster or hub downloads an .xlsx: sheet 1 sellers (ML id, name, profile link, address or locality, phone for admin/sales, packages, band, Flex, reputation, status, empty `nuevo_estado` and `nota`); sheet 2 summary (hub, radius, target, sellers needed, export date). Logged in `export_log`.
- **Inbound, in the app.** The status chip on a seller row opens Target → Contactado → Negociando → Ganado / Perdido with an optional note; saved as an event, the hub recolours immediately.
- **Inbound, by spreadsheet.** Uploading a returned export at `/importar` is recognised as a status update, previewed ("14 cambios: 3 ganados, 1 perdido…"), and applied on confirm as events with `via = 'planilla'`. Unknown ids and invalid statuses are flagged, not applied.
- **Hub progress.** Won volume / target drives the ring colour and the tag "2/5 · faltan 2.300 paq"; hub detail shows an activity feed.

## Phases

1. **Lean map** — layout, colour scale, dock, filters popover, ranked list, cluster panel, URL state. Uses the existing schema (volume already in `map_sellers.metrics`, attributes in `attrs`); size bands and the target live in client code for this phase.
2. **Data foundation** — migrations for `seller_sources`, typed columns, `size_bands`, `shipments_month`, hex columns, the three views; map reads `v_map_sellers`; .xlsx export with log; `sales` role.
3. **Sales loop** — pipeline tables, hubs and `hub_sellers`, in-app status, spreadsheet round-trip, hub rings and progress, address confirmation from seller detail.

## Testing

- Unit (vitest): band assignment, catchment sum, ranking with claiming (no seller counted twice, stop rule, tie-break), greedy "sellers needed", filter matching (including missing attributes), export row shape, round-trip parsing.
- Migrations: applied on a Supabase preview branch; backfill counts checked against the numbers above (309 merged, 328 without volume).
- E2E (existing scripts against `DATA_SOURCE=fixture`): ranked list renders, row opens cluster, filters change the ranking, URL restores the view, responsive at 390 / 834 / 1440 px.

## Open risks

- Locality stacking inflates hexes at large partido centres; mitigated by the approximate-share note and the address confirmation, not solved.
- Estimated shipments are ML public estimates, not invoiced volume; the panel labels them "est.".
- 328 door-level sellers have no volume until a public profile or another source covers them.
