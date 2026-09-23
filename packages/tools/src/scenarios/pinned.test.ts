/**
 * `pinned` (T-3.21): the scenario `pnpm sim-run --scenario pinned` runs, run
 * here in full — every seed in `pinned.json` — so `pnpm verify` holds the
 * group to the same numbers the scenario reports.
 */
import { describe, expect, it } from 'vitest';
import { PINNED, type PinnedSummary, judgePinned, reportPinned, runPinned, summarisePinned } from './pinned.ts';

describe('pinned (T-3.21)', () => {
  let summary: PinnedSummary;

  it(`meets every threshold over ${PINNED.seeds} seeds`, async () => {
    summary = await summarisePinned();
    console.log(reportPinned(summary));
    expect(summary.failures).toEqual([]);
    expect(summary.results.every((r) => r.pinnedAfterS !== null)).toBe(true);
    expect(summary.worstSuppressedShare).toBeGreaterThanOrEqual(PINNED.minSuppressedShare);
    expect(summary.flankRate).toBeGreaterThanOrEqual(PINNED.minFlankRate);
    expect(summary.meanWalkExposure).toBeLessThanOrEqual(summary.meanDirectExposure * PINNED.maxExposureRatio);
    // The suppressor fired at the pinned soldier in every run.
    expect(Math.min(...summary.results.map((r) => r.suppressingRounds))).toBeGreaterThan(0);
    // Every seed, headless: seconds, not milliseconds, when the suite runs beside it.
  }, 60_000);

  it('is a gate that bites: the same runs fail stricter thresholds, each by name', () => {
    const strict = judgePinned(summary.results, { ...PINNED, minSuppressedShare: 0.99, minFlankRate: 1.01, maxExposureRatio: 0.1 });
    expect(strict.failures.some((f) => f.includes('suppression at or above'))).toBe(true);
    expect(strict.failures.some((f) => f.includes('flanker reached'))).toBe(true);
    expect(strict.failures.some((f) => f.includes('flank walk was seen'))).toBe(true);
    const unpinned = judgePinned([{ ...summary.results[0]!, pinnedAfterS: null }, ...summary.results.slice(1)]);
    expect(unpinned.failures.some((f) => f.includes('never handed out a flank'))).toBe(true);
  });

  it('is reproducible: a seed run twice gives the same numbers', async () => {
    expect(await runPinned(3)).toEqual(await runPinned(3));
  });
});
