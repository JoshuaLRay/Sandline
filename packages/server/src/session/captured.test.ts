/**
 * U-061: a captured character is out of play but not dead — the roster marks it, nobody can take the slot, the
 * mission goes on without them, a retry undoes captures made since its checkpoint, a restart goes back to the
 * prisoners the mission began with, and the campaign file keeps them (and loads without them for an older save).
 */
import { describe, expect, it } from 'vitest';
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

const TWO: MissionDef = {
  id: 'test',
  world: 'greybox-01',
  respawn: false,
  objectives: [
    { type: 'destroy', label: 'group a', group: 'a' },
    { type: 'survive', label: 'the night', seconds: 600 },
  ],
};
const ONE: MissionDef = { id: 'test', world: 'greybox-01', respawn: false, objectives: [{ type: 'destroy', label: 'group a', group: 'a' }] };

const AT = { x: 30, y: 0, z: 40 };
const AT2 = { x: -30, y: 0, z: 50 };

interface Internals {
  missionCheckpointState: { captured?: { slot: number }[] } | null;
  freeSlot(): { index: number } | null;
  wantedSlot(conn: { wantedSlot: number }): { index: number } | null;
}

function play(mission: MissionDef, extra: { campaign?: CampaignState; onCampaignSave?: (s: CampaignState) => void } = {}) {
  const session = new Session(undefined, '', world, { encounter: ENCOUNTER, mission, testHumanCount: 1, ...extra });
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
  const kill = (health: { current: number; diedAt: number | null }) => Object.assign(health, { current: 0, diedAt: now / 1000 });
  const beatA = () => {
    step(60);
    for (const e of session.enemies) kill(e.health);
    step(2);
  };
  const wipe = () => {
    for (const s of session.slots) kill(s.health);
    step(1);
  };
  return { session, x: session as unknown as Internals, client, pair, step, kill, beatA, wipe };
}

describe('a captured character (U-061)', () => {
  it('is out of play, marked on the roster, and not a death: the mission goes on', () => {
    const m = play(TWO);
    m.step(2);
    expect(m.session.captureCharacter(3, AT)).toBe(true);
    m.step(30);
    expect(m.session.roster[3]).toMatchObject({ captured: true });
    expect(m.session.roster.filter((r) => r.captured)).toHaveLength(1);
    expect(m.session.slots[3]!.health.current).toBe(0);
    expect([m.session.slots[3]!.state.x, m.session.slots[3]!.state.z]).toEqual([AT.x, AT.z]);
    expect(m.session.mission).toMatchObject({ state: 'progress', attempt: 1 });
    // A real death is still a failure.
    m.kill(m.session.slots[4]!.health);
    m.step(2);
    expect(m.session.mission!.state).toBe('failed');
  });

  it('cannot be taken again, nor a dead one taken', () => {
    const m = play(TWO);
    m.step(2);
    expect(m.session.captureCharacter(3, AT)).toBe(true);
    expect(m.session.captureCharacter(3, AT)).toBe(false);
    m.kill(m.session.slots[2]!.health);
    expect(m.session.captureCharacter(2, AT)).toBe(false);
    expect(m.session.captureCharacter(9, AT)).toBe(false);
  });

  it('is nobody to take: not by a join, not by a wanted slot, not by switching to it', () => {
    const m = play(TWO);
    m.step(2);
    m.session.captureCharacter(3, AT);
    m.step(1);
    // Every bot slot a newcomer could be given, and the one they ask for by name.
    for (let i = 0; i < 6; i++) expect(m.x.freeSlot()?.index).not.toBe(3);
    expect(m.x.wantedSlot({ wantedSlot: 3 })).toBeNull();
    expect(m.x.wantedSlot({ wantedSlot: 4 })?.index).toBe(4);
    // The squad leader cannot switch into it, and can into a free bot.
    const mine = m.session.slots.findIndex((s) => !s.isBot);
    m.client.send({ kind: 'SwitchCharacter', slot: 3, spectate: false });
    m.pair.settle();
    m.step(2);
    expect(m.session.slots.findIndex((s) => !s.isBot)).toBe(mine);
    // The control: a free bot can be switched into.
    m.client.send({ kind: 'SwitchCharacter', slot: 4, spectate: false });
    m.pair.settle();
    m.step(2);
    expect(m.session.slots.findIndex((s) => !s.isBot)).toBe(4);
  });

  it('is freed where it was held, whole, with its rank and XP untouched', () => {
    const saves: CampaignState[] = [];
    const m = play(TWO, { onCampaignSave: (s) => saves.push(s) });
    m.step(2);
    m.session.captureCharacter(3, AT);
    m.step(5);
    expect(m.session.freeCharacter(3)).toBe(true);
    expect(m.session.freeCharacter(3)).toBe(false);
    m.step(2);
    const slot = m.session.slots[3]!;
    expect(slot.captured).toBe(false);
    expect(slot.health.current).toBe(slot.health.max);
    expect([slot.state.x, slot.state.z]).toEqual([AT.x, AT.z]);
    expect(m.session.roster[3]).toMatchObject({ captured: false });
  });
});

