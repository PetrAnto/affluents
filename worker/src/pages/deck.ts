// worker/src/pages/deck.ts
// Checkpoint 2 presentation, served at /deck. Self-contained; screenshots
// load from the public repo. Slides are fixed 1920x1080 and scale to fit
// the viewport (works on judges' laptops and phones alike).

const SHOT = 'https://raw.githubusercontent.com/PetrAnto/affluents/main/design/screenshots';

export function deckPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Affluents — Checkpoint 2</title>
<link rel="icon" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{
    --mist:#F2F4F3; --ink:#14232A; --river:#23617A; --reserve:#B8893D;
    --earn:#35684F; --contour:#D9DFDD; --muted:#5A6A6E; --surface:#FFFFFF;
  }
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:#0e1518;padding:24px 0;}
  .stage{width:1920px;transform-origin:top center;margin:0 auto;}
  .slide{
    width:1920px;height:1080px;background:var(--mist);color:var(--ink);
    font-family:'Inter',system-ui,sans-serif;position:relative;
    padding:110px 140px;overflow:hidden;margin:0 0 24px;
  }
  .display{font-family:'EB Garamond',Georgia,serif;font-weight:500;}
  .label{
    font-size:22px;font-weight:600;letter-spacing:0.14em;
    text-transform:uppercase;color:var(--muted);
  }
  .hairline{border:none;border-top:1.5px solid var(--contour);}
  .footer{
    position:absolute;left:140px;right:140px;bottom:70px;
    display:flex;justify-content:space-between;align-items:center;
    font-size:22px;color:var(--muted);
  }
  .card{
    background:var(--surface);border:1.5px solid var(--contour);
    border-radius:8px;overflow:hidden;
  }
  .card img{display:block;width:100%;height:auto;}
</style>
</head>
<body>
<div class="stage" id="stage">

<!-- SLIDE 1 — TITLE -->
<section class="slide">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;">
    <span class="label">Checkpoint 2 · July 2026</span>
    <span class="label">Encode × Arc · DeFi Track</span>
  </div>
  <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:640px;">
    <svg viewBox="1 3 46 18" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:520px;height:auto;">
      <g stroke="#14232A" stroke-width="1.1" stroke-linecap="round">
        <path d="M2 4 C10 4, 12 12, 16 12"></path>
        <path d="M2 20 C10 20, 12 12, 16 12"></path>
        <path d="M2 12 L46 12"></path>
        <path d="M32 12 C36 12, 38 4, 46 4"></path>
        <path d="M32 12 C36 12, 38 20, 46 20"></path>
      </g>
    </svg>
    <div class="display" style="font-size:88px;margin-top:36px;">affluents</div>
    <div class="display" style="font-size:52px;margin-top:44px;">
      One payment in. Your money routes itself.
    </div>
    <div style="font-size:28px;color:var(--muted);margin-top:22px;">
      A programmable income router built on Arc
    </div>
  </div>
  <div class="footer">
    <span>affluents.money &nbsp;·&nbsp; github.com/PetrAnto/affluents</span>
    <span>Built solo by PetrAnto</span>
  </div>
</section>

<!-- SLIDE 2 — THE PROBLEM -->
<section class="slide">
  <span class="label">The problem</span>
  <div style="display:flex;gap:120px;margin-top:90px;align-items:flex-start;">
    <div class="display" style="font-size:76px;line-height:1.15;max-width:820px;">
      The payment arrives;<br>the work begins.
    </div>
    <div style="flex:1;font-size:30px;line-height:1.5;">
      <p style="padding:34px 0;border-top:1.5px solid var(--contour);">
        Freelancers paid by international clients receive money — then everything is manual.
      </p>
      <p style="padding:34px 0;border-top:1.5px solid var(--contour);">
        Convert currency. Set aside tax. Remember to save or invest.
      </p>
      <p style="padding:34px 0;border-top:1.5px solid var(--contour);border-bottom:1.5px solid var(--contour);">
        Good money habits fail at the moment of arrival.
      </p>
    </div>
  </div>
  <div class="footer"><span>affluents</span><span>02</span></div>
</section>

