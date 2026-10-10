/**
 * `rpg` (U-157): the scenario `pnpm sim-run --scenario rpg` runs, run here in
 * full — every seed in `rpg.json` — so `pnpm verify` holds the gunners to their
 * one hard rule (never a rocket with their own side in the blast) and the squad
 * bots to surviving and fighting them.
 */
import { describe, expect, it } from 'vitest';
import { RPG_SCENARIO, type RpgSummary, judgeRpg, reportRpg, runRpg, summariseRpg } from './rpg.ts';

describe('rpg (U-157)', () => {
  let summary: RpgSummary;

  it(`meets every threshold over ${RPG_SCENARIO.seeds} seeds`, async () => {
    summary = await summariseRpg();
    console.log(reportRpg(summary));
    expect(summary.failures).toEqual([]);
    expect(summary.rockets).toBeGreaterThan(0);
    expect(summary.unsafeBursts).toBe(0);
    for (const r of summary.runs) expect(r.friendlyHits).toBe(0);
  }, 120_000);

  it('is a gate that bites: an unsafe burst, a dead squad or no rockets fail it by name', () => {
    const unsafe = judgeRpg(summary.runs.map((r, i) => (i === 0 ? { ...r, unsafeBursts: 1 } : r)));
    expect(unsafe.failures.some((f) => f.includes('own side'))).toBe(true);
    const dead = judgeRpg(summary.runs.map((r) => ({ ...r, botsDead: 5 })));
    expect(dead.failures.some((f) => f.includes('bots died'))).toBe(true);
    const quiet = judgeRpg(summary.runs.map((r) => ({ ...r, rockets: 0 })));
    expect(quiet.failures.some((f) => f.includes('rockets were fired'))).toBe(true);
  });

  it('is reproducible: a seed run twice gives the same numbers', async () => {
    expect(await runRpg(3)).toEqual(await runRpg(3));
  }, 30_000);
});
