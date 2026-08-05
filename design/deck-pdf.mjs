// Regenerates design/final-deck.pdf from design/deck-print.html.
//
// Dependencies stay OUTSIDE this repo (PROGRESS 2026-07-23: never add
// node_modules/package.json here). One-time setup, e.g. in ~/deck-tools:
//   npm i playwright && npx playwright install chromium
// Then run from that directory so 'playwright' resolves:
//   node ~/affluents/design/deck-pdf.mjs
// PDF_OUT overrides the output path. The dims JSON printed first is the
// no-clipping check: every slide must report h and scrollH of exactly 1080.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const SRC = new URL('./deck-print.html', import.meta.url).href;
const OUT = process.env.PDF_OUT || fileURLToPath(new URL('./final-deck.pdf', import.meta.url));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(SRC, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(1500); // let Google Fonts settle
const dims = await page.evaluate(() =>
  [...document.querySelectorAll('section.slide')].map((s, i) => {
    const r = s.getBoundingClientRect();
    return { n: i + 1, h: Math.round(r.height), scrollH: s.scrollHeight };
  })
);
console.log(JSON.stringify(dims));
await page.pdf({ path: OUT, printBackground: true, preferCSSPageSize: true, width: '1920px', height: '1080px' });
await browser.close();
console.log('PDF_WRITTEN ' + OUT);
