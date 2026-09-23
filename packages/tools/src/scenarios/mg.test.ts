/**
 * `mg` (T-3.23): the scenario `pnpm sim-run --scenario mg` runs, run here in
 * full — every seed in `mg.json` — so `pnpm verify` holds the MG to the same
 * numbers the scenario reports: more suppression per second than the
 * rifleman by the data's multiple, fewer relocations, never a round undeployed.
 */
import { describe, expect, it } from 'vitest';
import { MG, type MgSummary, judgeMg, reportMg, runMg, summariseMg } from './mg.ts';

describe('mg (T-3.23)', () => {
  let summary: MgSummary;

  it(`meets every threshold over ${MG.seeds} seeds`, async () => {
    summary = await summariseMg();
    console.log(reportMg(summary));
    expect(summary.failures).toEqual([]);
    expect(summary.suppressionRatio).toBeGreaterThanOrEqual(MG.minSuppressionRatio);
    expect(summary.relocationRatio).toBeLessThanOrEqual(MG.maxRelocationRatio);
    expect(summary.mgSuppressorRate).toBeGreaterThanOrEqual(MG.minMgSuppressorRate);
    expect(summary.undeployedShots).toBe(0);
    // It fired in every one of its runs: the deploy rule gates it, it does not silence it.
    expect(Math.min(...summary.runs.filter((r) => r.archetype === 'mg').map((r) => r.shots))).toBeGreaterThan(0);
  }, 90_000);

  it('is a gate that bites: the same runs fail stricter thresholds, each by name', () => {
    const strict = judgeMg(summary.runs, { ...MG, minSuppressionRatio: 100, maxRelocationRatio: 0.01, minRiflemanRelocations: 10_000 });
    expect(strict.failures.some((f) => f.includes('suppressed'))).toBe(true);
    expect(strict.failures.some((f) => f.includes('relocated') && f.includes('ratio ceiling'))).toBe(true);
    expect(strict.failures.some((f) => f.includes('flank is not biting'))).toBe(true);
    // A single round fired undeployed fails it.
    const leaked = judgeMg(summary.runs.map((r, i) => (i === 0 ? { ...r, undeployedShots: 1 } : r)));
    expect(leaked.failures.some((f) => f.includes('within its deploy time'))).toBe(true);
    // As does an MG the group did not make its suppressor.
    const demoted = judgeMg(summary.runs.map((r) => (r.archetype === 'mg' ? { ...r, suppressorIsSubject: false } : r)));
    expect(demoted.failures.some((f) => f.includes("group's suppressor"))).toBe(true);
  });

  it('is reproducible: a seed run twice gives the same numbers', async () => {
    expect(await runMg(2, 'mg')).toEqual(await runMg(2, 'mg'));
  }, 30_000);
});
