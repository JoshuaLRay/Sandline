/**
 * U-089: a campaign run and a replay run keep SEPARATE prisoner pools. A character captured in one kind of run can be
 * rescued only in the next run of that kind; the other pool is carried through untouched. Only a campaign run moves
 * the campaign on (`completedMissions`). The save says which kind of run it is, so a host restarted mid-campaign
 * resumes on the right mission and kind; an older save, with neither field, is a campaign run with its prisoners.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClientConnection, type MissionDef, createLoopbackPair, parseEncounter, requireWorld } from '@sandline/shared';
import { CampaignDatabase, type CampaignState, newCampaignState } from '../persistence/CampaignDatabase.ts';
import { Session } from './Session.ts';

const TICK_MS = 1000 / 30;
const world = requireWorld('greybox-01');

const ENCOUNTER = parseEncounter({
  world: 'greybox-01',
  aliveCap: 10,
  probes: [0.3, 1.0, 1.7],
  areas: {},
  groups: [{ id: 'a', members: [{ archetype: 'rifleman', count: 2 }], zone: 'behind-objective', posture: { kind: 'garrison', at: 'objective' }, trigger: { kind: 'start' } }],
});
const ONE: MissionDef = { id: 'test', world: 'greybox-01', respawn: false, objectives: [{ type: 'destroy', label: 'group a', group: 'a' }] };

const CAMPAIGN_AT = { x: 30, y: 0, z: 40 };
const REPLAY_AT = { x: -30, y: 0, z: 50 };
const NEW_AT = { x: 10, y: 0, z: 60 };

/** A save with slot 3 in the campaign pool and slot 4 in the replay pool, of the given run kind. */
function saveOf(run?: 'replay'): CampaignState {
  const state = newCampaignState('greybox-01');
  state.soldiers[3] = { ...state.soldiers[3]!, captured: true, prisoner: { ...CAMPAIGN_AT } };
  state.replayPrisoners = [{ slot: 4, at: { ...REPLAY_AT } }];
  if (run) state.run = run;
  return state;
}

function play(campaign: CampaignState) {
  const saves: CampaignState[] = [];
  const session = new Session(undefined, '', world, { encounter: ENCOUNTER, mission: ONE, testHumanCount: 1, campaign, onCampaignSave: (s) => saves.push(s) });
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  const client = new ClientConnection(pair.b, {});
  client.join('lead');
  pair.settle();
  let now = 0;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      now += TICK_MS;
      if (i % 30 === 0) client.send({ kind: 'Ping', id: 1, clientTime: 0 });
      pair.settle();
      session.step(now);
      pair.settle();
    }
  };
  const win = () => {
    step(60);
    for (const e of session.enemies) Object.assign(e.health, { current: 0, diedAt: now / 1000 });
    step(2);
  };
  const held = () => session.slots.flatMap((s) => (s.captured ? [s.index] : []));
  return { session, saves, step, win, held };
}

describe('a campaign run (U-089)', () => {
  it('has the campaign pool in play and keeps the replay pool for the next replay', () => {
    const m = play(saveOf());
    m.step(2);
    expect(m.held()).toEqual([3]);
    m.win();
    expect(m.session.mission!.state).toBe('complete');
    const last = m.saves.at(-1)!;
    expect(last.completedMissions).toContain('test');
    expect(last.run).toBeUndefined();
    expect(last.soldiers[3]).toMatchObject({ captured: true, prisoner: CAMPAIGN_AT });
    expect(last.replayPrisoners).toEqual([{ slot: 4, at: REPLAY_AT }]);
  });

  it('puts a character captured in it in the campaign pool, not the replay one', () => {
    const m = play(newCampaignState('greybox-01'));
    m.step(2);
    expect(m.session.captureCharacter(2, NEW_AT)).toBe(true);
    m.win();
    const last = m.saves.at(-1)!;
    expect(last.soldiers[2]).toMatchObject({ captured: true, prisoner: NEW_AT });
    expect(last.replayPrisoners).toBeUndefined();
  });

  it('an older save, with neither field, is a campaign run with the prisoners it always had', () => {
    const old = newCampaignState('greybox-01');
    old.soldiers[1] = { ...old.soldiers[1]!, captured: true, prisoner: { ...CAMPAIGN_AT } };
    const m = play(old);
    m.step(2);
    expect(m.held()).toEqual([1]);
    m.win();
    expect(m.saves.at(-1)!.completedMissions).toContain('test');
  });
});

