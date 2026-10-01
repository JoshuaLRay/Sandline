/**
 * U-074 on a real `Session`: a stage of two destroy objectives done in either order, a checkpoint inside the stage
 * that a retry and the campaign file both keep, and the scoreboard counting objectives done.
 */
import { describe, expect, it } from 'vitest';
import { type MissionDef, parseEncounter, requireWorld } from '@sandline/shared';
import type { CampaignState } from '../persistence/CampaignDatabase.ts';
import { Session } from './Session.ts';

const TICK_MS = 1000 / 30;
const world = requireWorld('greybox-01');

const ENCOUNTER = parseEncounter({
  world: 'greybox-01',
  aliveCap: 10,
  probes: [0.3, 1.0, 1.7],
  areas: {},
  groups: [
    { id: 'a', members: [{ archetype: 'rifleman', count: 2 }], zone: 'behind-objective', posture: { kind: 'garrison', at: 'objective' }, trigger: { kind: 'start' } },
    { id: 'b', members: [{ archetype: 'rifleman', count: 2 }], zone: 'behind-objective', posture: { kind: 'garrison', at: 'objective' }, trigger: { kind: 'start' } },
  ],
});

/** Destroy a and destroy b, in either order, then hold out a long time. */
const MISSION: MissionDef = {
  id: 'staged',
  world: 'greybox-01',
  respawn: false,
  objectives: [
    { type: 'destroy', label: 'post a', group: 'a', stage: 0 },
    { type: 'destroy', label: 'post b', group: 'b', stage: 0 },
    { type: 'survive', label: 'the night', seconds: 600, stage: 1 },
  ],
};

function play(extra: { campaign?: CampaignState; onCampaignSave?: (s: CampaignState) => void } = {}) {
  const session = new Session(undefined, '', world, { encounter: ENCOUNTER, mission: MISSION, testHumanCount: 1, ...extra });
  let now = 0;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      now += TICK_MS;
      session.step(now);
      // Nothing here is about the squad's survival.
      for (const s of session.slots) if (s.health.diedAt === null) s.health.current = s.health.max;
    }
  };
  const kill = (group: string) => {
    for (const e of session.enemies) if (session.spawner!.spawnedBy(group).includes(e.netId)) Object.assign(e.health, { current: 0, diedAt: now / 1000 });
    step(2);
  };
  const wipe = () => {
    for (const s of session.slots) Object.assign(s.health, { current: 0, diedAt: now / 1000 });
    step(1);
  };
  const open = () => session.mission!.open?.map((o) => o.done);
  return { session, step, kill, wipe, open };
}

describe('a stage on a real session (U-074)', () => {
  it.each([['a', 'b'], ['b', 'a']])('finishes in either order: %s then %s', (first, second) => {
    const m = play();
    m.step(60);
    expect(m.session.mission).toMatchObject({ state: 'progress', objective: 0, objectives: 3 });
    expect(m.open()).toEqual([false, false]);
    m.kill(first);
    expect(m.open()).toEqual(first === 'a' ? [true, false] : [false, true]);
    expect(m.session.scoreboard.objectivesDone).toBe(1);
    m.kill(second);
    expect(m.session.mission).toMatchObject({ state: 'progress', objective: 2, type: 'survive' });
    expect(m.session.mission!.open).toBeUndefined();
    expect(m.session.scoreboard.objectivesDone).toBe(2);
  });

  it('a retry inside the stage keeps the objective that was done', () => {
    const m = play();
    m.step(60);
    m.kill('b');
    expect(m.open()).toEqual([false, true]);
    m.wipe();
    expect(m.session.mission!.state).toBe('failed');
    m.session.retryMission();
    m.step(5);
    expect(m.session.mission).toMatchObject({ state: 'progress', objective: 0, attempt: 2 });
    expect(m.open()).toEqual([false, true]);
    // Group b stays beaten; killing a finishes the stage.
    expect(m.session.spawner!.dead('b')).toBe(true);
    m.kill('a');
    expect(m.session.mission).toMatchObject({ objective: 2 });
  });

  it('is saved in the campaign file, and a session built from it resumes with the same objectives done', () => {
    const saves: CampaignState[] = [];
    const m = play({ onCampaignSave: (s) => saves.push(s) });
    m.step(60);
    m.kill('a');
    const state = saves.at(-1)!;
    expect(state.checkpoint).toMatchObject({ objective: 0, done: [0] });
    const resumed = play({ campaign: JSON.parse(JSON.stringify(state)) as CampaignState });
    resumed.step(5);
    expect(resumed.session.mission).toMatchObject({ state: 'progress', objective: 1 });
    expect(resumed.open()).toEqual([true, false]);
    resumed.kill('b');
    expect(resumed.session.mission).toMatchObject({ objective: 2 });
  });

  it('an older save with no done list still loads: the stage opens, and a destroyed group is found destroyed again', () => {
    const saves: CampaignState[] = [];
    const m = play({ onCampaignSave: (s) => saves.push(s) });
    m.step(60);
    m.kill('a');
    const old = JSON.parse(JSON.stringify(saves.at(-1)!)) as CampaignState;
    delete (old.checkpoint as { done?: unknown }).done;
    const resumed = play({ campaign: old });
    resumed.step(5);
    // `destroy` is a fact about the world (the spawner knows group a is beaten), so it is done again at once; the `done` list
    // matters for objectives the world cannot re-derive (a reach, a finished upload or rescue).
    expect(resumed.session.mission).toMatchObject({ state: 'progress', objective: 1 });
    expect(resumed.open()).toEqual([true, false]);
  });
});
