import { asUsdc6, format6, type Usdc6 } from '@affluents/shared';
import type { getDashboardData } from '../db';
import { esc, footerMark, glyphSvg, page } from '../html';
import type { InvoiceRow } from '../types';

// Ported from design/dashboard.html (the second "invalid" split card there is
// review-only reference; the live editor below validates in place instead).
const CSS = `
.page{min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:0 32px}
.col{width:100%;max-width:1120px;display:flex;flex-direction:column;flex:1 1 auto}
header.top{display:flex;align-items:center;justify-content:space-between;padding:24px 0 22px;border-bottom:1px solid var(--contour)}
.lockup{display:flex;align-items:center;gap:9px}
.lockup a{display:flex;align-items:center;gap:9px;text-decoration:none;color:var(--ink)}
.wordmark{font-family:var(--font-display);font-size:21px;font-weight:500;letter-spacing:.01em;line-height:1}
.total{display:flex;align-items:baseline;gap:8px}
.total .l{font-size:12.5px;color:var(--muted)}
.total .v{font-size:15px;font-weight:600}
.slabel{font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.slabel .lc{letter-spacing:.02em;text-transform:none;font-weight:400}
section{padding:24px 0 4px}
section.first{padding-top:26px}
.cards{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px}
@media (max-width:760px){.cards{grid-template-columns:1fr}}
.bcard{background:var(--surface);border:1px solid var(--contour);border-radius:10px;overflow:hidden}
.bcard .rule{height:2px}
.bcard .inner{padding:17px 20px 19px;display:flex;flex-direction:column;gap:9px}
.bcard .name{font-size:13px;font-weight:600}
.bcard .name em{font-style:normal;font-weight:400;color:var(--muted)}
.bcard .stat{font-size:28px;font-weight:600;letter-spacing:-.01em;line-height:1.1}
.bcard .stat span{font-size:14px;font-weight:500;color:var(--muted)}
.bcard .cap{font-size:12px;color:var(--muted)}
.bcard a{text-decoration:none}
.chartcard{margin-top:12px;background:var(--surface);border:1px solid var(--contour);border-radius:10px;padding:16px 20px 10px}
.chartcard svg{display:block;width:100%;height:auto}
.chartcard text{font-family:var(--font-body);font-feature-settings:'tnum'}
.splitcard{margin-top:12px;background:var(--surface);border:1px solid var(--contour);border-radius:10px;padding:17px 20px;display:flex;align-items:flex-end;gap:22px;flex-wrap:wrap}
.field{display:flex;flex-direction:column;gap:6px}
.field .fl{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
.pdot{width:5px;height:5px;border-radius:50%;flex:none}
.pdot.river{background:var(--river)} .pdot.reserve{background:var(--reserve)} .pdot.earn{background:var(--earn)}
.field input{width:84px;border:1px solid var(--contour);border-radius:6px;padding:9px 11px;font-family:var(--font-body);font-size:14px;font-weight:500;text-align:right;color:var(--ink);background:var(--surface);outline:none;font-feature-settings:'tnum'}
.field input:focus{border-color:var(--river)}
.sum{padding-bottom:10px;font-size:13.5px;font-weight:500;font-feature-settings:'tnum'}
.sum.ok{color:var(--earn)} .sum.bad{color:var(--reserve)}
.grow{flex:1 1 auto}
.save{border:none;border-radius:7px;background:var(--river);color:#fff;font-family:var(--font-body);font-size:13.5px;font-weight:500;padding:11px 18px;cursor:pointer}
.save:hover{background:var(--river-deep)}
.save:disabled{background:var(--contour);color:var(--muted);cursor:default}
.exc{margin-top:12px;background:var(--surface);border:1px solid var(--contour);border-radius:10px;padding:15px 20px;display:flex;align-items:center;gap:14px}
.exc .dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--reserve)}
.exc .body{flex:1 1 auto;display:flex;flex-direction:column;gap:3px}
.exc .t{font-size:13.5px;font-weight:500}
.exc .m{font-size:12px;color:var(--muted)}
.exc .m a{text-decoration:none}
.empty{margin-top:12px;background:var(--surface);border:1px solid var(--contour);border-radius:10px;padding:22px 20px;display:flex;flex-direction:column;align-items:center;gap:10px}
.empty svg{color:var(--contour)}
.empty p{margin:0;font-size:13px;color:var(--muted)}
table{width:100%;border-collapse:collapse;margin-top:4px}
th{text-align:left;font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);padding:12px 16px 9px 0;border-bottom:1px solid var(--contour)}
th.num{text-align:right} th.stat{padding-left:24px} th.last{text-align:right;padding-right:0}
td{padding:13px 16px 13px 0;border-bottom:1px solid var(--contour);font-size:13px}
td.id{font-weight:500;white-space:nowrap;font-feature-settings:'tnum'}
td.id a{color:var(--ink);text-decoration:none} td.id a:hover{color:var(--river)}
td.num{text-align:right;font-weight:500;white-space:nowrap;font-feature-settings:'tnum'}
td.num span{font-size:11.5px;color:var(--muted);font-weight:400}
td.stat{padding-left:24px}
td.stat .s{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-feature-settings:'tnum'}
.sdot{width:6px;height:6px;border-radius:50%;flex:none}
td.date{font-size:12.5px;color:var(--muted);white-space:nowrap}
td.last{text-align:right;padding-right:0;white-space:nowrap}
td.last a{font-size:12.5px;text-decoration:none}
.spring{flex:1 1 0}
.mark{padding:44px 0 26px;display:flex;flex-direction:column;align-items:center;gap:7px}
.mark svg{color:var(--contour)}
.mark span{font-size:11px;color:var(--muted);letter-spacing:.02em}`;

