import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          root: './packages/shared',
          environment: 'node',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'bot',
          root: './packages/bot',
          environment: 'node',
          include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'client',
          root: './packages/client',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          // Real-GPU tests run in a browser (vitest.browser.config.ts, `assets-browsers`).
          exclude: ['src/**/*.browser.test.ts'],
        },
      },
      {
        test: {
          name: 'tools',
          root: './packages/tools',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'server',
          root: './packages/server',
          environment: 'node',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
        },
      },
    ],
  },
});