describe('a replay run (U-089)', () => {
  it('has the replay pool in play, not the campaign pool, and keeps the campaign pool for the next campaign run', () => {
    const m = play(saveOf('replay'));
    m.step(2);
    expect(m.held()).toEqual([4]);
    m.win();
    expect(m.session.mission!.state).toBe('complete');
    const last = m.saves.at(-1)!;
    expect(last.run).toBe('replay');
    expect(last.soldiers[3]).toMatchObject({ captured: true, prisoner: CAMPAIGN_AT });
    expect(last.soldiers[4]!.captured).toBeUndefined();
    expect(last.replayPrisoners).toEqual([{ slot: 4, at: REPLAY_AT }]);
  });

  it('does not move the campaign on', () => {
    const m = play(saveOf('replay'));
    m.step(2);
    m.win();
    expect(m.saves.at(-1)!.completedMissions).not.toContain('test');
  });

  it('puts a character captured in it in the replay pool, and leaves the soldier records free', () => {
    const state = newCampaignState('greybox-01');
    state.run = 'replay';
    const m = play(state);
    m.step(2);
    expect(m.session.captureCharacter(2, NEW_AT)).toBe(true);
    m.win();
    const last = m.saves.at(-1)!;
    expect(last.replayPrisoners).toEqual([{ slot: 2, at: NEW_AT }]);
    expect(last.soldiers.some((s) => s.captured)).toBe(false);
  });

  it('a rescued replay prisoner leaves the replay pool, not the campaign one', () => {
    const m = play(saveOf('replay'));
    m.step(2);
    expect(m.session.freeCharacter(4)).toBe(true);
    m.win();
    const last = m.saves.at(-1)!;
    expect(last.replayPrisoners).toBeUndefined();
    expect(last.soldiers[3]).toMatchObject({ captured: true });
  });
});

describe('the campaign file keeps the run kind and both pools (U-089)', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });
  const db = () => {
    const root = mkdtempSync(join(tmpdir(), 'sandline-runs-'));
    roots.push(root);
    return new CampaignDatabase(join(root, 'campaigns.sqlite'));
  };

  it('a host restarted mid-campaign resumes on the same mission and run kind, with both pools', () => {
    const first = db();
    const created = first.createCampaign('player-1', 'greybox-01');
    first.saveCampaign(created.code, saveOf('replay'));
    const loaded = first.loadCampaign(created.code)!;
    expect(loaded.state.world).toBe('greybox-01');
    expect(loaded.state.run).toBe('replay');
    expect(loaded.state.replayPrisoners).toEqual([{ slot: 4, at: REPLAY_AT }]);
    expect(loaded.state.soldiers[3]).toMatchObject({ captured: true, prisoner: CAMPAIGN_AT });
    // A session built from it is a replay run with the replay pool in play.
    const m = play(loaded.state);
    m.step(2);
    expect(m.held()).toEqual([4]);
    first.close();
  });

  it('writes nothing extra for a campaign run with an empty replay pool, and refuses a bad run kind or pool', () => {
    const d = db();
    const created = d.createCampaign('player-1', 'greybox-01');
    d.saveCampaign(created.code, newCampaignState('greybox-01'));
    const plain = d.loadCampaign(created.code)!.state;
    expect(plain.run).toBeUndefined();
    expect(plain.replayPrisoners).toBeUndefined();
    const bad = { ...newCampaignState('greybox-01'), run: 'speedrun' } as unknown as CampaignState;
    expect(() => d.saveCampaign(created.code, bad)).toThrow(/run/);
    const dup = newCampaignState('greybox-01');
    dup.replayPrisoners = [{ slot: 1, at: REPLAY_AT }, { slot: 1, at: REPLAY_AT }];
    expect(() => d.saveCampaign(created.code, dup)).toThrow(/distinct/);
    d.close();
  });
});
