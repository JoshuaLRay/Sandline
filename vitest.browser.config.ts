import { defineConfig } from 'vitest/config';

/**
 * Browser runs. Requires `pnpm exec playwright install chromium firefox webkit`
 * first.
 *
 * `parity-non-v8` — ADR-014. The server is Node (V8) and the most common
 * client is Chrome (V8). A transcendental-drift bug is therefore INVISIBLE to
 * every V8-only test — it surfaces only for Safari (JSC) and Firefox
 * (SpiderMonkey) players, as unreproducible rubber-banding affecting some
 * users. So this project deliberately omits Chromium: running it there would
 * feel like coverage while proving nothing this project does not already know
 * from Node.
 *
 * `nav-browsers` — T-3.01. A different question: not "do the engines agree to
 * the bit" but "does Recast's WASM initialise and answer at all" in every
 * runtime the in-page session (`LocalServer`) runs a real `Session` in. That
 * includes Chromium, because a page that cannot load the navmesh is broken
 * for its most common player whatever V8 on the host does.
 *
 * `assets-browsers` — T-4.05. The asset loader through three's real decoders
 * on a real WebGL2 context: the memory counters only move on a GPU. Chromium
 * only: its headless build draws with SwiftShader, which CI always has.
 *
 * CHROMIUM_PATH points Playwright at a Chromium it did not download itself,
 * for machines whose preinstalled browser is not the build this Playwright
 * pins.
 */
const chromiumPath = process.env.CHROMIUM_PATH;

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'parity-non-v8',
          root: './packages/shared',
          include: ['src/math/**/*.test.ts', 'test/harness/**/*.test.ts'],
          browser: {
            enabled: true,
            provider: 'playwright',
            headless: true,
            instances: [
              { browser: 'firefox' }, // SpiderMonkey
              { browser: 'webkit' },  // JavaScriptCore
            ],
          },
        },
      },
      {
        test: {
          name: 'nav-browsers',
          root: './packages/server',
          include: ['src/ai/nav/**/*.test.ts'],
          browser: {
            enabled: true,
            provider: 'playwright',
            headless: true,
            instances: [
              { browser: 'chromium', ...(chromiumPath ? { launch: { executablePath: chromiumPath } } : {}) },
              { browser: 'firefox' },
              { browser: 'webkit' },
            ],
          },
        },
      },
      {
        test: {
          name: 'assets-browsers',
          root: './packages/client',
          // T-4.26 adds the page's menus (`src/ui/**`): flows a real DOM and a real localStorage answer.
          include: ['src/assets/**/*.browser.test.ts', 'src/ui/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            provider: 'playwright',
            headless: true,
            instances: [{ browser: 'chromium', ...(chromiumPath ? { launch: { executablePath: chromiumPath } } : {}) }],
          },
        },
      },
    ],
  },
});
