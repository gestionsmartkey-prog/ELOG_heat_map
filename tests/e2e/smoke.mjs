/**
 * Browser smoke test + screenshots. Run against a server started with
 * DATA_SOURCE=fixture APP_PASSWORD=demo-password:  node tests/e2e/smoke.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
const password = process.env.APP_PASSWORD ?? "demo-password";
const out = "data/out/shots";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? undefined, args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

// 1. Gate: unauthenticated visit redirects to /login
await page.goto(base + "/");
if (!page.url().endsWith("/login")) throw new Error("expected redirect to /login, got " + page.url());

// 2. Wrong password stays on login with an error
await page.fill("#password", "nope");
await page.click("button[type=submit]");
await page.waitForURL(/\/login\?error=1/);

// 3. Right password lands on the map
await page.fill("#password", password);
await page.click("button[type=submit]");
await page.waitForURL(base + "/");
await page.waitForSelector('[data-testid="map"][data-ready="1"]', { timeout: 30000 });
await page.waitForFunction(() => Number(document.querySelector('[data-testid="map"]')?.getAttribute("data-hexes")) > 0, null, { timeout: 30000 });
await page.waitForSelector('[data-testid="stats"]');
await page.waitForTimeout(1500); // let tiles/fallback settle
const hexCount = await page.getAttribute('[data-testid="map"]', "data-hexes");
const stats = await page.textContent('[data-testid="stats"]');
console.log("hexes:", hexCount, "| stats:", stats);
await page.screenshot({ path: `${out}/01-metro.png` });

// 4. Click the densest hex: pick its centre through the MapLibre canvas by simulating a click on the hex with the highest value
const clicked = await page.evaluate(() => {
  const map = document.querySelector('[data-testid="map"]');
  return !!map;
});
if (!clicked) throw new Error("map missing");
// click roughly at map centre first; then probe outward until the panel shows a cell
const box = await page.locator('[data-testid="map"] canvas').first().boundingBox();
let hit = false;
const probes = [];
for (let dy = -300; dy <= 300; dy += 40) for (let dx = -400; dx <= 400; dx += 40) probes.push([dx, dy]);
probes.sort((a, b) => (a[0] ** 2 + a[1] ** 2) - (b[0] ** 2 + b[1] ** 2));
for (const [dx, dy] of probes) {
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  if (await page.locator('[data-testid="panel-cell"]').count()) { hit = true; break; }
}
if (!hit) throw new Error("no hex could be selected");
await page.waitForTimeout(300);
const doors = await page.locator('[data-testid="door-list"] > li').count();
console.log("selected cell with doors:", doors);
await page.screenshot({ path: `${out}/02-selected.png` });

// 5. Open a seller
await page.locator('[data-testid="door-list"] button').first().click();
await page.waitForSelector('[data-testid="panel-seller"]');
await page.screenshot({ path: `${out}/03-seller.png` });

// 6. Toggle agencies on and switch metric — data-driven state must re-render without errors
await page.locator('[data-testid="kind-filters"] input').nth(1).check();
await page.selectOption('[data-testid="metric-select"]', "location_count");
await page.waitForTimeout(500);
const hexes2 = await page.getAttribute('[data-testid="map"]', "data-hexes");
console.log("hexes after metric switch:", hexes2);

// 7. Zoom to the Morón / Castelar cluster: res 8 at city zoom, then res 9 with individual doors
await page.evaluate(() => window.__elogMap.jumpTo({ center: [-58.62, -34.65], zoom: 12 }));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/04-city.png` });
await page.evaluate(() => window.__elogMap.jumpTo({ center: [-58.62, -34.65], zoom: 14 }));
await page.waitForTimeout(1200);
const resLabel = await page.textContent('[data-testid="legend"]');
console.log("legend at z14:", resLabel?.replace(/\s+/g, " ").slice(0, 60));
await page.screenshot({ path: `${out}/05-doors.png` });

// 8. Sign out returns to login
await page.click("text=Sign out");
await page.waitForURL(/\/login/);

const real = errors.filter((e) => !/basemaps\.cartocdn|Failed to fetch|net::ERR|AJAXError|style/i.test(e));
if (real.length) { console.error("browser errors:", real); process.exit(1); }
console.log("OK");
await browser.close();
