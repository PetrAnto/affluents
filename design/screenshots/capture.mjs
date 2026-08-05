// Screenshot capture for affluents.money — real pages, no mocks (DEMO_DATA_HANDOFF).
// Secrets: DASHBOARD_SECRET comes from the environment at runtime, never from
// this file. Playwright page screenshots never include the URL bar, so
// secret-bearing dashboard URLs cannot leak into captured frames.
//
// Usage:
//   node design/screenshots/capture.mjs smoke
//   DASHBOARD_SECRET=... node design/screenshots/capture.mjs defluence
//
// `defluence` arms BEFORE the operator clicks Confirm (operator instruction,
// 2026-08-05): it launches the browser, then polls the dashboard until the
// server-rendered "Withdrawal in progress" card appears, then captures the
// pending window. Read-only — this script never clicks anything.

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const BASE_URL = (process.env.BASE_URL ?? 'https://affluents.money').replace(/\/$/, '');
const CHROME_PATH =
  process.env.CHROME_PATH ??
  '/home/petranto/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

function requireSecret() {
  const s = process.env.DASHBOARD_SECRET;
  if (!s) {
    console.error('DASHBOARD_SECRET is not set (pass it via the environment).');
    process.exit(1);
  }
  return s;
}

async function launch() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH });
  return browser;
}

async function shoot(page, name) {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`captured ${name}.png`);
  return path;
}

async function smoke() {
  const browser = await launch();
  const page = await browser.newPage({ viewport: DESKTOP, deviceScaleFactor: 2 });
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await shoot(page, 'smoke-landing');
  await browser.close();
}

// Poll the dashboard until a pending withdrawal is server-rendered, then
// capture the defluence window: element frames of the withdraw card plus one
// full-viewport frame, spaced while the pending state lasts.
async function defluence() {
  const secret = requireSecret();
  const url = `${BASE_URL}/dashboard/${secret}`;
  const armedAt = Date.now();
  const ARM_TIMEOUT_MS = 10 * 60 * 1000;

  const browser = await launch();
  const page = await browser.newPage({ viewport: DESKTOP, deviceScaleFactor: 2 });
  console.log('armed: polling for pending withdrawal (10 min max) — click Confirm when ready');

  while (true) {
    if (Date.now() - armedAt > ARM_TIMEOUT_MS) {
      console.error('timed out with no pending withdrawal seen');
      await browser.close();
      process.exit(2);
    }
    // JSON state, never HTML string-matching: the literal text "Withdrawal in
    // progress" also appears in the dashboard's static client-side JS, so an
    // includes() on the page fires with no withdrawal at all (learned live,
    // 2026-08-05).
    const res = await fetch(`${url}/withdrawals`).catch(() => null);
    if (res?.ok) {
      const { withdrawals } = await res.json();
      if ((withdrawals ?? []).some((w) => w.withdrawal.state === 'pending')) break;
    }
    await new Promise((r) => setTimeout(r, 700));
  }

  console.log('pending withdrawal detected — capturing');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // .defl (the defluence glyph) exists only in the pending-withdrawal card.
  const card = page.locator('#wd:has(.defl)');
  for (let i = 1; i <= 3; i++) {
    try {
      await card.waitFor({ state: 'visible', timeout: 3000 });
      await card.screenshot({ path: join(OUT_DIR, `withdraw-defluence-pending-card-${i}.png`) });
      console.log(`captured withdraw-defluence-pending-card-${i}.png`);
    } catch {
      console.log(`frame ${i}: withdraw card no longer pending`);
      break;
    }
    if (i === 1) await shoot(page, 'withdraw-defluence-pending-page');
    await new Promise((r) => setTimeout(r, 1200));
  }
  await browser.close();
}

// Gate 2 set (approved 2026-08-05). Public invoice ids of the demo dataset —
// these appear in public pay URLs, nothing secret.
const PAY_AWAITING_ID = 'inv_04fcd2b09482117984'; // Cabinet Ferro 2026-021
const PAY_PAID_ID = 'inv_12d7d8c4e4979bc6a1'; // Studio Lumen 2026-017

