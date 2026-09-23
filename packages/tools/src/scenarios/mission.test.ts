/**
 * `mission` (T-3.35): the scenario `pnpm sim-run --scenario mission` runs
 * over twenty seeds, and its CI job over three. Here, what a unit test can
 * hold without timing a machine: a seed played is reproducible, the judge
 * bites on each of its thresholds and names a failing seed, and a short run
 * reports every number the gate reads.
 */
import { describe, expect, it } from 'vitest';
import { MISSION_SCENARIO, type MissionRun, judgeMission, reportMission, runMission } from './mission.ts';

describe('mission (T-3.35)', () => {
  let runs: MissionRun[];

  it('plays a seed at each budget, reproducibly, and reports every number', async () => {
    runs = [await runMission(1, 1), await runMission(1, 6)];
    const again = await runMission(1, 1);
    expect(again).toEqual(runs[0]);
    const summary = judgeMission(runs, null);
    const report = reportMission(summary);
    console.log(report);
    for (const r of runs) {
      expect(['complete', 'failed', 'timeout']).toContain(r.outcome);
      expect(r.enemiesSpawned).toBeGreaterThan(0);
      expect(r.underFireTicks).toBeGreaterThan(0);
      expect(r.engagements).toBeGreaterThan(0);
    }
    // More humans, more enemies: the director's budget reached the mission.
    expect(runs[1]!.enemiesSpawned).toBeGreaterThan(runs[0]!.enemiesSpawned);
    expect(report).toMatch(/under fire in cover/);
    expect(report).toMatch(/suppression episodes per engagement/);
  }, 60_000);

  it('is a gate that bites, naming the seeds that did not complete', () => {
    const many = Array.from({ length: MISSION_SCENARIO.completionMinSeeds }, (_, i) => ({ ...runs[0]!, seed: i + 1, outcome: 'failed' as const }));
    const failed = judgeMission(many, null);
    expect(failed.failures.some((f) => f.includes('1-human budget completed 0%') && f.includes('1 (failed)'))).toBe(true);
    // Under the minimum seeds, completion is reported and not asserted.
    expect(judgeMission(many.slice(0, 3), null).failures.some((f) => f.includes('budget completed'))).toBe(false);
    const cold = judgeMission(runs.map((r) => ({ ...r, inCoverUnderFireTicks: 0 })), null);
    expect(cold.failures.some((f) => f.includes('in cover'))).toBe(true);
    const calm = judgeMission(runs.map((r) => ({ ...r, episodes: 0 })), null);
    expect(calm.failures.some((f) => f.includes('suppression episodes'))).toBe(true);
    const slow = judgeMission(runs, { enemies: 40, bots: 5, ticks: 1, aiUsPerTick: 9000, stepUsPerTick: 9500, aiShare: 0.27 });
    expect(slow.failures.some((f) => f.includes('AI took 27.0%'))).toBe(true);
  });
});
