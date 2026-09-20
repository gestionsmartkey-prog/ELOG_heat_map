/**
 * Export what /api/sellers would serve into data/fixtures/sellers.json so the
 * app and the browser test can run with DATA_SOURCE=fixture, no database needed.
 * Needs SUPABASE_URL + SUPABASE_SECRET_KEY.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { getSellersResponse } from "../src/lib/data";

async function main() {
  delete process.env.DATA_SOURCE;
  const data = await getSellersResponse();
  mkdirSync("data/fixtures", { recursive: true });
  writeFileSync("data/fixtures/sellers.json", JSON.stringify(data));
  console.log(`wrote data/fixtures/sellers.json (${data.sellers.length} sellers, ${data.stats.located} located)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
