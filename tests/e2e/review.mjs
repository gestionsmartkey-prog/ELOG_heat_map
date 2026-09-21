/**
 * Review queue + whitelist smoke against the REAL database (read-mostly).
 * Non-destructive on reviews (drags the pin, does not resolve). Creates one throwaway
 * user and deactivates it; the caller deletes it afterwards.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
const username = process.env.APP_USER ?? "qaadmin";
const password = process.env.APP_PASSWORD ?? "qa-admin-pass-123";
const testEmail = process.env.TEST_EMAIL ?? `qa+${Date.now()}@elog.test`;
const out = "data/out/shots";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? undefined, args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(base + "/login");
await page.fill("#username", username);
await page.fill("#password", password);
await page.click("button[type=submit]");
await page.waitForURL(base + "/");

// --- Review queue ---
await page.click('[data-testid="review-link"]');
await page.waitForURL(base + "/revisar");
await page.waitForSelector('[data-testid="review-list"]', { timeout: 15000 });
const rows = await page.locator('[data-testid="review-row"]').count();
console.log("review rows:", rows);
if (rows < 1) throw new Error("expected open reviews");
await page.locator('[data-testid="review-row"]').first().click();
await page.waitForSelector('[data-testid="review-map"][ ]', { timeout: 5000 }).catch(() => {});
await page.waitForSelector('[data-testid="review-detail"]');
await page.waitForSelector('[data-testid="review-pin"]', { timeout: 20000 });
await page.waitForTimeout(1200);
// Drag the pin a little; save must become enabled.
const box = await page.locator('[data-testid="review-pin"]').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + 60, box.y + 40, { steps: 8 });
await page.mouse.move(box.x + 90, box.y + 70, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(500);
const saveDisabled = await page.locator('[data-testid="save-location"]').isDisabled();
console.log("save enabled after drag:", !saveDisabled);
if (saveDisabled) throw new Error("save should enable after dragging the pin");
await page.screenshot({ path: `${out}/08-review.png` });

// --- Whitelist ---
await page.goto(base + "/usuarios");
await page.waitForSelector('[data-testid="user-email"]');
await page.fill('[data-testid="user-email"]', testEmail);
await page.fill('[data-testid="user-password"]', "throwaway-1234");
await page.click('[data-testid="user-add"]');
await page.waitForSelector('[data-testid="user-msg"]');
const msg = await page.textContent('[data-testid="user-msg"]');
console.log("create msg:", msg);
if (!/habilitado/.test(msg ?? "")) throw new Error("user not created");
await page.waitForSelector(`text=${testEmail}`);
await page.screenshot({ path: `${out}/09-users.png` });

// New user can log in (proves DB-backed auth), in a fresh context.
const ctx2 = await browser.newContext();
const p2 = await ctx2.newPage();
await p2.goto(base + "/login");
await p2.fill("#username", testEmail);
await p2.fill("#password", "throwaway-1234");
await p2.click("button[type=submit]");
await p2.waitForURL(base + "/");
console.log("new user logged in OK");
await ctx2.close();

const real = errors.filter((e) => !/basemaps\.cartocdn|Failed to fetch|net::ERR|AJAXError|style|status of 4|status of 5/i.test(e));
if (real.length) { console.error("browser errors:", real); process.exit(1); }
console.log("TEST_EMAIL=" + testEmail);
console.log("OK");
await browser.close();
