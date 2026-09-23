/**
 * `cover-duel` (T-3.20): the scenario `pnpm sim-run --scenario cover-duel`
 * runs, run here in full — every seed in `cover-duel.json` — so `pnpm verify`
 * holds the rifleman to the same numbers the scenario reports.
 */
import { describe, expect, it } from 'vitest';
import { COVER_DUEL, type DuelSummary, judge, report, summarise } from './coverDuel.ts';

describe('cover-duel (T-3.20)', () => {
  let summary: DuelSummary;

  it(`meets every threshold over ${COVER_DUEL.seeds} seeds`, async () => {
    summary = await summarise();
    console.log(report(summary));
    expect(summary.results).toHaveLength(COVER_DUEL.seeds);
    expect(summary.failures).toEqual([]);
    // What the thresholds stand for, said plainly.
    expect(summary.coverRate).toBeGreaterThanOrEqual(COVER_DUEL.minCoverRate);
    expect(summary.worstExposedIdle).toBeLessThanOrEqual(COVER_DUEL.maxExposedIdleFraction);
    expect(summary.reloadTicksExposed).toBe(0);
    expect(summary.flanked).toBe(COVER_DUEL.seeds);
    expect(summary.worstRelocateS).not.toBeNull();
    expect(summary.worstRelocateS!).toBeLessThanOrEqual(COVER_DUEL.maxRelocateSeconds);
    expect(Math.min(...summary.results.map((r) => r.shotsFired))).toBeGreaterThanOrEqual(COVER_DUEL.minShotsFired);
  });

  it('is a gate that bites: the same runs fail a stricter threshold, each by name', () => {
    const strict = judge(summary.results, {
      ...COVER_DUEL,
      maxSecondsToCover: 1,
      maxExposedIdleFraction: 0.001,
      maxRelocateSeconds: 0.01,
      minShotsFired: 1000,
    });
    expect(strict.failures.some((f) => f.includes('reached cover'))).toBe(true);
    expect(strict.failures.some((f) => f.includes('exposed while not firing'))).toBe(true);
    expect(strict.failures.some((f) => f.includes('relocated after the flank'))).toBe(true);
    expect(strict.failures.some((f) => f.includes('rounds'))).toBe(true);
    const dirty = judge([{ ...summary.results[0]!, reloadTicksExposed: 3 }, ...summary.results.slice(1)]);
    expect(dirty.failures.some((f) => f.includes('reloading exposed'))).toBe(true);
  });

  it('is reproducible: a seed run twice gives the same numbers', async () => {
    const { runCoverDuel } = await import('./coverDuel.ts');
    expect(await runCoverDuel(7)).toEqual(await runCoverDuel(7));
  });
});
