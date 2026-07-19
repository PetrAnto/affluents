import { footerMark, glyphSvg, MARK_CSS, page } from '../html';

// Ported from design/create.html. The "success state" card from the reference
// replaces the form card after POST /api/invoices succeeds (client JS below).
const CSS = `
.page{min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:clamp(28px,7vh,80px) 20px 24px}
.col{width:100%;max-width:480px;display:flex;flex-direction:column;flex:1 1 auto}
.lockup{display:flex;align-items:center;gap:9px;padding-bottom:28px}
.lockup a{display:flex;align-items:center;gap:9px;text-decoration:none;color:var(--ink)}
.wordmark{font-family:var(--font-display);font-size:21px;font-weight:500;letter-spacing:.01em;line-height:1}
.card{background:var(--surface);border:1px solid var(--contour);border-radius:10px;padding:24px 22px}
.card h1{margin:0;font-family:var(--font-display);font-size:25px;font-weight:500;line-height:1}
.fields{display:flex;flex-direction:column;gap:16px;padding-top:20px}
.field{display:flex;flex-direction:column;gap:6px}
.field .fl{font-size:12px;color:var(--muted)}
.field .fl em{font-style:normal;opacity:.75}
.field input,.field textarea{width:100%;border:1px solid var(--contour);border-radius:6px;padding:10px 12px;font-family:var(--font-body);font-size:14px;color:var(--ink);background:var(--surface);outline:none}
.field input:focus,.field textarea:focus{border-color:var(--river)}
.field textarea{resize:none;line-height:1.5}
.amt-wrap{position:relative}
.amt-wrap input{padding-right:58px;text-align:right;font-size:15px;font-weight:500;font-feature-settings:'tnum'}
.amt-wrap .cur{position:absolute;right:12px;top:50%;transform:translateY(-50%);font-size:12.5px;color:var(--muted)}
.btn{width:100%;border:none;border-radius:7px;background:var(--river);color:#fff;font-family:var(--font-body);font-size:15px;font-weight:500;padding:13px 18px;cursor:pointer;margin-top:2px}
.btn:hover{background:var(--river-deep)}
.btn:disabled{background:var(--contour);color:var(--muted);cursor:default}
.err{margin:10px 0 0;font-size:13px;color:var(--reserve);display:none}
.created{display:none}
.created .ok{font-size:13px;font-weight:500;color:var(--earn)}
.created .summary{padding-top:8px;font-size:15px;font-weight:600}
.hr{height:1px;background:var(--contour);margin:18px 0 16px}
.linklabel{font-size:12px;color:var(--muted)}
.linkrow{display:flex;align-items:center;gap:8px;padding-top:8px}
.linkrow input{flex:1 1 auto;min-width:0;border:1px solid var(--contour);border-radius:6px;padding:9px 11px;font-family:var(--font-body);font-size:13px;color:var(--river);background:var(--surface);outline:none;font-feature-settings:'tnum'}
.ghost{flex:none;border:1px solid var(--contour);border-radius:6px;background:var(--surface);color:var(--river);font-family:var(--font-body);font-size:12.5px;font-weight:500;padding:9px 14px;cursor:pointer}
.ghost:hover{border-color:var(--river)}
.qrblock{display:flex;flex-direction:column;align-items:center;gap:12px;padding-top:20px}
.qrblock .qr{width:120px;height:120px;background:var(--surface);border:1px solid var(--contour);border-radius:6px;display:flex;align-items:center;justify-content:center}
.qrblock .qr svg{width:104px;height:104px;display:block}
.qrblock a{font-size:13px;font-weight:500;text-decoration:none}
${MARK_CSS}`;

export function createPage(): string {
  const body = `<main class="page">
  <div class="col">
    <header class="lockup">
      <a href="/">${glyphSvg(30, 15)}<span class="wordmark">affluents</span></a>
    </header>

    <div class="card" id="formCard">
      <h1>New invoice</h1>
      <div class="fields">
        <div class="field">
          <span class="fl">Amount</span>
          <span class="amt-wrap">
            <input id="fAmount" value="100.00" inputmode="decimal">
            <span class="cur">USDC</span>
          </span>
        </div>
        <div class="field">
          <span class="fl">Client label</span>
          <input id="fClient" placeholder="Client name">
        </div>
        <div class="field">
          <span class="fl">Memo <em>(optional)</em></span>
          <textarea id="fMemo" rows="2"></textarea>
        </div>
        <button class="btn" id="createBtn">Create invoice</button>
        <p class="err" id="err"></p>
      </div>
    </div>

    <div class="card created" id="createdCard">
      <div class="ok">Invoice created ✓</div>
      <div class="summary tnum" id="summaryLine"></div>
      <div class="hr"></div>
      <div class="linklabel">Payment link</div>
      <div class="linkrow">
        <input readonly id="linkField" onfocus="this.select()">
        <button class="ghost" id="copyLink">Copy</button>
      </div>
      <div class="qrblock">
        <div class="qr" id="qrBox" aria-label="Payment link QR code"></div>
        <a id="openLink" href="#">Open payment page ↗</a>
      </div>
    </div>

    <div class="spring"></div>
    ${footerMark()}
  </div>
</main>

<script>
(function () {
  var btn = document.getElementById('createBtn');
  var err = document.getElementById('err');
  function fail(msg) { err.textContent = msg; err.style.display = 'block'; btn.disabled = false; btn.textContent = 'Create invoice'; }
  btn.addEventListener('click', function () {
    err.style.display = 'none';
    btn.disabled = true; btn.textContent = 'Creating…';
    var payload = {
      amount: document.getElementById('fAmount').value,
      label: document.getElementById('fClient').value.trim(),
      memo: document.getElementById('fMemo').value.trim()
    };
    fetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) return fail(res.j.error || 'Could not create the invoice. Check the amount and try again.');
        var inv = res.j;
        document.getElementById('summaryLine').textContent = inv.displayNo + ' · ' + (inv.label || 'Client') + ' · ' + inv.amountFormatted + ' USDC';
        document.getElementById('linkField').value = inv.payUrl.replace(/^https?:\\/\\//, '');
        document.getElementById('openLink').href = inv.payUrl;
        fetch('/api/invoices/' + inv.id + '/qr').then(function (r) { return r.text(); }).then(function (svg) {
          document.getElementById('qrBox').innerHTML = svg;
        });
        document.getElementById('formCard').style.display = 'none';
        document.getElementById('createdCard').style.display = 'block';
      })
      .catch(function () { fail('Network error. Try again.'); });
  });
  document.getElementById('copyLink').addEventListener('click', function () {
    var b = this;
    try { navigator.clipboard.writeText('https://' + document.getElementById('linkField').value); } catch (e) {}
    b.textContent = 'Copied ✓';
    setTimeout(function () { b.textContent = 'Copy'; }, 1800);
  });
})();
</script>`;
  return page('New invoice · affluents', CSS, body);
}
