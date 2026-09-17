/**
 * Bundles the client into ONE self-contained HTML file for publishing.
 *
 * The artifact sandbox only permits external scripts from a short CDN
 * allowlist, and our bundle is not on it, so the JS must be inlined rather than
 * referenced. It also wraps the file in its own document skeleton, so this page
 * carries no <html>/<head>/<body> of its own.
 *
 * Run: pnpm build:artifact   (after `pnpm --filter @sandline/client build`)
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'packages/client/dist';
const assetDir = join(dist, 'assets');
const jsFile = readdirSync(assetDir).find((f) => f.endsWith('.js'));
if (!jsFile) throw new Error('no built JS found — run the client build first');

const js = readFileSync(join(assetDir, jsFile), 'utf8');
const kb = (js.length / 1024).toFixed(0);

// </script> inside the bundle would close our tag early.
const safeJs = js.replace(/<\/script>/gi, '<\\/script>');

const html = `<title>SANDLINE Tech Check</title>
<style>
  /* Single visual world on purpose: a sun-bleached desert readout. No theme
     swap — the page paints its own ground so it holds on any host theme. */
  :root {
    --sand-deep: #0f0c07;
    --sand-mid: #2a2113;
    --dust: #e8dcc8;
    --amber: #f0b429;
    --rule: rgba(232, 220, 200, 0.18);
  }
  html, body { height: 100%; }
  body {
    margin: 0;
    background: var(--sand-deep);
    color: var(--dust);
    overflow: hidden;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  canvas { display: block; touch-action: none; }
  #hud {
    position: fixed;
    top: 0; left: 0;
    margin: 12px;
    padding: 10px 12px;
    padding-top: calc(10px + env(safe-area-inset-top, 0px));
    max-width: min(320px, calc(100vw - 24px));
    background: rgba(15, 12, 7, 0.72);
    border: 1px solid var(--rule);
    border-radius: 3px;
    font-size: 11px;
    line-height: 1.6;
    letter-spacing: 0.02em;
    pointer-events: none;
    backdrop-filter: blur(6px);
  }
  #hud h1 {
    margin: 0 0 6px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }
  #hud h1 span { color: var(--amber); }
  #stats { white-space: pre-line; font-variant-numeric: tabular-nums; }
  #note {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--rule);
    opacity: 0.72;
    font-size: 10px;
  }
</style>

<div id="hud">
  <h1>Sandline <span>M0</span></h1>
  <div id="stats">booting…</div>
  <div id="note">
    Six squad slots, all bots — the squad is always six, humans just take slots.
    Drag to orbit, pinch or scroll to zoom. No player input yet; that lands with
    the netcode prototype.
  </div>
</div>

<script type="module">
${safeJs}
</script>
`;

writeFileSync('packages/client/dist/artifact.html', html);
console.log(`wrote packages/client/dist/artifact.html (${(html.length / 1024 / 1024).toFixed(2)} MB, bundle ${kb} KB)`);
