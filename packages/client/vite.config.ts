import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/**
 * Build stamp, so a tester can tell at a glance whether the deployed site is
 * the build they are expecting.
 *
 * "Did my change actually deploy?" has come up more than once, and the answer
 * has so far been a trip to the Actions tab. The commit and the build time in
 * the corner of the HUD answer it from inside the page.
 *
 * The commit comes from git at BUILD time, not from a committed file: anything
 * written into the repo would be stale by exactly one commit, always, since it
 * cannot contain its own hash. Falls back gracefully — a stamp that fails a
 * build because git is unavailable would be a poor trade.
 */
function gitDescribe(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'local';
  }
}

const BUILD_SHA = gitDescribe();
/**
 * The host the lobby offers by default (T-1.5.06, T-1.5.07).
 *
 * Baked in at build time from SANDLINE_HOST so a playtester never types an
 * address: the published page points at the deployed host, a local build
 * points at nothing and the lobby says so. It is a `wss://` URL in production
 * because the page is https and a browser will not open `ws://` from it —
 * see docs/DEPLOYING.md.
 */
const DEFAULT_HOST = (process.env['SANDLINE_HOST'] ?? '').trim();
/** Minute precision: "is this newer than the last one I loaded" needs no more. */
const BUILD_TIME = new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z';

export default defineConfig({
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
    __DEFAULT_HOST__: JSON.stringify(DEFAULT_HOST),
  },
  /**
   * Relative asset URLs.
   *
   * GitHub Pages serves a project site from a subpath (/<repo>/), so absolute
   * "/assets/..." URLs 404 and the page renders blank. This was previously
   * passed as `--base=./` on the CI command line, which silently did not
   * survive forwarding through pnpm - the build looked fine and would have
   * deployed a white screen. Setting it here means it cannot be lost.
   *
   * Relative paths work for every host, including opening dist/index.html
   * straight off disk.
   */
  base: './',
  server: {
    // T-0.06: set these NOW, not later. Multithreaded WASM needs
    // crossOriginIsolated, and retrofitting these headers once assets and
    // third-party embeds exist is genuinely disruptive.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: { target: 'es2022' },
});
