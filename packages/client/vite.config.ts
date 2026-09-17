import { defineConfig } from 'vite';

export default defineConfig({
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
