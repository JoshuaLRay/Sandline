import { defineConfig } from 'vitest/config';

/**
 * Non-V8 parity run (ADR-014).
 *
 * The server is Node (V8) and the most common client is Chrome (V8). A
 * transcendental-drift bug is therefore INVISIBLE to every V8-only test — it
 * surfaces only for Safari (JSC) and Firefox (SpiderMonkey) players, as
 * unreproducible rubber-banding affecting some users.
 *
 * So this config deliberately omits Chromium. Running these tests on Chromium
 * would feel like coverage while proving nothing this project does not already
 * know from Node.
 *
 * Requires `pnpm exec playwright install firefox webkit` first.
 */
export default defineConfig({
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
});
