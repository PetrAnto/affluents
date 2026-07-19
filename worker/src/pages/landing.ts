import { footerMark, glyphSvg, page } from '../html';

// Ported from design/landing.html.
const CSS = `
.wrap{position:relative;min-height:100vh;display:flex;flex-direction:column;overflow:hidden}
.texture{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.content{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;flex:1 1 auto;padding:0 24px}
header{width:100%;max-width:1120px;display:flex;align-items:center;justify-content:space-between;padding:22px 0}
.lockup{display:flex;align-items:center;gap:9px}
.wordmark{font-family:var(--font-display);font-size:21px;font-weight:500;letter-spacing:.01em;line-height:1}
header nav a{font-size:13.5px;font-weight:500;text-decoration:none}
.hero{display:flex;flex-direction:column;align-items:center;text-align:center;padding-top:clamp(52px,9vw,104px)}
.hero h1{margin:0;font-family:var(--font-display);font-size:clamp(34px,6.6vw,60px);font-weight:500;line-height:1.1;letter-spacing:-.01em;max-width:15em;text-wrap:balance}
.hero p{margin:18px 0 0;font-size:16px;line-height:1.65;color:var(--muted);max-width:34em;text-wrap:pretty}
.cta{margin-top:30px;display:inline-block;border-radius:8px;background:var(--river);color:#fff;font-size:15px;font-weight:500;padding:14px 26px;text-decoration:none}
.cta:hover{background:var(--river-deep);color:#fff}
.diagram{width:100%;max-width:780px;margin-top:clamp(56px,9vw,100px);display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:clamp(12px,2.5vw,26px)}
.diagram .in{font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
.diagram .fig{position:relative}
.diagram svg{display:block;width:100%}
.diagram .brand{position:absolute;left:50%;top:54%;transform:translateX(-50%);font-family:var(--font-display);font-size:clamp(13px,2.2vw,17px);padding-top:6px}
.diagram .out{align-self:stretch;display:flex;flex-direction:column;justify-content:space-between;padding:2px 0}
.diagram .out span{font-size:13.5px;font-weight:600}
.o-spend{color:var(--river)} .o-reserve{color:var(--reserve)} .o-earn{color:var(--earn)}
.facts{width:100%;max-width:900px;margin-top:clamp(60px,10vw,108px);border-top:1px solid var(--contour);padding-top:22px;display:flex;flex-wrap:wrap;justify-content:center;gap:10px 36px}
.facts span{font-size:13px;color:var(--muted)}
.spring{flex:1 1 0}
.mark{padding:44px 0 26px;display:flex;flex-direction:column;align-items:center;gap:7px}
.mark svg{color:var(--contour)}
.mark span{font-size:11px;color:var(--muted);letter-spacing:.02em}`;

const TEXTURE = `<svg class="texture" aria-hidden="true" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" fill="none">
  <path d="M-20 90 C240 66, 470 108, 730 88 C980 70, 1210 96, 1460 78" stroke="#14232A" stroke-opacity="0.028" stroke-width="1"/>
  <path d="M-20 195 C260 172, 500 214, 760 196 C1010 180, 1230 208, 1460 188" stroke="#14232A" stroke-opacity="0.028" stroke-width="1"/>
  <path d="M-20 300 C230 282, 490 318, 740 300 C1000 284, 1220 312, 1460 296" stroke="#14232A" stroke-opacity="0.028" stroke-width="1"/>
  <path d="M-20 408 C250 388, 480 424, 745 406 C990 392, 1240 418, 1460 400" stroke="#14232A" stroke-opacity="0.028" stroke-width="1"/>
  <path d="M-20 515 C240 498, 500 530, 750 514 C1005 500, 1225 524, 1460 508" stroke="#14232A" stroke-opacity="0.028" stroke-width="1"/>
  <path d="M-20 622 C255 606, 490 636, 748 620 C1000 608, 1235 630, 1460 616" stroke="#14232A" stroke-opacity="0.028" stroke-width="1"/>
  <path d="M-20 728 C245 714, 495 740, 745 726 C1000 716, 1230 736, 1460 722" stroke="#14232A" stroke-opacity="0.028" stroke-width="1"/>
  <path d="M-20 834 C250 822, 490 846, 742 832 C1005 822, 1228 842, 1460 830" stroke="#14232A" stroke-opacity="0.028" stroke-width="1"/>
</svg>`;

export function landingPage(): string {
  const body = `<div class="wrap">
  ${TEXTURE}
  <div class="content">
    <header>
      <div class="lockup">
        ${glyphSvg(30, 15)}
        <span class="wordmark">affluents</span>
      </div>
      <nav><a href="/create">New invoice</a></nav>
    </header>
    <section class="hero">
      <h1>One payment in. Your money routes itself.</h1>
      <p>Share a payment link. When your client pays USDC on Arc, Affluents routes it by your rules — Spend, Reserve, Earn.</p>
      <a class="cta" href="/create">Create a payment link</a>
    </section>
    <section class="diagram" aria-label="How it works">
      <span class="in">Income</span>
      <div class="fig">
        <svg viewBox="0 0 96 24" fill="none" aria-label="Three income streams converge into one channel, then split into Spend, Reserve, and Earn">
          <g stroke="var(--ink)" stroke-width="1.5" stroke-linecap="round">
            <path d="M2 4 C22 4, 26 12, 36 12" vector-effect="non-scaling-stroke"/>
            <path d="M2 20 C22 20, 26 12, 36 12" vector-effect="non-scaling-stroke"/>
            <path d="M2 12 L94 12" vector-effect="non-scaling-stroke"/>
            <path d="M60 12 C70 12, 74 4, 94 4" vector-effect="non-scaling-stroke"/>
            <path d="M60 12 C70 12, 74 20, 94 20" vector-effect="non-scaling-stroke"/>
          </g>
        </svg>
        <span class="brand">affluents</span>
      </div>
      <div class="out">
        <span class="o-spend">Spend</span>
        <span class="o-reserve">Reserve</span>
        <span class="o-earn">Earn</span>
      </div>
    </section>
    <section class="facts">
      <span>Settles in under a second</span>
      <span>Fee ~$0.01, paid in the same USDC</span>
      <span>Every movement verifiable on ArcScan</span>
    </section>
    <div class="spring"></div>
    ${footerMark()}
  </div>
</div>`;
  return page('affluents — One payment in. Your money routes itself.', CSS, body);
}
