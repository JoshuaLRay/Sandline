import { defineConfig } from 'vite';

export default defineConfig({
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
