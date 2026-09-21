/**
 * Import page smoke test (fixture mode = dry run, nothing written).
 *   APP_USER=demo APP_PASSWORD=demo-password PW_CHROMIUM=/opt/pw-browsers/chromium node tests/e2e/import.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
const username = process.env.APP_USER ?? "demo";
const password = process.env.APP_PASSWORD ?? "demo-password";
const out = "data/out/shots";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

// Gate applies to the page and the API
await page.goto(base + "/importar");
if (!page.url().endsWith("/login")) throw new Error("expected redirect to /login, got " + page.url());
const anon = await page.request.post(base + "/api/import", { multipart: { file: { name: "x.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2\n") } } });
if (anon.status() !== 401) throw new Error("expected 401 for anonymous import, got " + anon.status());

await page.fill("#username", username);
await page.fill("#password", password);
await page.click("button[type=submit]");
await page.waitForURL(base + "/");

// Top bar links to the import page
await page.click('[data-testid="import-link"]');
await page.waitForURL(base + "/importar");
await page.waitForSelector('[data-testid="dropzone"]');
await page.screenshot({ path: `${out}/06-import-empty.png` });

// Wrong type is rejected with a readable message
await page.setInputFiles('[data-testid="file-input"]', { name: "foto.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71]) });
await page.click('[data-testid="import-button"]');
await page.waitForSelector('[data-testid="import-error"]');
console.log("error shown:", await page.textContent('[data-testid="import-error"]'));

// The sample file produces a report
await page.setInputFiles('[data-testid="file-input"]', "data/private/Sellers.xlsx");
await page.click('[data-testid="import-button"]');
await page.waitForSelector('[data-testid="import-report"]', { timeout: 30000 });
const report = await page.textContent('[data-testid="import-report"]');
console.log("report:", report?.replace(/\s+/g, " ").slice(0, 160));
if (!/140/.test(report ?? "")) throw new Error("report does not show 140 rows");
await page.screenshot({ path: `${out}/07-import-report.png` });

// Direct API call: same file through the route
const res = await page.request.post(base + "/api/import", { multipart: { file: { name: "Sellers.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: (await import("node:fs")).readFileSync("data/private/Sellers.xlsx") } } });
const body = await res.json();
console.log("api:", res.status(), body.status, body.report?.seller_count);
if (res.status() !== 200 || body.report?.seller_count !== 140) throw new Error("api import failed");

const real = errors.filter((e) => !/Failed to fetch|net::ERR|status of 422/i.test(e)); // 422 is the expected png rejection
if (real.length) { console.error("browser errors:", real); process.exit(1); }
console.log("OK");
await browser.close();