type DashData = Awaited<ReturnType<typeof getDashboardData>>;

function u6(n: number): Usdc6 {
  return asUsdc6(BigInt(n));
}

function statusCell(inv: InvoiceRow, fxPending = false): { dot: string; text: string } {
  if (inv.status === 'completed') {
    return inv.overpaid || inv.unexpected_payment
      ? { dot: 'var(--reserve)', text: 'Routed · extra held' }
      : { dot: 'var(--earn)', text: 'Routed' };
  }
  if (inv.status === 'payment_reported') return { dot: 'var(--river)', text: 'Verifying' };
  if (inv.status === 'payment_verified') {
    return inv.overpaid || inv.unexpected_payment
      ? { dot: 'var(--reserve)', text: 'Paid · extra held' }
      : { dot: 'var(--river)', text: 'Paid' };
  }
  // Neutral halt copy (Decision 3) — never a silent downgrade, never an error.
  if (inv.status === 'routing' && fxPending) return { dot: 'var(--reserve)', text: 'FX pending — rate unavailable' };
  if (inv.status === 'routing') return { dot: 'var(--river)', text: 'Routing' };
  if (inv.status === 'failed_retryable') return { dot: 'var(--reserve)', text: 'Failed — retrying' };
  if (inv.status === 'failed_terminal') return { dot: 'var(--reserve)', text: 'Failed' };
  if (inv.received_usdc6 > 0) {
    return {
      dot: 'var(--river)',
      text: `Partial — ${format6(u6(inv.received_usdc6))} of ${format6(u6(inv.amount_usdc6))} received`,
    };
  }
  if (inv.status === 'awaiting_wallet') return { dot: 'var(--contour)', text: 'Awaiting wallet' };
  return { dot: 'var(--contour)', text: 'Awaiting payment' };
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Step chart of cumulative received USDC over the last 30 days
 * (kickoff-additions §2), same geometry as design/dashboard.html.
 */
function stepChart(invoices: InvoiceRow[], now: Date): string {
  const X0 = 44, X1 = 1072, Y0 = 166, Y1 = 19.1;
  const end = now.getTime();
  const start = end - 30 * 24 * 3600 * 1000;

  const events = invoices
    .filter((i) => i.received_usdc6 > 0 && i.paid_at)
    .map((i) => ({ t: new Date(i.paid_at! + (i.paid_at!.endsWith('Z') ? '' : 'Z')).getTime(), v: BigInt(i.received_usdc6) }))
    .sort((a, b) => a.t - b.t);

  let base = 0n; // cumulative received before the window opens
  const inWindow: Array<{ t: number; cum: bigint }> = [];
  let cum = 0n;
  for (const e of events) {
    cum += e.v;
    if (e.t < start) base = cum;
    else if (e.t <= end) inWindow.push({ t: e.t, cum });
  }
  const maxCum = cum > 0n ? cum : 1n;

  // nice tick step for 4 gridlines (0 + 3): whole USDC
  const maxWhole = Number(maxCum / 1_000_000n) + 1;
  const rawStep = maxWhole / 3;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(rawStep, 1))));
  const step = [1, 2, 4, 5, 10].map((m) => m * mag).find((s) => s * 3 >= maxWhole) ?? 10 * mag;
  const yMax = step * 3;

  const x = (t: number) => X0 + ((t - start) / (end - start)) * (X1 - X0);
  const y = (v: bigint) => Y0 - (Number(v / 1_000_000n) / yMax) * (Y0 - Y1);

  let d = `M${X0} ${y(base).toFixed(1)}`;
  let lastY = y(base);
  for (const p of inWindow) {
    const px = x(p.t).toFixed(1);
    const py = y(p.cum);
    d += ` H${px} V${py.toFixed(1)}`;
    lastY = py;
  }
  d += ` H${X1}`;

  const grid = [0, 1, 2, 3]
    .map((i) => {
      const gy = (Y0 - (i * (Y0 - Y1)) / 3).toFixed(1);
      const label = (i * step).toLocaleString('en-US');
      return `<line x1="${X0}" y1="${gy}" x2="${X1}" y2="${gy}" stroke="var(--contour)" stroke-width="1"/>
  <text x="36" y="${(Number(gy) + 3.5).toFixed(1)}" text-anchor="end" fill="var(--muted)" font-size="11">${label}</text>`;
    })
    .join('\n  ');

  const fmtDay = (t: number) =>
    new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

  return `<svg viewBox="0 0 1080 196" role="img" aria-label="Cumulative USDC received over the last 30 days">
  ${grid}
  <path d="${d}" fill="none" stroke="var(--ink)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  <text x="${X0}" y="188" text-anchor="start" fill="var(--muted)" font-size="11">${fmtDay(start)}</text>
  <text x="${X1}" y="188" text-anchor="end" fill="var(--muted)" font-size="11">${fmtDay(end)}</text>
</svg>`;
}