describe('retry, restart and the campaign file (U-061)', () => {
  it('a retry undoes a capture made since the checkpoint, and keeps one the checkpoint had', () => {
    const m = play(TWO);
    m.step(2);
    m.session.captureCharacter(1, AT);
    m.beatA();
    expect(m.session.mission).toMatchObject({ objective: 1 });
    expect(m.x.missionCheckpointState?.captured?.map((c) => c.slot)).toEqual([1]);
    m.step(5);
    m.session.captureCharacter(2, AT2);
    m.step(5);
    // The rest of the squad falls; the retry goes back to the checkpoint.
    for (const i of [0, 3, 4, 5]) m.kill(m.session.slots[i]!.health);
    m.step(2);
    expect(m.session.mission!.state).toBe('failed');
    m.session.retryMission();
    m.step(2);
    expect(m.session.slots.map((s) => s.captured)).toEqual([false, true, false, false, false, false]);
    expect(m.session.slots[2]!.health.current).toBe(m.session.slots[2]!.health.max);
    expect(m.session.roster.map((r) => r.captured)).toEqual([false, true, false, false, false, false]);
  });

  it('a restart goes back to the prisoners the mission began with', () => {
    const saved = newCampaignState('greybox-01');
    saved.soldiers[5] = { ...saved.soldiers[5]!, captured: true, prisoner: { ...AT2 } };
    const m = play(TWO, { campaign: saved });
    m.step(2);
    expect(m.session.slots.map((s) => s.captured)).toEqual([false, false, false, false, false, true]);
    m.session.captureCharacter(2, AT);
    m.wipe();
    expect(m.session.mission!.state).toBe('failed');
    m.client.send({ kind: 'MissionRestart', full: true });
    m.pair.settle();
    m.step(2);
    expect(m.session.slots.map((s) => s.captured)).toEqual([false, false, false, false, false, true]);
    expect([m.session.slots[5]!.state.x, m.session.slots[5]!.state.z]).toEqual([AT2.x, AT2.z]);
  });

  it('completing the mission keeps the prisoners in the campaign file', () => {
    const saves: CampaignState[] = [];
    const m = play(ONE, { onCampaignSave: (s) => saves.push(s) });
    m.step(2);
    m.session.captureCharacter(4, AT);
    m.beatA();
    expect(m.session.mission!.state).toBe('complete');
    const last = saves.at(-1)!;
    expect(last.soldiers[4]).toMatchObject({ captured: true, prisoner: AT });
    expect(last.soldiers.filter((s) => s.captured)).toHaveLength(1);
  });

  it('a failed attempt does not save its captures', () => {
    const saves: CampaignState[] = [];
    const m = play(TWO, { onCampaignSave: (s) => saves.push(s) });
    m.step(2);
    m.session.captureCharacter(2, AT);
    m.wipe();
    expect(m.session.mission!.state).toBe('failed');
    expect(saves.at(-1)!.soldiers.some((s) => s.captured)).toBe(false);
  });

  it('a session built from the file starts with its prisoners out of play; an older save has none', () => {
    const saved = newCampaignState('greybox-01');
    saved.soldiers[2] = { ...saved.soldiers[2]!, captured: true, prisoner: { ...AT } };
    const resumed = play(TWO, { campaign: JSON.parse(JSON.stringify(saved)) as CampaignState });
    resumed.step(2);
    expect(resumed.session.roster[2]).toMatchObject({ captured: true });
    expect(resumed.session.mission).toMatchObject({ state: 'progress' });
    const old = play(TWO, { campaign: newCampaignState('greybox-01') });
    old.step(2);
    expect(old.session.roster.some((r) => r.captured)).toBe(false);
  });

  it('the database keeps captured soldiers, and refuses one held nowhere', () => {
    const db = new CampaignDatabase(':memory:');
    const made = db.createCampaign('owner', 'greybox-01');
    const state = newCampaignState('greybox-01');
    state.soldiers[1] = { ...state.soldiers[1]!, captured: true, prisoner: { ...AT } };
    db.saveCampaign(made.code, state);
    expect(db.loadCampaign(made.code)!.state.soldiers[1]).toMatchObject({ captured: true, prisoner: AT });
    expect(db.loadCampaign(made.code)!.state.soldiers[0]).not.toHaveProperty('captured');
    const bad = newCampaignState('greybox-01');
    bad.soldiers[1] = { ...bad.soldiers[1]!, captured: true, prisoner: null };
    expect(() => db.saveCampaign(made.code, bad)).toThrow(/no finite prisoner/);
    db.close();
  });
});
