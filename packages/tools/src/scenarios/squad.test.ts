/**
 * `squad` (T-3.26): the scenario `pnpm sim-run --scenario squad` runs, run
 * here in full — every seed in `squad.json` — so `pnpm verify` holds five
 * friendly bots to the same numbers: the riflemen killed, and not one round of
 * theirs in a squadmate.
 */
import { describe, expect, it } from 'vitest';
import { SQUAD_SCENARIO, type SquadSummary, judgeSquad, reportSquad, runSquad, summariseSquad } from './squad.ts';

describe('squad (T-3.26)', () => {
  let summary: SquadSummary;

  it(`meets every threshold over ${SQUAD_SCENARIO.seeds} seeds`, async () => {
    summary = await summariseSquad();
    console.log(reportSquad(summary));
    expect(summary.failures).toEqual([]);
    expect(summary.killShare).toBeGreaterThanOrEqual(SQUAD_SCENARIO.minKillShare);
    for (const r of summary.runs) expect(r.friendlyHits).toBe(0);
    // Bots revived bots somewhere in the runs: the revive path is part of the fight, not only its test.
    expect(summary.runs.reduce((a, r) => a + r.revivedByBot, 0)).toBeGreaterThan(0);
  }, 90_000);

  it('is a gate that bites: a friendly hit, or too few kills, fails it by name', () => {
    const hit = judgeSquad(summary.runs.map((r, i) => (i === 0 ? { ...r, friendlyHits: 1 } : r)));
    expect(hit.failures.some((f) => f.includes('friendly hits'))).toBe(true);
    const strict = judgeSquad(summary.runs, { ...SQUAD_SCENARIO, minKillShare: 1.01 });
    expect(strict.failures.some((f) => f.includes('killed'))).toBe(true);
  });

  it('is reproducible: a seed run twice gives the same numbers', async () => {
    expect(await runSquad(3)).toEqual(await runSquad(3));
  }, 30_000);
});
