import { esc, footerMark, glyphSvg, MARK_CSS, page } from '../html';

// Ported from design/payment.html. The review-only state switcher from the
// reference is tooling, not product UI — here states are driven by the
// invoice status JSON (GET /api/invoices/:id, polled ~3s).
const CSS = `
.page{min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:clamp(30px,8vh,96px) 20px 24px}
.col{width:100%;max-width:430px;display:flex;flex-direction:column;flex:1 1 auto}
.lockup{display:flex;align-items:center;justify-content:center;gap:9px;padding-bottom:34px}
.lockup .wordmark{font-family:var(--font-display);font-size:23px;font-weight:500;letter-spacing:.01em;line-height:1}
.invoice{text-align:center;margin:0}
.invoice .label{margin:0;font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.invoice .amount{margin:14px 0 0;font-family:var(--font-display);font-weight:500;font-size:72px;line-height:1;letter-spacing:-.01em;font-feature-settings:normal}
.invoice .amount .cur{font-size:28px;font-weight:400;color:var(--muted);padding-left:10px}
.invoice .memo{margin:12px 0 0;font-size:13.5px;color:var(--muted)}
.glyph-wrap{display:flex;justify-content:center;padding:24px 0 26px}
body[data-state=overpaid] .glyph-wrap{visibility:hidden}
.flow{opacity:0}
body[data-state=verifying] .chan{opacity:1;animation:af-pulse 1.3s ease-in-out infinite}
body[data-state=paid] .flow{opacity:1;stroke-dasharray:100;stroke-dashoffset:100}
body.routed[data-state=paid] .chan{stroke-dashoffset:0;transition:stroke-dashoffset 180ms ease-out}
body.routed[data-state=paid] .branch{stroke-dashoffset:0;transition:stroke-dashoffset calc(var(--route-duration) - 180ms) var(--route-ease) 180ms}
body[data-state=partial] .streams{stroke-width:1.29}
@keyframes af-pulse{0%,100%{opacity:.25}50%{opacity:1}}
@keyframes af-scan{0%{transform:translateX(-110%)}100%{transform:translateX(340%)}}
.act{display:none}
body[data-state=awaiting] #act-awaiting{display:block}
body[data-state=verifying] #act-verifying{display:block}
body[data-state=partial] #act-partial{display:flex;flex-direction:column;gap:14px}
body[data-state=paid] #act-paid,body[data-state=overpaid] #act-paid{display:flex;flex-direction:column}
#extra-note{display:none}
body[data-state=overpaid] #extra-note{display:flex}
.manual{display:none}
body[data-state=awaiting] .manual,body[data-state=partial] .manual{display:block}
.btn{border:none;border-radius:8px;background:var(--river);color:#fff;font-family:var(--font-body);font-size:16px;font-weight:500;padding:16px 20px;cursor:pointer;width:100%}
.btn:hover{background:var(--river-deep)}
.btn:disabled{background:var(--contour);color:var(--muted);cursor:default}
.ghost{width:auto;border:1px solid var(--contour);border-radius:6px;background:var(--surface);color:var(--river);font-size:12px;font-weight:500;padding:5px 10px;cursor:pointer;font-family:var(--font-body)}
.ghost:hover{background:var(--surface);border-color:var(--river)}
.note{margin:12px 0 0;text-align:center;font-size:12.5px;color:var(--muted)}
.card{background:var(--surface);border:1px solid var(--contour);border-radius:8px;padding:16px}
.center{text-align:center}
.strong{font-size:15px;font-weight:500;margin:0}
.scan{margin:14px auto 0;max-width:220px;height:2px;background:var(--contour);border-radius:1px;overflow:hidden}
.scan i{display:block;height:100%;width:34%;background:var(--river);animation:af-scan 1.1s ease-in-out infinite}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.row .t{font-size:14px;font-weight:500}
.row .r{font-size:13.5px;font-weight:500;color:var(--muted)}
.bar{margin-top:12px;height:3px;background:var(--contour);border-radius:2px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--river);border-radius:2px}
.paidcard{padding:15px 20px;font-size:16px;font-weight:600}
.paidcard .ok{color:var(--earn)}
.rows{display:flex;flex-direction:column;gap:12px;padding:20px 0 8px}
.rrow{opacity:0;transform:translateY(5px)}
body.routed .rrow{opacity:1;transform:none;transition:opacity 360ms ease-out var(--d,140ms),transform 360ms ease-out var(--d,140ms)}
.rrow:nth-child(2){--d:230ms}
.rrow:nth-child(3){--d:320ms}
.bucket{height:74px;background:var(--surface);border:1px solid var(--contour);border-radius:8px;padding:0 16px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.bucket .l{display:flex;flex-direction:column;gap:3px}
.bucket .name{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600}
.dot{width:6px;height:6px;border-radius:50%;flex:none}
.dot.river{background:var(--river)} .dot.reserve{background:var(--reserve)} .dot.earn{background:var(--earn)}
.bucket .sub{font-size:11.5px;color:var(--muted)}
.bucket .v{display:flex;flex-direction:column;align-items:flex-end;gap:2px;text-align:right}
.bucket .amt{font-size:14px;font-weight:600}
.bucket .meta{font-size:11.5px;color:var(--muted)}
.bucket a{text-decoration:none}
.extra{margin-top:6px;padding:13px 16px;display:flex;align-items:flex-start;gap:10px}
.extra .dot{margin-top:5px}
.extra p{margin:0;font-size:13px;line-height:1.5}
.manual{padding-top:16px;text-align:center}
.manual summary{list-style:none;display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500;color:var(--river);cursor:pointer;padding:6px 10px}
.manual summary::-webkit-details-marker{display:none}
.manual summary:hover{color:var(--ink)}
.manual summary .chev{font-size:9px;line-height:1}
.manual[open] summary .chev{transform:rotate(180deg)}
.manual-body{padding-top:12px;display:flex;flex-direction:column;align-items:center;gap:12px}
.manual-body .qr{width:88px;height:88px;background:var(--surface);border:1px solid var(--contour);border-radius:6px;display:flex;align-items:center;justify-content:center}
.manual-body .qr svg{width:76px;height:76px;display:block}
.addr{display:flex;align-items:center;justify-content:center;gap:10px}
.addr code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.tiny{margin:0;font-size:11.5px;color:var(--muted)}
${MARK_CSS}
@media (prefers-reduced-motion:reduce){
  body[data-state=paid] .flow{stroke-dashoffset:0}
  body[data-state=paid] .rrow,body[data-state=overpaid] .rrow{opacity:1;transform:none}
  body[data-state=verifying] .chan{opacity:.7}
}`;

