/**
 * MapLibre 6 resolves its web worker from import.meta.url, which bundlers do
 * not provide. We serve the worker (and the chunk it imports) from /maplibre/
 * and point MapLibre at it via setWorkerUrl. Runs before dev and build.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("maplibre-gl/package.json")) + "/dist";
const out = join(process.cwd(), "public", "maplibre");
mkdirSync(out, { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) copyFileSync(join(dist, f), join(out, f));
console.log("maplibre worker copied to public/maplibre");
