/** Shared HTML fragments — ported from /design (which overrides BRAND.md where more specific). */

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const FONTS = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">`;

/** Design tokens shared by every page (design/tokens.css subset used by screens). */
export const BASE_CSS = `
:root{
  --mist:#F2F4F3; --ink:#14232A; --river:#23617A; --reserve:#B8893D; --earn:#35684F; --contour:#D9DFDD;
  --muted:#5A6A6E; --surface:#FFFFFF; --river-deep:#1C5066;
  --font-display:'EB Garamond',Georgia,serif; --font-body:'Inter',system-ui,-apple-system,sans-serif;
  --route-duration:600ms; --route-ease:cubic-bezier(.25,.6,.3,1);
}
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--mist);color:var(--ink);font-family:var(--font-body)}
a{color:var(--river)} a:hover{color:var(--ink)}
::selection{background:rgba(35,97,122,.16)}
.tnum{font-feature-settings:'tnum';font-variant-numeric:tabular-nums}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}`;

/** The confluence glyph (primary brand symbol). */
export function glyphSvg(width: number, height: number, stroke = 'var(--ink)'): string {
  return `<svg width="${width}" height="${height}" viewBox="0 0 48 24" fill="none" aria-hidden="true">
  <g stroke="${stroke}" stroke-width="1.4" stroke-linecap="round">
    <path d="M2 4 C10 4, 12 12, 16 12"/><path d="M2 20 C10 20, 12 12, 16 12"/><path d="M2 12 L46 12"/>
    <path d="M32 12 C36 12, 38 4, 46 4"/><path d="M32 12 C36 12, 38 20, 46 20"/>
  </g>
</svg>`;
}

export function footerMark(): string {
  return `<footer class="mark">
  ${glyphSvg(28, 14, 'currentColor')}
  <span>affluents.money</span>
</footer>`;
}

export const MARK_CSS = `
.spring{flex:1 1 0}
.mark{padding-top:36px;display:flex;flex-direction:column;align-items:center;gap:7px}
.mark svg{color:var(--contour)}
.mark span{font-size:11px;color:var(--muted);letter-spacing:.02em}`;

export function page(title: string, css: string, body: string, headExtra = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${FONTS}
<style>${BASE_CSS}${css}</style>
${headExtra}
</head>
<body>
${body}
</body>
</html>`;
}

/** Standalone favicon: the confluence glyph on transparent. */
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24" fill="none">
  <g stroke="#14232A" stroke-width="2.2" stroke-linecap="round">
    <path d="M2 4 C10 4, 12 12, 16 12"/><path d="M2 20 C10 20, 12 12, 16 12"/><path d="M2 12 L46 12"/>
    <path d="M32 12 C36 12, 38 4, 46 4"/><path d="M32 12 C36 12, 38 20, 46 20"/>
  </g>
</svg>`;
