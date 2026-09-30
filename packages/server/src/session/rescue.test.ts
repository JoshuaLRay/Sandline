/**
 * U-063: the `rescue` objective on a real session — a soldier holding E beside a prisoner for the hold frees
 * them; letting go, being too far or going down starts the hold over; with nobody held it is complete at once;
 * a failed mission leaves the prisoner held.
 */
import { describe, expect, it } from 'vitest';
import { ClientConnection, type MissionDef, createLoopbackPair, parseEncounter, requireWorld, spawnFor } from '@sandline/shared';
import { type CampaignState, newCampaignState } from '../persistence/CampaignDatabase.ts';
import { Session } from './Session.ts';

const TICK_MS = 1000 / 30;
const world = requireWorld('greybox-01');

const ENCOUNTER = parseEncounter({
  world: 'greybox-01',
  aliveCap: 10,
  probes: [0.3, 1.0, 1.7],
  areas: {},
  groups: [{ id: 'a', members: [{ archetype: 'rifleman', count: 1 }], zone: 'behind-objective', posture: { kind: 'garrison', at: 'objective' }, trigger: { kind: 'time', seconds: 9999 } }],
});

const MISSION: MissionDef = {
  id: 'test',
  world: 'greybox-01',
  respawn: false,
  objectives: [
    { type: 'rescue', label: 'Vance', holdSeconds: 5, reachM: 2 },
    { type: 'survive', label: 'the night', seconds: 600 },
  ],
};

const home = spawnFor(0);
const AT = { x: home.x + 1, y: home.y, z: home.z };

function play(campaign?: CampaignState, saves: CampaignState[] = []) {
  const session = new Session(undefined, '', world, { encounter: ENCOUNTER, mission: MISSION, testHumanCount: 1, onCampaignSave: (s) => saves.push(s), ...(campaign ? { campaign } : {}) });
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  const client = new ClientConnection(pair.b, {});
  client.join('lead');
  pair.settle();
  let now = 0;
  const human = () => session.slots.find((s) => !s.isBot)!;
  /** Tick with (or without) E held by the human, who stands where they are. */
  const step = (n: number, holdE: boolean) => {
    for (let i = 0; i < n; i++) {
      now += TICK_MS;
      if (i % 30 === 0) client.send({ kind: 'Ping', id: 1, clientTime: 0 });
      const h = human();
      h.interactHeld = holdE;
      h.staleTicks = 0;
      pair.settle();
      session.step(now);
      pair.settle();
    }
  };
  const stand = (x: number, z: number) => {
    const h = human();
    h.state = { ...h.state, x, z };
  };
  return { session, step, stand, human, client, pair, kill: (hp: { current: number; diedAt: number | null }) => Object.assign(hp, { current: 0, diedAt: now / 1000 }) };
}

function held(slot = 5): CampaignState {
  const saved = newCampaignState('greybox-01');
  saved.soldiers[slot] = { ...saved.soldiers[slot]!, captured: true, prisoner: { ...AT } };
  return saved;
}

describe('the rescue objective on a session (U-063)', () => {
  it('frees the prisoner after the hold, where they were held, with rank and XP kept, and moves on', () => {
    const saves: CampaignState[] = [];
    const m = play(held(), saves);
    m.step(2, false);
    expect(m.session.mission).toMatchObject({ objective: 0, type: 'rescue', state: 'progress' });
    m.stand(AT.x, AT.z);
    m.step(30, true);
    expect(m.session.mission).toMatchObject({ objective: 0, satisfied: true });
    expect(m.session.slots[5]!.captured).toBe(true);
    m.step(130, true);
    expect(m.session.mission).toMatchObject({ objective: 1, type: 'survive' });
    const freed = m.session.slots[5]!;
    expect(freed.captured).toBe(false);
    expect(freed.health.current).toBe(freed.health.max);
    expect([freed.state.x, freed.state.z]).toEqual([AT.x, AT.z]);
    expect(m.session.roster[5]).toMatchObject({ captured: false });
    // The checkpoint the objective earned keeps what they had (the objective's own XP is added) and no longer holds them prisoner.
    // Control: the same objective with nobody held earns the same rank and XP, so the rescue took none away.
    const control: CampaignState[] = [];
    play(undefined, control).step(2, false);
    expect(saves.at(-1)!.soldiers[5]).toMatchObject({ rank: control.at(-1)!.soldiers[5]!.rank, xp: control.at(-1)!.soldiers[5]!.xp });
    expect(saves.at(-1)!.soldiers[5]).not.toHaveProperty('captured');
  });

  it('starts over when E is let go, and when the soldier is out of reach', () => {
    const m = play(held());
    m.stand(AT.x, AT.z);
    m.step(120, true);
    expect(m.session.mission!.progress).toBeGreaterThan(100);
    m.step(1, false);
    expect(m.session.mission).toMatchObject({ progress: 0, satisfied: false });
    m.step(60, true);
    expect(m.session.mission!.progress).toBeGreaterThan(50);
    m.stand(AT.x + 15, AT.z);
    m.step(1, true);
    expect(m.session.mission).toMatchObject({ progress: 0, satisfied: false });
    m.step(200, true);
    expect(m.session.mission).toMatchObject({ objective: 0, progress: 0 });
    expect(m.session.slots[5]!.captured).toBe(true);
  });

  it('a soldier who goes down loses the hold', () => {
    const m = play(held());
    m.stand(AT.x, AT.z);
    m.step(90, true);
    m.human().health.downedAt = 1;
    m.step(1, true);
    expect(m.session.mission!.progress).toBe(0);
  });

  it('is complete at once with nobody held', () => {
    const m = play();
    m.step(2, false);
    expect(m.session.mission).toMatchObject({ objective: 1, type: 'survive' });
  });

  it('a failed mission leaves the prisoner held, through a retry', () => {
    const m = play(held());
    m.stand(AT.x, AT.z);
    m.step(60, true);
    m.kill(m.session.slots[3]!.health);
    m.step(2, true);
    expect(m.session.mission!.state).toBe('failed');
    m.session.retryMission();
    m.step(2, false);
    expect(m.session.slots[5]!.captured).toBe(true);
    expect(m.session.mission).toMatchObject({ state: 'progress', objective: 0, progress: 0 });
  });
});
