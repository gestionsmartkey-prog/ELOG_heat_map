/**
 * Browser smoke test + screenshots. Run against a server started with
 * DATA_SOURCE=fixture APP_PASSWORD=demo-password:  node tests/e2e/smoke.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
const username = process.env.APP_USER ?? "demo";
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
await page.fill("#username", username);
await page.fill("#password", "nope");
await page.click("button[type=submit]");
await page.waitForURL(/\/login\?error=1/);

// 3. Right password lands on the map
await page.fill("#username", username);
await page.fill("#password", password);
await page.click("button[type=submit]");
await page.waitForURL((u) => u.pathname === "/");
await page.waitForSelector('[data-testid="map"][data-ready="1"]', { timeout: 30000 });
await page.waitForFunction(() => Number(document.querySelector('[data-testid="map"]')?.getAttribute("data-hexes")) > 0, null, { timeout: 30000 });
await page.waitForSelector('[data-testid="stats"]');
await page.waitForTimeout(1500); // let tiles/fallback settle
const hexCount = await page.getAttribute('[data-testid="map"]', "data-hexes");
const stats = await page.textContent('[data-testid="stats"]');
console.log("hexes:", hexCount, "| stats:", stats);
const legend = await page.textContent('[data-testid="legend"]');
if (!legend?.includes("% del objetivo")) throw new Error("legend is not on the opportunity scale: " + legend);
await page.screenshot({ path: `${out}/01-metro.png` });

// 4. The panel starts collapsed; opening it shows the ranked list, one map pin per row, and a row opens a cluster
if (await page.locator('[data-testid="opportunity-list"]').count()) throw new Error("panel should start collapsed");
await page.click('[data-testid="panel-toggle"]');
await page.waitForSelector('[data-testid="opportunity-row"]', { timeout: 30000 });
const rows = await page.locator('[data-testid="opportunity-row"]').count();
if (!rows) throw new Error("no opportunities ranked");
const pins = await page.locator('[data-testid="map-pin"]').count();
if (pins !== rows) throw new Error(`map shows ${pins} pins for ${rows} ranked spots`);
console.log("opportunities:", rows, "| first:", (await page.locator('[data-testid="opportunity-row"]').first().textContent())?.replace(/\s+/g, " "));
await page.locator('[data-testid="opportunity-row"]').first().click();
await page.waitForSelector('[data-testid="panel-cell"]');
await page.waitForSelector('[data-testid="needed"]');
await page.waitForTimeout(500);
console.log("footnote:", await page.textContent('[data-testid="cluster-footnote"]'));
await page.screenshot({ path: `${out}/cluster.png` });

// 5. A seller opens, and back returns to the cluster
await page.locator('[data-testid="door-list"] button').first().click();
await page.waitForSelector('[data-testid="panel-seller"]');
await page.screenshot({ path: `${out}/03-seller.png` });
await page.getByText("← Volver al cluster").click();

// 6. Changing the radius re-ranks and lands in the URL
await page.getByText("← Oportunidades").click();
await page.click('[data-testid="radius-8"]');
await page.waitForFunction(() => location.search.includes("r=8"));
await page.reload();
await page.waitForSelector('[data-testid="radius-8"][aria-pressed="true"]');
await page.waitForSelector('[data-testid="map-pin"]', { timeout: 30000 });

// A pin opens its spot and expands the collapsed panel
await page.locator('[data-testid="map-pin"]').first().click();
await page.waitForSelector('[data-testid="panel-cell"]');
await page.getByText("← Oportunidades").click();
await page.waitForSelector('[data-testid="opportunity-row"]', { timeout: 30000 });

// 7. Filters: clearing them adds sellers to the header count
const before = await page.textContent('[data-testid="stats"]');
await page.click('[data-testid="filters-button"]');
await page.waitForSelector('[data-testid="filters-popover"]');
await page.screenshot({ path: `${out}/04-filters.png` });
await page.getByText("Limpiar").click();
await page.waitForFunction((b) => document.querySelector('[data-testid="stats"]')?.textContent !== b, before);
console.log("stats after Limpiar:", await page.textContent('[data-testid="stats"]'));

// 8. Street zoom shows door-level dots under the heat
await page.evaluate(() => window.__elogMap.jumpTo({ center: [-58.62, -34.65], zoom: 14 }));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/05-doors.png` });

// 9. Sign out (in the menu) returns to login
await page.click('[data-testid="menu-button"]');
await page.click("text=Salir");
await page.waitForURL(/\/login/);

const real = errors.filter((e) => !/basemaps\.cartocdn|Failed to fetch|net::ERR|AJAXError|style/i.test(e));
if (real.length) { console.error("browser errors:", real); process.exit(1); }
console.log("OK");
await browser.close();
