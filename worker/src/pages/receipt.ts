import { esc, footerMark, glyphSvg, MARK_CSS, page } from '../html';
import type { PortalDto } from '../portal';

/**
 * Read-only client receipt (/r/:token). Server-rendered like the other pages;
 * the whole dynamic section is drawn by one render() from the embedded DTO,
 * re-run by a ~5s poll of GET /api/portal/:token while the state is non-final.
 * Copy lives ONCE in the COPY map below — internal jargon never appears here.
 */
const CSS = `
.page{min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:clamp(30px,8vh,96px) 20px 24px}
.col{width:100%;max-width:430px;display:flex;flex-direction:column;flex:1 1 auto}
.lockup{display:flex;align-items:center;justify-content:center;gap:9px;padding-bottom:34px}
.lockup .wordmark{font-family:var(--font-display);font-size:23px;font-weight:500;letter-spacing:.01em;line-height:1}
.invoice{text-align:center;margin:0}
.invoice .label{margin:0;font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.invoice .amount{margin:14px 0 0;font-family:var(--font-display);font-weight:500;font-size:56px;line-height:1;letter-spacing:-.01em}
.invoice .amount .cur{font-size:24px;font-weight:400;color:var(--muted);padding-left:8px}
.headline{margin:22px 0 0;text-align:center;font-size:15px;font-weight:500}
.headline .ok{color:var(--earn)}
.steps{margin:28px 0 0;display:flex;flex-direction:column}
.step{display:flex;gap:14px}
.step .rail{display:flex;flex-direction:column;align-items:center;width:12px;flex:none}
.step .dot{width:10px;height:10px;border-radius:50%;border:2px solid var(--contour);background:var(--surface);flex:none;margin-top:3px}
.step .line{width:2px;flex:1 1 auto;background:var(--contour);min-height:22px}
.step:last-child .line{display:none}
.step .body{padding-bottom:20px;min-width:0}
.step .name{font-size:14px;font-weight:500;color:var(--muted)}
.step .meta{margin-top:3px;font-size:12.5px;color:var(--muted);line-height:1.5}
.step.done .dot{border-color:var(--earn);background:var(--earn)}
.step.done .name{color:var(--ink)}
.step.done .line{background:var(--earn)}
.step.active .dot{border-color:var(--river);background:var(--surface)}
.step.active .name{color:var(--ink);font-weight:600}
@keyframes af-pulse{0%,100%{opacity:.35}50%{opacity:1}}
.step.active .dot{animation:af-pulse 1.3s ease-in-out infinite}
.card{background:var(--surface);border:1px solid var(--contour);border-radius:8px;padding:13px 16px;margin-top:10px;display:flex;align-items:flex-start;gap:10px}
.card .hdot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--reserve);margin-top:6px}
.card p{margin:0;font-size:13px;line-height:1.5}
.note{margin:16px 0 0;text-align:center;font-size:12.5px;color:var(--muted)}
.note a{text-decoration:none}
.tnum{font-feature-settings:'tnum';font-variant-numeric:tabular-nums}
${MARK_CSS}
@media (prefers-reduced-motion:reduce){.step.active .dot{animation:none;opacity:1}}`;