<!-- SLIDE 3 — THE PRODUCT -->
<section class="slide">
  <span class="label">The product</span>
  <div style="display:flex;gap:100px;margin-top:70px;align-items:center;">
    <div style="width:760px;">
      <div class="display" style="font-size:56px;line-height:1.2;">
        Share a payment link.<br>Your client pays USDC on Arc.<br>The payment routes itself.
      </div>
      <div style="margin-top:64px;font-size:30px;line-height:1.45;">
        <p style="padding:26px 0;border-top:1.5px solid var(--contour);">
          <strong style="color:var(--river);">Spend</strong>
          &nbsp;— auto-converted USDC → EURC
        </p>
        <p style="padding:26px 0;border-top:1.5px solid var(--contour);">
          <strong style="color:var(--reserve);">Reserve</strong>
          &nbsp;— USDC tax bucket
        </p>
        <p style="padding:26px 0;border-top:1.5px solid var(--contour);border-bottom:1.5px solid var(--contour);">
          <strong style="color:var(--earn);">Earn</strong>
          &nbsp;— on-chain vault position
        </p>
      </div>
      <p style="margin-top:44px;font-size:26px;color:var(--muted);">
        The invoice is the entry point — the routing is the product.
      </p>
    </div>
    <div class="card" style="flex:1;">
      <img src="${SHOT}/landing.png" alt="Affluents landing page">
    </div>
  </div>
  <div class="footer"><span>affluents</span><span>03</span></div>
</section>

<!-- SLIDE 4 — WORKING TODAY -->
<section class="slide">
  <span class="label">Working today on Arc testnet</span>
  <div class="display" style="font-size:56px;margin-top:50px;">
    Four invoices routed end-to-end. Not mocked, not local.
  </div>
  <div style="display:flex;gap:70px;margin-top:56px;align-items:center;">
    <div style="width:640px;font-size:28px;line-height:1.55;">
      <p style="color:var(--muted);">
        invoice → link + QR → MetaMask payment → on-chain verification → automatic routing
      </p>
      <hr class="hairline" style="margin:36px 0;">
      <p style="font-size:34px;">
        <strong>3.00 USDC</strong> routed as<br>
        <strong style="color:var(--river);">1.656 EURC</strong> Spend ·
        <strong style="color:var(--reserve);">0.75</strong> Reserve ·
        <strong style="color:var(--earn);">0.45</strong> Earn
      </p>
      <hr class="hairline" style="margin:36px 0;">
      <p style="color:var(--muted);">
        Conservation exact to the micro-dollar, verified against ledger and chain. Every movement linked to ArcScan.
      </p>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;gap:28px;">
      <div class="card"><img src="${SHOT}/dashboard.png" alt="Affluents dashboard"></div>
      <div class="card"><img src="${SHOT}/03-payment.png" alt="Affluents payment page"></div>
    </div>
  </div>
  <div class="footer"><span>affluents</span><span>04</span></div>
</section>

<!-- SLIDE 5 — ENGINEERING -->
<section class="slide">
  <span class="label">Arc-correct engineering</span>
  <div class="display" style="font-size:56px;margin-top:50px;">
    Money-handling rules, written down and tested.
  </div>
  <div style="display:flex;gap:110px;margin-top:64px;font-size:28px;line-height:1.5;">
    <div style="flex:1;">
      <p style="padding:28px 0;border-top:1.5px solid var(--contour);">
        Verifier branches by payment type: direct ERC-20, smart-account ERC-20, native.
      </p>
      <p style="padding:28px 0;border-top:1.5px solid var(--contour);">
        Arc's 18-decimal EIP-7708 system logs filtered by emitter — never miscounted as 6-decimal amounts.
      </p>
      <p style="padding:28px 0;border-top:1.5px solid var(--contour);border-bottom:1.5px solid var(--contour);">
        Documented 18→6 floor-and-dust rule at the native boundary.
      </p>
    </div>
    <div style="flex:1;">
      <p style="padding:28px 0;border-top:1.5px solid var(--contour);">
        Partial payments aggregate; overpayments are <strong style="color:var(--reserve);">held, never auto-routed</strong>.
      </p>
      <p style="padding:28px 0;border-top:1.5px solid var(--contour);">
        Intent-journaled, crash-safe pipeline — restarts reconcile, no double-spends.
      </p>
      <p style="padding:28px 0;border-top:1.5px solid var(--contour);border-bottom:1.5px solid var(--contour);">
        29 unit tests, plus a deposit-wallet concurrency test.
      </p>
    </div>
  </div>
  <div class="footer"><span>affluents</span><span>05</span></div>
