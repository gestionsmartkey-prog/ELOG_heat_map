/**
 * CLI: ingest one seller export.
 *
 *   npx tsx scripts/ingest.ts --file data/private/Sellers.xlsx [--provider auto|georef|google|none]
 *                             [--loader supabase|sql|json] [--out data/out] [--source meli] [--by name]
 *
 * supabase loader needs SUPABASE_URL + SUPABASE_SECRET_KEY. google provider needs GEOCODING_API_KEY.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { parseWorkbook, runPipeline, buildGeocoder, toSql, loadToSupabase } from "../src/ingest";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  const file = arg("file");
  if (!file) throw new Error("--file is required");
  const provider = (arg("provider", "auto") as "auto" | "georef" | "google" | "none");
  const loader = arg("loader", "supabase") as "supabase" | "sql" | "json";
  const outDir = arg("out", "data/out") as string;
  const source = arg("source", "meli") as string;
  const uploaded_by = arg("by") ?? null;

  const buf = readFileSync(file);
  const parsed = parseWorkbook(buf, basename(file));
  console.log(`parsed ${parsed.rows.length} rows from sheet "${parsed.sheet}"`);

  const geocoder = buildGeocoder({ provider, googleKey: process.env.GEOCODING_API_KEY });
  if (provider !== "none" && !geocoder) console.warn("no geocoder available; leaving coordinates pending");

  const result = await runPipeline(parsed.rows, {
    batch: { filename: parsed.filename, file_hash: parsed.file_hash, source, uploaded_by },
    geocoder,
    onProgress: (d, t) => { if (d % 10 === 0 || d === t) process.stdout.write(`  geocoded ${d}/${t}\r`); },
  });
  console.log("\nreport:", JSON.stringify(result.report, null, 2));

  mkdirSync(outDir, { recursive: true });
  const stem = basename(file).replace(/\.[^.]+$/, "");
  if (loader === "sql" || loader === "json") {
    if (loader === "sql") {
      const p = join(outDir, `${stem}.sql`);
      writeFileSync(p, toSql(result));
      console.log(`wrote ${p}`);
    }
    const p = join(outDir, `${stem}.json`);
    writeFileSync(p, JSON.stringify(result, null, 2));
    console.log(`wrote ${p}`);
  } else {
    const { batch_id } = await loadToSupabase(result);
    console.log(`loaded batch ${batch_id}`);
  }
  const reviewPath = join(outDir, `${stem}.review.csv`);
  const csv = ["reason,external_id,address_key,payload", ...result.reviews.map((r) => [r.reason, r.external_id ?? "", r.address_key ?? "", JSON.stringify(r.payload).replace(/"/g, '""')].map((v) => `"${v}"`).join(","))].join("\n");
  writeFileSync(reviewPath, csv);
  console.log(`wrote ${reviewPath} (${result.reviews.length} items)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
