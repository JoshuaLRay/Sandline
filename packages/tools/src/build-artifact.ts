/**
 * Bundles the client into ONE self-contained HTML file for publishing.
 *
 * The artifact sandbox permits external scripts only from a short CDN
 * allowlist, which our bundle is not on, so JS and CSS are inlined rather than
 * referenced. The host wraps the file in its own document skeleton, so this
 * page carries no <html>/<head>/<body> of its own.
 *
 * Styles are read from the same qa.css the dev server uses, so the published
 * build and the local build cannot drift apart.
 *
 * Run: pnpm build:artifact
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'packages/client/dist';
const assetDir = join(dist, 'assets');
const files = readdirSync(assetDir);
const jsFile = files.find((f) => f.endsWith('.js'));
if (!jsFile) throw new Error('no built JS found - run the client build first');

const js = readFileSync(join(assetDir, jsFile), 'utf8');
const bundledCss = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(assetDir, f), 'utf8')).join('\n');
const css = bundledCss || readFileSync('packages/client/src/ui/qa.css', 'utf8');

// </script> inside the bundle would close our tag early.
const safeJs = js.replace(/<\/script>/gi, '<\\/script>');

const html = `<title>SANDLINE Movement QA</title>
<style>
${css}
</style>

<div id="hud">
  <h1>Sandline <span>M1</span></h1>
  <div id="stats">booting...</div>
  <div id="keys">
    <b>WASD</b> move &middot; <b>Shift</b> sprint &middot; <b>Ctrl</b> crouch &middot;
    <b>Space</b> jump &middot; <b>R</b> reset &middot; <b>H</b> hide
  </div>
  <div id="gap">
    No collision yet &mdash; you will walk through scenery. Speed, jump and
    gravity are real; terrain is not implemented. Needs a keyboard.
  </div>
</div>

<script type="module">
${safeJs}
</script>
`;

writeFileSync(join(dist, 'artifact.html'), html);
console.log(
  `wrote ${dist}/artifact.html (${(html.length / 1024 / 1024).toFixed(2)} MB, js ${(js.length / 1024).toFixed(0)} KB, css ${(css.length / 1024).toFixed(1)} KB)`,
);