async function gate2() {
  const secret = requireSecret();
  const browser = await launch();
  const desktop = await browser.newPage({ viewport: DESKTOP, deviceScaleFactor: 2 });
  const mobile = await browser.newPage({ viewport: MOBILE, deviceScaleFactor: 2 });

  // 1 — landing
  await desktop.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await shoot(desktop, 'landing');

  // 2 — create, filled, never submitted
  await desktop.goto(`${BASE_URL}/create`, { waitUntil: 'networkidle' });
  await desktop.fill('#fAmount', '2.15');
  await desktop.fill('#fClient', 'Nordwind Media');
  await desktop.fill('#fMemo', 'Motion design — episode 4');
  await shoot(desktop, 'create-filled');

  // 3/4 — pay awaiting, both viewports
  await desktop.goto(`${BASE_URL}/pay/${PAY_AWAITING_ID}`, { waitUntil: 'networkidle' });
  await shoot(desktop, 'pay-awaiting');
  await mobile.goto(`${BASE_URL}/pay/${PAY_AWAITING_ID}`, { waitUntil: 'networkidle' });
  await shoot(mobile, 'pay-awaiting-mobile');

  // 5 — pay paid, with routing rows; also yields the receipt token at runtime
  await desktop.goto(`${BASE_URL}/pay/${PAY_PAID_ID}`, { waitUntil: 'networkidle' });
  await shoot(desktop, 'pay-paid');
  const receiptHref = await desktop.locator('a[href^="/r/"]').first().getAttribute('href');
  if (!receiptHref) throw new Error('no receipt link on the paid pay page');

  // 6/7 — receipt (client portal view), both viewports
  await desktop.goto(`${BASE_URL}${receiptHref}`, { waitUntil: 'networkidle' });
  await shoot(desktop, 'receipt');
  await mobile.goto(`${BASE_URL}${receiptHref}`, { waitUntil: 'networkidle' });
  await shoot(mobile, 'receipt-mobile');

  // 8 — dashboard fresh totals (page shot only — the URL bar never renders)
  const dash = `${BASE_URL}/dashboard/${secret}`;
  await desktop.goto(dash, { waitUntil: 'networkidle' });
  await shoot(desktop, 'dashboard-totals');

  // 9 — withdrawals history scrolled into view
  await desktop.locator('.slabel', { hasText: 'Withdrawals' }).first().scrollIntoViewIfNeeded();
  await shoot(desktop, 'dashboard-withdrawals');

  // 10 — withdraw confirm step. Client-side only: #wdGo swaps the card to the
  // confirm prompt; no network request exists until #wdYes, which this script
  // NEVER clicks (Gate 2 approval; single-withdrawal discipline).
  await desktop.goto(dash, { waitUntil: 'networkidle' });
  await desktop.fill('#wdAmt', '0.25');
  await desktop.click('#wdGo');
  await desktop.locator('#wdConfirm').waitFor({ state: 'visible', timeout: 3000 });
  await desktop.locator('#wd').scrollIntoViewIfNeeded();
  await shoot(desktop, 'withdraw-confirm');

  await browser.close();
}

// Element shot of the Earn bucket card in the withdraw confirm state, for
// the deck's withdraw slide. Same safety property as gate2's frame 10: the
// confirm step is client-side; #wdYes is never clicked, nothing is written.
async function withdrawcard() {
  const secret = requireSecret();
  const browser = await launch();
  const page = await browser.newPage({ viewport: DESKTOP, deviceScaleFactor: 2 });
  await page.goto(`${BASE_URL}/dashboard/${secret}`, { waitUntil: 'networkidle' });
  await page.fill('#wdAmt', '0.25');
  await page.click('#wdGo');
  await page.locator('#wdConfirm').waitFor({ state: 'visible', timeout: 3000 });
  await page.locator('.bcard:has(#wd)').screenshot({ path: join(OUT_DIR, 'withdraw-confirm-card.png') });
  console.log('captured withdraw-confirm-card.png');
  await browser.close();
}

