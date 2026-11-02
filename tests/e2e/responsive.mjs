/**
 * Responsive checks: no horizontal overflow at mobile/tablet/desktop, map renders,
 * and the panel is a bottom sheet on mobile that peeks the ranked list. Screenshots to data/out/shots.
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
await page.waitForURL((u) => u.pathname === "/");
await page.waitForSelector('[data-testid="map"][data-ready="1"]', { timeout: 30000 });
await page.waitForSelector('[data-testid="opportunity-row"]', { timeout: 30000 });

const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

for (const { name, w, h } of widths) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(800);
  const ov = await overflow();
  console.log(`${name} (${w}px): horizontal overflow = ${ov}px`);
  if (ov > 1) throw new Error(`${name}: horizontal overflow ${ov}px`);
  await page.screenshot({ path: `${out}/resp-${name}.png` });
}

// Mobile bottom sheet: with nothing selected it peeks the ranked list; a row opens the cluster in the sheet.
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
const vh = 844;
const list = await page.locator('[data-testid="opportunity-list"]').boundingBox();
console.log(`mobile peek: top=${Math.round(list.y)} bottom=${Math.round(list.y + list.height)} viewport=${vh}`);
if (list.y + list.height < vh - 2) throw new Error("ranked list not anchored to bottom on mobile");
if (list.y < vh / 2) throw new Error("peeking list covers more than half the map on mobile");
await page.locator('[data-testid="opportunity-row"]').first().click();
await page.waitForSelector('[data-testid="panel-cell"]');
await page.waitForTimeout(300);
const panel = await page.locator('[data-testid="panel-cell"]').boundingBox();
console.log(`mobile sheet: bottom=${Math.round(panel.y + panel.height)} viewport=${vh}`);
if (panel.y + panel.height < vh - 2) throw new Error("panel not anchored to bottom on mobile");
const ov = await overflow();
if (ov > 1) throw new Error(`mobile sheet: horizontal overflow ${ov}px`);
await page.screenshot({ path: `${out}/resp-mobile-sheet.png` });

// Mobile dock folds behind "Ajustes".
await page.click('[data-testid="settings-button"]');
await page.waitForSelector('[data-testid="radius-5"]', { state: "visible" });
await page.screenshot({ path: `${out}/resp-mobile-ajustes.png` });

const real = errors.filter((e) => !/basemaps\.cartocdn|Failed to fetch|net::ERR|AJAXError|style/i.test(e));
if (real.length) { console.error("browser errors:", real); process.exit(1); }
console.log("OK");
await browser.close();
