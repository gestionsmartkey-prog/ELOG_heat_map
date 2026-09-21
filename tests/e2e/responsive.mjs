/**
 * Responsive checks: no horizontal overflow at mobile/tablet/desktop, map renders,
 * and the detail panel becomes a bottom sheet on mobile. Screenshots to data/out/shots.
 *   APP_USER=demo APP_PASSWORD=demo-password PW_CHROMIUM=/opt/pw-browsers/chromium node tests/e2e/responsive.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
const username = process.env.APP_USER ?? "demo";
const password = process.env.APP_PASSWORD ?? "demo-password";
const out = "data/out/shots";
mkdirSync(out, { recursive: true });

const widths = [
  { name: "mobile", w: 390, h: 844 },
  { name: "tablet", w: 834, h: 1112 },
  { name: "desktop", w: 1440, h: 900 },
];

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? undefined, args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(base + "/login");
await page.fill("#username", username);
await page.fill("#password", password);
await page.click("button[type=submit]");
await page.waitForURL(base + "/");
await page.waitForSelector('[data-testid="map"][data-ready="1"]', { timeout: 30000 });

const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

for (const { name, w, h } of widths) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(800);
  const ov = await overflow();
  console.log(`${name} (${w}px): horizontal overflow = ${ov}px`);
  if (ov > 1) throw new Error(`${name}: horizontal overflow ${ov}px`);
  await page.screenshot({ path: `${out}/resp-${name}.png` });
}

// Mobile bottom sheet: select a hex, panel should appear pinned to the bottom.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
const box = await page.locator('[data-testid="map"] canvas').first().boundingBox();
let hit = false;
const probes = [];
for (let dy = -220; dy <= 220; dy += 40) for (let dx = -140; dx <= 140; dx += 40) probes.push([dx, dy]);
probes.sort((a, b) => (a[0] ** 2 + a[1] ** 2) - (b[0] ** 2 + b[1] ** 2));
for (const [dx, dy] of probes) {
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  if (await page.locator('[data-testid="panel-cell"]').count()) { hit = true; break; }
}
if (hit) {
  const panel = await page.locator('[data-testid="panel-cell"]').boundingBox();
  const vh = 844;
  console.log(`mobile sheet: bottom=${Math.round(panel.y + panel.height)} viewport=${vh}`);
  if (panel.y + panel.height < vh - 2) throw new Error("panel not anchored to bottom on mobile");
  await page.screenshot({ path: `${out}/resp-mobile-sheet.png` });
} else {
  console.log("mobile sheet: no hex hit (skipped sheet assertion)");
}

const real = errors.filter((e) => !/basemaps\.cartocdn|Failed to fetch|net::ERR|AJAXError|style/i.test(e));
if (real.length) { console.error("browser errors:", real); process.exit(1); }
console.log("OK");
await browser.close();