export interface PayPageData {
  id: string;
  displayNo: string;
  label: string;
  memo: string | null;
  amountFormatted: string;
  state: 'awaiting' | 'verifying' | 'partial' | 'paid' | 'overpaid';
  depositAddress: string | null;
  depositQrSvg: string | null;
  usdcAddress: string;
  chainIdHex: string;
  explorer: string;
}

export function payPage(d: PayPageData): string {
  const shortAddr = d.depositAddress
    ? `${d.depositAddress.slice(0, 10)}…${d.depositAddress.slice(-8)}`
    : '';
  const body = `<main class="page">
  <div class="col">
    <header class="lockup">
      ${glyphSvg(34, 17)}
      <span class="wordmark">affluents</span>
    </header>

    <section class="invoice">
      <p class="label">Invoice ${esc(d.displayNo)}${d.label ? ' · ' + esc(d.label) : ''}</p>
      <p class="amount tnum">${esc(d.amountFormatted)}<span class="cur">USDC</span></p>
      ${d.memo ? `<p class="memo">${esc(d.memo)}</p>` : ''}
    </section>

    <div class="glyph-wrap" aria-hidden="true">
      <svg width="150" height="75" viewBox="0 0 48 24" fill="none">
        <g stroke="var(--contour)" stroke-width="1.5" stroke-linecap="round">
          <path d="M16 12 L32 12" vector-effect="non-scaling-stroke"/><path d="M32 12 C36 12, 38 4, 46 4" vector-effect="non-scaling-stroke"/>
          <path d="M32 12 L46 12" vector-effect="non-scaling-stroke"/><path d="M32 12 C36 12, 38 20, 46 20" vector-effect="non-scaling-stroke"/>
        </g>
        <g class="streams" stroke="var(--ink)" stroke-width="1.5" stroke-linecap="round">
          <path d="M2 4 C10 4, 12 12, 16 12" vector-effect="non-scaling-stroke"/><path d="M2 12 L16 12" vector-effect="non-scaling-stroke"/><path d="M2 20 C10 20, 12 12, 16 12" vector-effect="non-scaling-stroke"/>
        </g>
        <path class="flow chan" d="M16 12 L32 12" stroke="var(--river)" stroke-width="1.5" stroke-linecap="round" pathLength="100" vector-effect="non-scaling-stroke"/>
        <path class="flow branch" d="M32 12 C36 12, 38 4, 46 4" stroke="var(--river)" stroke-width="1.5" stroke-linecap="round" pathLength="100" vector-effect="non-scaling-stroke"/>
        <path class="flow branch" d="M32 12 L46 12" stroke="var(--reserve)" stroke-width="1.5" stroke-linecap="round" pathLength="100" vector-effect="non-scaling-stroke"/>
        <path class="flow branch" d="M32 12 C36 12, 38 20, 46 20" stroke="var(--earn)" stroke-width="1.5" stroke-linecap="round" pathLength="100" vector-effect="non-scaling-stroke"/>
      </svg>
    </div>

    <section class="act" id="act-awaiting">
      <button class="btn" id="pay1">Pay ${esc(d.amountFormatted)} USDC</button>
      <p class="note">Arc · fee ~$0.01 paid in the same USDC · settles in under a second</p>
    </section>

    <section class="act" id="act-verifying">
      <div class="card center">
        <p class="strong">Verifying payment…</p>
        <div class="scan"><i></i></div>
      </div>
      <p class="note">Confirming on Arc · settles in under a second</p>
    </section>

    <section class="act" id="act-partial">
      <div class="card">
        <div class="row"><span class="t">Partial payment</span><span class="r tnum" id="partialLine"></span></div>
        <div class="bar"><i id="partialBar" style="width:0%"></i></div>
      </div>
      <div>
        <button class="btn" id="pay2">Pay remaining</button>
        <p class="note">Arc · fee ~$0.01 paid in the same USDC · settles in under a second</p>
      </div>
    </section>

    <section class="act" id="act-paid">
      <div class="card paidcard center">Paid <span class="ok">✓</span></div>
      <div class="rows" id="routedRows" style="display:none">
        <div class="rrow"><div class="bucket">
          <div class="l"><span class="name"><i class="dot river"></i>Spend</span><span class="sub">USDC → EURC</span></div>
          <div class="v"><span class="amt tnum" id="rSpendAmt"></span><span class="meta tnum" id="rSpendMeta"></span></div>
        </div></div>
        <div class="rrow"><div class="bucket">
          <div class="l"><span class="name"><i class="dot reserve"></i>Reserve</span><span class="sub">Tax reserve · USDC</span></div>
          <div class="v"><span class="amt tnum" id="rReserveAmt"></span><span class="meta" id="rReserveMeta"></span></div>
        </div></div>
        <div class="rrow"><div class="bucket">
          <div class="l"><span class="name"><i class="dot earn"></i>Earn</span><span class="sub">Demo Vault, on-chain position</span></div>
          <div class="v"><span class="amt tnum" id="rEarnAmt"></span><span class="meta" id="rEarnMeta"></span></div>
        </div></div>
      </div>
      <div class="card extra" id="extra-note">
        <i class="dot reserve"></i>
        <p class="tnum" id="extraText"></p>
      </div>
      <p class="note">Settled on Arc · fee ~$0.01 paid in the same USDC</p>
      <p class="note" id="payLinks"></p>
    </section>

    ${
      d.depositAddress
        ? `<details class="manual">
      <summary>Pay manually <span class="chev">▾</span></summary>
      <div class="manual-body">
        <div class="qr" aria-label="Deposit address QR code">${d.depositQrSvg ?? ''}</div>
        <div class="addr">
          <code>${esc(shortAddr)}</code>
          <button class="ghost" id="copyAddr">Copy</button>
        </div>
        <p class="tiny">Send USDC on Arc to this address only</p>
      </div>
    </details>`
        : ''
    }

    <div class="spring"></div>
    ${footerMark()}
  </div>
</main>

<script>
window.__INVOICE__ = ${JSON.stringify({
    id: d.id,
    state: d.state,
    depositAddress: d.depositAddress,
    usdcAddress: d.usdcAddress,
    chainIdHex: d.chainIdHex,
  })};
</script>
<script>
(function () {
  var cfg = window.__INVOICE__;
  var body = document.body;
  var current = null;
  var reportedTx = null;

  function setState(s) {
    if (s === current) return;
    current = s;
    body.classList.remove('routed');
    body.dataset.state = s;
    if (s === 'paid' || s === 'overpaid') {
      void body.offsetWidth; /* flush styles so the routing transition runs */
      body.classList.add('routed');
    }
  }

  function apply(j) {
    var s = j.state === 'paid' && j.extraHeld ? 'overpaid' : j.state;
    if (j.state === 'partial') {
      document.getElementById('partialLine').textContent = 'Received ' + j.receivedFormatted + ' of ' + j.amountFormatted + ' USDC';
      document.getElementById('partialBar').style.width = Math.min(100, j.receivedPct) + '%';
      document.getElementById('pay2').textContent = 'Pay remaining ' + j.remainingFormatted + ' USDC';
    }
    if (j.routing) {
      var rows = document.getElementById('routedRows');
      rows.style.display = '';
      document.getElementById('rSpendAmt').textContent = j.routing.spendOutFormatted + ' ' + j.routing.spendOutToken;
      document.getElementById('rSpendMeta').innerHTML = 'from ' + j.routing.spendInFormatted + ' USDC' + (j.routing.fxNote ? ' · ' + j.routing.fxNote : '') + (j.routing.spendTxUrl ? ' · <a href="' + j.routing.spendTxUrl + '" target="_blank" rel="noopener">ArcScan ↗</a>' : '');
      document.getElementById('rReserveAmt').textContent = j.routing.reserveFormatted + ' USDC';
      document.getElementById('rReserveMeta').innerHTML = j.routing.reserveTxUrl ? '<a href="' + j.routing.reserveTxUrl + '" target="_blank" rel="noopener">ArcScan ↗</a>' : '';
      document.getElementById('rEarnAmt').textContent = j.routing.earnFormatted + ' USDC';
      document.getElementById('rEarnMeta').innerHTML = j.routing.earnTxUrl ? '<a href="' + j.routing.earnTxUrl + '" target="_blank" rel="noopener">ArcScan ↗</a>' : '';
    }
    if (j.extraHeld) {
      document.getElementById('extraText').textContent = 'You sent ' + j.extraFormatted + ' USDC more than invoiced. The extra amount is held safely for the recipient.';
    }
    if (j.paymentTxs && j.paymentTxs.length) {
      var links = j.paymentTxs.map(function (t, i) {
        var label = j.paymentTxs.length > 1 ? 'Payment ' + (i + 1) + ' ↗' : 'Payment on ArcScan ↗';
        return '<a href="' + t.url + '" target="_blank" rel="noopener">' + label + '</a>';
      });
      document.getElementById('payLinks').innerHTML = links.join(' · ');
    }
    // A locally reported tx shows "verifying" until the server catches up.
    if (reportedTx && (s === 'awaiting' || s === 'partial')) s = 'verifying';
    setState(s);
  }

  function poll() {
    fetch('/api/invoices/' + cfg.id)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.state !== 'awaiting' && j.state !== 'partial') reportedTx = null;
        apply(j);
      })
      .catch(function () { /* keep last state; retry on next tick */ });
  }
  setInterval(poll, 3000);
  poll();

  // ---- wallet payment (EIP-1193): USDC.transfer(depositAddr, amountUsdc6) ----
  function pad32(hex) { return hex.replace(/^0x/, '').padStart(64, '0'); }
  function transferData(to, amount6) {
    return '0xa9059cbb' + pad32(to) + pad32(BigInt(amount6).toString(16));
  }
  function payAmount(amount6, btn) {
    var eth = window.ethereum;
    if (!eth) {
      var manual = document.querySelector('.manual');
      if (manual) manual.open = true;
      return;
    }
    var prev = btn.textContent;
    btn.disabled = true; btn.textContent = 'Confirm in your wallet…';
    var chain = { chainId: cfg.chainIdHex, chainName: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: ['https://rpc.testnet.arc.network'], blockExplorerUrls: ['https://testnet.arcscan.app'] };
    eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: cfg.chainIdHex }] })
      .catch(function (e) {
        if (e && (e.code === 4902 || e.code === -32603)) return eth.request({ method: 'wallet_addEthereumChain', params: [chain] });
        throw e;
      })
      .then(function () { return eth.request({ method: 'eth_requestAccounts' }); })
      .then(function (accounts) {
        return eth.request({ method: 'eth_sendTransaction', params: [{ from: accounts[0], to: cfg.usdcAddress, data: transferData(cfg.depositAddress, amount6) }] });
      })
      .then(function (txHash) {
        reportedTx = txHash;
        setState('verifying');
        // Best-effort with retries — the server-side balance watcher also
        // detects the payment even if this report never arrives.
        var report = function (attempt) {
          return fetch('/api/invoices/' + cfg.id + '/payment-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txHash: txHash }) })
            .catch(function () {
              if (attempt < 3) return new Promise(function (r) { setTimeout(r, 2000); }).then(function () { return report(attempt + 1); });
            });
        };
        return report(1);
      })
      .catch(function () { /* user rejected or wallet error — stay payable */ })
      .then(function () { btn.disabled = false; btn.textContent = prev; poll(); });
  }
  var pay1 = document.getElementById('pay1');
  var pay2 = document.getElementById('pay2');
  if (pay1) pay1.addEventListener('click', function () {
    fetch('/api/invoices/' + cfg.id).then(function (r) { return r.json(); }).then(function (j) { payAmount(j.amountUsdc6, pay1); });
  });
  if (pay2) pay2.addEventListener('click', function () {
    fetch('/api/invoices/' + cfg.id).then(function (r) { return r.json(); }).then(function (j) { payAmount(j.remainingUsdc6, pay2); });
  });

  var copyBtn = document.getElementById('copyAddr');
  if (copyBtn) copyBtn.addEventListener('click', function () {
    var b = this;
    try { navigator.clipboard.writeText(cfg.depositAddress); } catch (e) {}
    b.textContent = 'Copied ✓';
    setTimeout(function () { b.textContent = 'Copy'; }, 1800);
  });
})();
</script>`;
  return page(`Invoice ${d.displayNo} · affluents`, CSS, body).replace(
    '<body>',
    `<body data-state="${d.state}"${d.state === 'paid' || d.state === 'overpaid' ? ' class="routed"' : ''}>`,
  );
}