export function receiptPage(dto: PortalDto, token: string): string {
  const body = `<main class="page">
  <div class="col">
    <header class="lockup">
      ${glyphSvg(34, 17)}
      <span class="wordmark">affluents</span>
    </header>

    <section class="invoice">
      <p class="label">Receipt${dto.label ? ' · ' + esc(dto.label) : ''}</p>
      <p class="amount tnum" id="amount"></p>
    </section>

    <p class="headline" id="headline"></p>

    <div class="steps" id="steps"></div>

    <div id="notes"></div>

    <p class="note" id="txLinks"></p>
    <p class="note">Settled on Arc</p>

    <div class="spring"></div>
    ${footerMark()}
  </div>
</main>

<script>
window.__RECEIPT__ = ${JSON.stringify({ token, dto })};
</script>
<script>
(function () {
  var token = window.__RECEIPT__.token;

  /* 6-dec integer string -> display amount, truncated, thousands separators. */
  function fmt6(s) {
    var v = BigInt(s);
    var w = (v / 1000000n).toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
    return w + '.' + (v % 1000000n).toString().padStart(6, '0').slice(0, 2);
  }
  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var STEPS = ['Payment received', 'Verified on-chain', 'Allocated', 'Complete'];

  /* done = steps completed; active = index of the in-progress step (or -1). */
  var PROGRESS = {
    awaiting: { done: 0, active: 0 },
    verifying: { done: 1, active: 1 },
    verified: { done: 2, active: -1 },
    allocating: { done: 2, active: 2 },
    complete: { done: 4, active: -1 }
  };

  function headlineOf(d) {
    switch (d.client_state) {
      case 'awaiting': return escHtml('Awaiting payment — received ' + fmt6(d.received_usdc6) + ' of ' + fmt6(d.amount_usdc6) + ' USDC');
      case 'verifying': return escHtml('Payment received — verifying on-chain');
      case 'verified': return 'Payment verified on-chain <span class="ok">✓</span>';
      case 'allocating': return 'Payment confirmed <span class="ok">✓</span> — allocation in progress';
      case 'complete': return 'Complete <span class="ok">✓</span>';
    }
    return '';
  }

  function render(d) {
    document.getElementById('amount').innerHTML = fmt6(d.amount_usdc6) + '<span class="cur">USDC</span>';
    document.getElementById('headline').innerHTML = headlineOf(d);

    var p = PROGRESS[d.client_state] || PROGRESS.awaiting;
    var html = '';
    for (var i = 0; i < STEPS.length; i++) {
      var cls = i < p.done ? ' done' : i === p.active ? ' active' : '';
      var name = STEPS[i];
      if (i === 2 && d.client_state === 'complete' && d.rate_label) name += ' · ' + d.rate_label;
      var meta = '';
      if (i === 2 && d.fx_pending) {
        meta = 'Converting ' + fmt6(d.fx_pending_usdc6 || '0') + ' USDC — ';
        meta += d.fx_indicative_eur
          ? '≈ €' + d.fx_indicative_eur + ' at ECB reference rate — indicative, conversion pending'
          : 'conversion pending';
      }
      html += '<div class="step' + cls + '"><div class="rail"><span class="dot"></span><span class="line"></span></div>'
        + '<div class="body"><div class="name">' + escHtml(name) + '</div>'
        + (meta ? '<div class="meta tnum">' + escHtml(meta) + '</div>' : '') + '</div></div>';
    }
    document.getElementById('steps').innerHTML = html;

    var notes = '';
    if (d.overpaid_usdc6) {
      notes += '<div class="card"><i class="hdot"></i><p class="tnum">'
        + escHtml('Extra ' + fmt6(d.overpaid_usdc6) + ' USDC received — held safely, not allocated. If this was unintended, contact the issuer of this invoice.')
        + '</p></div>';
    }
    if (d.unexpected_payment) {
      notes += '<div class="card"><i class="hdot"></i><p>'
        + escHtml('A payment arrived after this invoice was completed — it is held safely and has not been allocated.')
        + '</p></div>';
    }
    document.getElementById('notes').innerHTML = notes;

    var links = (d.funding_txs || []).map(function (t, i) {
      var label = d.funding_txs.length > 1 ? 'Payment ' + (i + 1) + ' on ArcScan ↗' : 'Payment on ArcScan ↗';
      return '<a href="' + escHtml(t.explorer_url) + '" target="_blank" rel="noopener">' + label + '</a>';
    });
    document.getElementById('txLinks').innerHTML = links.join(' · ');

    return d.completed === true;
  }

  var final = render(window.__RECEIPT__.dto);
  if (!final) {
    var timer = setInterval(function () {
      fetch('/api/portal/' + token)
        .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
        .then(function (d) { if (render(d)) clearInterval(timer); })
        .catch(function () { /* keep last state; retry on next tick */ });
    }, 5000);
  }
})();
</script>`;
  return page('Receipt · affluents', CSS, body);
}

/**
 * One generic 404 for every failure mode — unknown, malformed, or null token
 * are indistinguishable by design (PORTAL_HANDOFF decision 4).
 */
export function receipt404Page(): string {
  const body = `<main class="page">
  <div class="col">
    <header class="lockup">
      ${glyphSvg(34, 17)}
      <span class="wordmark">affluents</span>
    </header>
    <section class="invoice">
      <p class="label">Receipt</p>
    </section>
    <p class="headline">This receipt link isn’t valid.</p>
    <p class="note">If someone sent it to you, ask them for a fresh link.</p>
    <div class="spring"></div>
    ${footerMark()}
  </div>
</main>`;
  return page('Receipt · affluents', CSS, body);
}