export function dashboardPage(data: DashData, secret: string, explorer: string, now: Date, fxAdapter = 'treasury'): string {
  const { totals, invoices, rule, exceptions, fxHalted, fxLatestSource } = data;
  // Journaled rate_source of the latest completed conversion wins; the env
  // adapter name is only the pre-journal fallback.
  const fxNote =
    fxLatestSource === 'appkit'
      ? ' · live rate'
      : fxLatestSource === 'demo' || fxAdapter === 'treasury'
        ? ' · demo rate'
        : '';
  const fxPendingIds = new Set((fxHalted ?? []).map((h) => h.invoice_id));

  const invoiceRows = invoices
    .map((inv) => {
      const st = statusCell(inv, fxPendingIds.has(inv.id));
      const addrUrl = inv.deposit_address ? `${explorer}/address/${inv.deposit_address}` : null;
      return `<tr>
        <td class="id"><a href="/pay/${esc(inv.id)}">${esc(inv.display_no)}</a></td>
        <td>${esc(inv.label)}</td>
        <td class="num">${format6(u6(inv.amount_usdc6))} <span>USDC</span></td>
        <td class="stat"><span class="s"><i class="sdot" style="background:${st.dot}"></i>${esc(st.text)}</span></td>
        <td class="date">${fmtDate(inv.created_at)}</td>
        <td class="last">${addrUrl ? `<a href="${addrUrl}" target="_blank" rel="noopener">ArcScan ↗</a>` : ''}</td>
      </tr>`;
    })
    .join('\n');

  const excRows = exceptions
    .map((e) => {
      const meta = [e.display_no ? `Invoice ${e.display_no}` : null, e.label, e.deposit_address ? `<a href="${explorer}/address/${e.deposit_address}" target="_blank" rel="noopener">ArcScan ↗</a>` : null]
        .filter(Boolean)
        .join(' · ');
      return `<div class="exc">
        <i class="dot"></i>
        <div class="body">
          <span class="t tnum">Extra ${format6(u6(e.delta6))} USDC received — held, not routed</span>
          <span class="m">${meta}</span>
        </div>
      </div>`;
    })
    .join('\n');

  // Halted FX legs: honest copy only — funds sit in USDC; the euro figure is
  // explicitly indicative (ECB reference), never a ledger claim (Decision 3).
  const fxRows = (fxHalted ?? [])
    .map((h) => {
      const indicative =
        h.oracle_rate_ppm !== null && h.oracle_rate_ppm > 0
          ? ` · ≈ €${format6(asUsdc6((BigInt(h.amount_in_usdc6) * BigInt(h.oracle_rate_ppm)) / 1_000_000n))} at ECB reference rate — indicative, conversion pending`
          : '';
      const meta = [h.display_no ? `Invoice ${h.display_no}` : null, h.label].filter(Boolean).join(' · ');
      return `<div class="exc">
        <i class="dot"></i>
        <div class="body">
          <span class="t tnum">FX pending — rate unavailable · ${format6(u6(h.amount_in_usdc6))} USDC held unconverted${indicative}</span>
          <span class="m">${meta}</span>
        </div>
      </div>`;
    })
    .join('\n');

  const body = `<main class="page">
  <div class="col">

    <header class="top">
      <div class="lockup">
        <a href="/">${glyphSvg(30, 15)}<span class="wordmark">affluents</span></a>
      </div>
      <div class="total"><span class="l">Total received ·</span><span class="v tnum">${format6(totals.totalReceivedUsdc6 as Usdc6)} USDC</span></div>
    </header>

    <section class="first">
      <div class="cards">
        <div class="bcard">
          <div class="rule" style="background:var(--river)"></div>
          <div class="inner">
            <div class="name">Spend</div>
            <div class="stat tnum">${format6(totals.spendEurc6 as Usdc6)} <span>EURC</span></div>
            <div class="cap tnum">Auto-swapped from ${format6(totals.spendInUsdc6 as Usdc6)} USDC${fxNote} · ${rule.spend_pct}% of each payment</div>
          </div>
        </div>
        <div class="bcard">
          <div class="rule" style="background:var(--reserve)"></div>
          <div class="inner">
            <div class="name">Reserve</div>
            <div class="stat tnum">${format6(totals.reserveUsdc6 as Usdc6)} <span>USDC</span></div>
            <div class="cap tnum">Tax reserve · ${rule.reserve_pct}% of each payment</div>
          </div>
        </div>
        <div class="bcard">
          <div class="rule" style="background:var(--earn)"></div>
          <div class="inner">
            <div class="name">Earn <em>— Demo Vault, on-chain position</em></div>
            <div class="stat tnum">${format6(totals.earnUsdc6 as Usdc6)} <span>USDC</span></div>
            <div class="cap tnum">${rule.earn_pct}% of each payment</div>
          </div>
        </div>
      </div>
    </section>

    <section>
      <div class="slabel">Received over time <span class="lc">· cumulative USDC, last 30 days</span></div>
      <div class="chartcard">
        ${stepChart(invoices, now)}
      </div>
    </section>

    <section>
      <div class="slabel">Split rule</div>
      <div class="splitcard">
        <div class="field">
          <span class="fl"><i class="pdot river"></i>Spend %</span>
          <input id="inSpend" value="${rule.spend_pct}" inputmode="numeric">
        </div>
        <div class="field">
          <span class="fl"><i class="pdot reserve"></i>Reserve %</span>
          <input id="inReserve" value="${rule.reserve_pct}" inputmode="numeric">
        </div>
        <div class="field">
          <span class="fl"><i class="pdot earn"></i>Earn %</span>
          <input id="inEarn" value="${rule.earn_pct}" inputmode="numeric">
        </div>
        <div class="sum ok" id="sumInd">= 100 ✓</div>
        <div class="grow"></div>
        <button class="save" id="saveBtn">Save rule</button>
      </div>
    </section>

    ${
      excRows || fxRows
        ? `<section>
      <div class="slabel">Exceptions</div>
      ${excRows}${fxRows ? `\n      ${fxRows}` : ''}
    </section>`
        : ''
    }

    <section>
      <div class="slabel">Invoices</div>
      ${
        invoiceRows
          ? `<table>
        <thead>
          <tr>
            <th>Invoice</th><th>Client</th><th class="num">Amount</th><th class="stat">Status</th><th>Date</th><th class="last">Explorer</th>
          </tr>
        </thead>
        <tbody>
          ${invoiceRows}
        </tbody>
      </table>`
          : `<div class="empty">
        ${glyphSvg(48, 24, 'currentColor')}
        <p>No invoices yet. <a href="/create">Create a payment link</a> to get started.</p>
      </div>`
      }
    </section>

    <div class="spring"></div>
    ${footerMark()}
  </div>
</main>

<script>
(function () {
  var inputs = [document.getElementById('inSpend'), document.getElementById('inReserve'), document.getElementById('inEarn')];
  var ind = document.getElementById('sumInd');
  var btn = document.getElementById('saveBtn');
  function vals() {
    return inputs.map(function (el) {
      var n = parseInt(String(el.value).replace(/\\D/g, ''), 10);
      return isNaN(n) ? 0 : Math.min(100, Math.max(0, n));
    });
  }
  function update() {
    var sum = vals().reduce(function (t, n) { return t + n; }, 0);
    var ok = sum === 100;
    ind.textContent = ok ? '= 100 ✓' : '= ' + sum + ' — must equal 100';
    ind.className = 'sum ' + (ok ? 'ok' : 'bad');
    btn.disabled = !ok;
    if (!ok) btn.textContent = 'Save rule';
  }
  inputs.forEach(function (el) { el.addEventListener('input', update); });
  var t;
  btn.addEventListener('click', function () {
    var v = vals();
    btn.disabled = true;
    fetch(window.location.pathname + '/rule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spendPct: v[0], reservePct: v[1], earnPct: v[2] })
    }).then(function (r) {
      btn.disabled = false;
      btn.textContent = r.ok ? 'Saved ✓' : 'Save failed — retry';
      clearTimeout(t);
      t = setTimeout(function () { btn.textContent = 'Save rule'; update(); }, 2200);
    }).catch(function () {
      btn.disabled = false;
      btn.textContent = 'Save failed — retry';
    });
  });
})();
</script>`;
  return page('Dashboard · affluents', CSS, body);
}