// VIDEO_SCRIPT shot 5: Playwright VIDEO recording of the live dashboard while
// the operator's M2 payment routes. Read-only — reload loop only, no clicks.
// Arm between clips M1 and M2; prints when recording so M2 can start.
async function shot5() {
  const secret = requireSecret();
  const url = `${BASE_URL}/dashboard/${secret}`;
  const rawDir = join(OUT_DIR, '..', 'media', 'raw');
  mkdirSync(rawDir, { recursive: true });
  const browser = await launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: rawDir, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  const total = async () => (await page.textContent('body'))?.match(/Total received[^\d]*([\d.]+)/)?.[1];
  const t0 = await total();
  console.log(`RECORDING — baseline total ${t0} USDC. Run clip M2 (pay) now.`);

  const deadline = Date.now() + 150_000;
  let landed = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(4000);
    await page.reload({ waitUntil: 'networkidle' });
    const t = await total();
    if (!landed && t !== t0) {
      landed = true;
      console.log(`payment landed — total now ${t}; recording routing for ~40s more`);
      // routing + live FX complete in ~45s; keep reloading through it
      for (let i = 0; i < 9; i++) {
        await page.waitForTimeout(4500);
        await page.reload({ waitUntil: 'networkidle' });
      }
      await page.waitForTimeout(8000); // hold on the settled totals
      break;
    }
  }
  if (!landed) console.log('no payment seen within 150s — video saved anyway, re-arm for another take');
  const video = page.video();
  await context.close();
  const path = await video.path();
  console.log('VIDEO_WRITTEN ' + path);
  await browser.close();
}

async function recordingContext(browser) {
  const rawDir = join(OUT_DIR, '..', 'media', 'raw');
  mkdirSync(rawDir, { recursive: true });
  return browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: rawDir, size: { width: 1920, height: 1080 } },
  });
}

async function finishRecording(page, context, browser, name) {
  const video = page.video();
  await context.close();
  const path = await video.path();
  const { renameSync } = await import('node:fs');
  const dest = join(OUT_DIR, '..', 'media', 'raw', `${name}.webm`);
  renameSync(path, dest);
  console.log('VIDEO_WRITTEN ' + dest);
  await browser.close();
}

// Shot 7 — honest FX: the paid invoice's routing rows (journaled live rate,
// actual EURC out). Public page, read-only. Pass the invoice id as argv[3].
async function shot7() {
  const invId = process.argv[3];
  if (!invId) { console.error('usage: node capture.mjs shot7 <invoice-id>'); process.exit(1); }
  const browser = await launch();
  const context = await recordingContext(browser);
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/pay/${invId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  await page.locator('text=live rate').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(11000); // hold on the FX line
  await finishRecording(page, context, browser, 'shot7-fx');
}

// Shot 9 — THE withdrawal take (VIDEO_SCRIPT beat 6). Moves money: run ONLY
// after the operator's explicit go. This is the single scripted #wdYes click
// in the repo; single-pending discipline is server-enforced.
async function shot9() {
  const secret = requireSecret();
  const browser = await launch();
  const context = await recordingContext(browser);
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/dashboard/${secret}`, { waitUntil: 'networkidle' });
  await page.locator('#wd').scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
  await page.fill('#wdAmt', '0.30');
  await page.waitForTimeout(1200);
  await page.click('#wdGo');
  await page.locator('#wdConfirm').waitFor({ state: 'visible' });
  await page.waitForTimeout(2500); // hold on the confirm question
  await page.click('#wdYes');
  console.log('confirmed — recording defluence through completion');
  // The card polls and the page reloads itself on completion; record through
  // the pending window plus the settled reload.
  await page.waitForTimeout(45000);
  await finishRecording(page, context, browser, 'shot9-withdraw');
}

// Shot 10 — withdrawals history row + ArcScan flash. Read-only navigation;
// retargets the explorer link to the same tab so the recording follows it.
async function shot10() {
  const secret = requireSecret();
  const browser = await launch();
  const context = await recordingContext(browser);
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/dashboard/${secret}`, { waitUntil: 'networkidle' });
  await page.locator('.slabel', { hasText: 'Withdrawals' }).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(6000); // hold on the history rows
  const link = page.locator('section:has(.slabel:text("Withdrawals")) a', { hasText: 'Vault' }).first();
  await link.evaluate((a) => a.removeAttribute('target'));
  await link.click();
  await page.waitForLoadState('load');
  await page.waitForTimeout(6000); // flash ArcScan
  await finishRecording(page, context, browser, 'shot10-history');
}

const mode = process.argv[2];
const modes = { smoke, defluence, gate2, withdrawcard, shot5, shot7, shot9, shot10 };
if (!modes[mode]) {
  console.error(`usage: node capture.mjs <${Object.keys(modes).join('|')}>`);
  process.exit(1);
}
await modes[mode]();
