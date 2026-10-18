import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ci = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const testRunner = readFileSync(new URL('../../../scripts/run-vitest.mjs', import.meta.url), 'utf8');
const required = (name: string) => new RegExp(`^  ${name}:$`, 'm').test(ci);

describe('U-235 fail-closed CI performance partition', () => {
  it('preserves all four named gates and release dependencies', () => {
    for (const job of ['verify', 'streaming', 'parity-non-v8', 'mission']) expect(required(job), job).toBe(true);
    expect(ci).toContain('needs: [verify, streaming, parity-non-v8, mission]');
    expect(ci).toContain("github.ref == 'refs/heads/main'");
    expect(ci).toContain('git rev-parse FETCH_HEAD');
  });
  it('runs pnpm verify and every file shard with fail-closed aggregation', () => {
    expect(ci).toContain('run: pnpm verify');
    for (const shard of ['1/4', '2/4', '3/4', '4/4']) expect(ci).toContain(shard);
    expect(ci).toContain('needs: [verify-core, verify-extra]');
    expect(ci).toContain('CORE_RESULT:');
    expect(ci).toContain('EXTRA_RESULT:');
    expect(ci).toContain('if: always()');
    expect(testRunner).toContain('--shard=');
    expect(testRunner).toContain('process.argv.slice(2)');
  });
  it('preserves all budgets, five generation/capture proofs, and artifacts', () => {
    expect(ci).toContain('needs: [streaming-core, streaming-captures]');
    for (const name of ['insertion', 'road-supports', 'depot', 'outpost', 'replacement']) {
      expect(ci).toContain(`target: ${name}`);
    }
    for (const command of ['pnpm check:load-time', 'SANDLINE_LOAD_WORLD=qalat-road',
      'check-qalat-preview.ts', 'capture-map-review.ts', 'pnpm perf:frame',
      'pnpm gen:qalat-replacement --check', 'if-no-files-found: error',
      'pnpm test:parity-browsers', '--all-missions --seeds 3',
      '--scenario mission --seeds 20', 'qalat-road.json --seeds 20']) expect(ci).toContain(command);
  });
});
