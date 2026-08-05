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

const mode = process.argv[2];
const modes = { smoke, defluence, gate2, withdrawcard };
if (!modes[mode]) {
  console.error(`usage: node capture.mjs <${Object.keys(modes).join('|')}>`);
  process.exit(1);
}
await modes[mode]();