</section>

<!-- SLIDE 6 — CIRCLE STACK -->
<section class="slide">
  <span class="label">Circle stack as core infrastructure</span>
  <div class="display" style="font-size:56px;margin-top:50px;">
    Not garnish — the wallet layer, the gas, the settlement.
  </div>
  <div style="margin-top:64px;font-size:30px;line-height:1.5;">
    <p style="padding:32px 0;border-top:1.5px solid var(--contour);">
      <strong>Arc</strong> — settlement layer · USDC-as-gas · sub-second deterministic finality
    </p>
    <p style="padding:32px 0;border-top:1.5px solid var(--contour);">
      <strong>Circle Developer-Controlled Wallets (SCA)</strong> — the entire wallet layer: deposit pool + treasury, spend, reserve roles
    </p>
    <p style="padding:32px 0;border-top:1.5px solid var(--contour);">
      <strong>Circle Gas Station</strong> — every sweep, transfer, and vault deposit sponsored; no wallet holds gas
    </p>
    <p style="padding:32px 0;border-top:1.5px solid var(--contour);border-bottom:1.5px solid var(--contour);">
      <strong>USDC + EURC</strong> — pay in USDC, hold Spend in EURC; multi-currency by default
    </p>
  </div>
  <div class="footer"><span>affluents</span><span>06</span></div>
</section>

<!-- SLIDE 7 — NEXT -->
<section class="slide">
  <span class="label">Next by final submission</span>
  <div style="display:flex;gap:120px;margin-top:70px;align-items:flex-start;">
    <div style="flex:1.2;font-size:30px;line-height:1.5;">
      <p style="padding:28px 0;border-top:1.5px solid var(--contour);">
        Arc App Kit live USDC→EURC FX quotes — replacing the labeled demo rate
      </p>
      <p style="padding:28px 0;border-top:1.5px solid var(--contour);">
        Read-only client portal
      </p>
      <p style="padding:28px 0;border-top:1.5px solid var(--contour);">
        Withdraw from Earn
      </p>
      <p style="padding:28px 0;border-top:1.5px solid var(--contour);">
        Dashboard upgrades: time ranges, by-client view
      </p>
      <p style="padding:28px 0;border-top:1.5px solid var(--contour);border-bottom:1.5px solid var(--contour);">
        3-minute demo video
      </p>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding-top:120px;">
      <svg viewBox="1 3 46 18" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:360px;height:auto;">
        <g stroke="#14232A" stroke-width="1.1" stroke-linecap="round">
          <path d="M2 4 C10 4, 12 12, 16 12"></path>
          <path d="M2 20 C10 20, 12 12, 16 12"></path>
          <path d="M2 12 L46 12"></path>
          <path d="M32 12 C36 12, 38 4, 46 4"></path>
          <path d="M32 12 C36 12, 38 20, 46 20"></path>
        </g>
      </svg>
      <div class="display" style="font-size:48px;margin-top:30px;">affluents.money</div>
      <div style="font-size:24px;color:var(--muted);margin-top:18px;">
        Final submission Aug 9 · Demo Day Aug 20
      </div>
    </div>
  </div>
  <div class="footer">
    <span>github.com/PetrAnto/affluents</span>
    <span>Built solo by PetrAnto</span>
  </div>
</section>

</div>
<script>
  // Scale the fixed 1920px stage to fit any viewport.
  function fit() {
    var s = Math.min(1, document.documentElement.clientWidth / 1920);
    var stage = document.getElementById('stage');
    stage.style.transform = 'scale(' + s + ')';
    document.body.style.height = (stage.getBoundingClientRect().height + 48) + 'px';
  }
  addEventListener('resize', fit);
  fit();
</script>
</body>
</html>`;
}
