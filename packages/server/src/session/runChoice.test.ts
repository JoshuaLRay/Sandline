/**
 * U-090: after a mission, complete or failed, the room's HOST chooses what is played next. The offer goes to everyone
 * (and to anyone who joins later); only the host's choice counts; only what was offered counts (never a mission beyond
 * the newest); choosing the mission just failed as the same kind of run is the existing retry; anything else writes the
 * new world and run kind into the campaign file, tells the room (`Handoff`) and retires it.
 */
import { describe, expect, it } from 'vitest';
import { ClientConnection, type Message, decodeMessage, type MissionDef, createLoopbackPair, parseCampaign, parseEncounter, requireWorld } from '@sandline/shared';
import { type CampaignState, newCampaignState } from '../persistence/CampaignDatabase.ts';
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
const ONE: MissionDef = { id: 'one', world: 'greybox-01', respawn: false, objectives: [{ type: 'destroy', label: 'group a', group: 'a' }] };
const entry = (mission: string) => ({ mission, title: `Title ${mission}`, briefing: [`Brief ${mission}`], debrief: [`Debrief ${mission}`] });
const THREE = parseCampaign({ id: 't', missions: [entry('one'), entry('two'), entry('three')] }, () => true);

const ZERO_FIRST = parseCampaign({ id: 'z', missions: [entry('zero'), entry('one'), entry('two')] }, () => true);

function room(campaign: CampaignState = newCampaignState('greybox-01'), durable = true, def = THREE) {
  const saves: CampaignState[] = [];
  let handoffCount = 0;
  const session = new Session(undefined, '', world, {
    encounter: ENCOUNTER,
    mission: ONE,
    testHumanCount: 2,
    campaign,
    campaignDef: def,
    ...(durable ? { onCampaignSave: (s: CampaignState) => saves.push(s) } : {}),
    onHandoff: () => (handoffCount += 1),
  });
  const people: { client: ClientConnection; pair: ReturnType<typeof createLoopbackPair>; heard: Message[] }[] = [];
  const join = (name: string) => {
    const pair = createLoopbackPair();
    session.addConnection(pair.a, people.length);
    const heard: Message[] = [];
    const client = new ClientConnection(pair.b, {
      onRunOffer: (m) => heard.push(m),
      onHandoff: (m) => heard.push(m),
    });
    client.join(name);
    pair.settle();
    people.push({ client, pair, heard });
    return people.length - 1;
  };
  let now = 0;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      now += TICK_MS;
      if (i % 30 === 0) for (const p of people) p.client.send({ kind: 'Ping', id: 1, clientTime: 0 });
      for (const p of people) p.pair.settle();
      session.step(now);
      for (const p of people) p.pair.settle();
    }
  };
  const win = () => {
    step(60);
    for (const e of session.enemies) Object.assign(e.health, { current: 0, diedAt: now / 1000 });
    step(2);
  };
  const lose = () => {
    for (const s of session.slots) Object.assign(s.health, { current: 0, diedAt: now / 1000 });
    step(2);
  };
  const choose = (who: number, run: 'campaign' | 'replay', mission: string) => {
    people[who]!.client.send({ kind: 'RoomCommand', command: 'choose', run, mission });
    for (const p of people) p.pair.settle();
    step(2);
  };
  /** What the host sent this person, decoded: the loopback drops a closed peer's inbox, a real socket flushes before it closes. */
  const sent = (who: number): Message[] => people[who]!.pair.a.sent.map((d) => decodeMessage(d.data));
  const handoffs = (who: number) => sent(who).filter((x): x is Extract<Message, { kind: 'Handoff' }> => x.kind === 'Handoff');
  /** Every offer a person heard, the in-mission ones (U-078, `progress`) included. */
  const allOffers = (who: number) => people[who]!.heard.filter((m): m is Extract<Message, { kind: 'RunOffer' }> => m.kind === 'RunOffer');
  /** The offers after a mission ended (U-090). */
  const offers = (who: number) => allOffers(who).filter((m) => m.result !== 'progress');
  return { session, saves, handoffCount: () => handoffCount, sentHandoffs: handoffs, join, step, win, lose, choose, offers, allOffers, people };
}

describe('the offer after a mission (U-090)', () => {
  it('goes to everyone when the mission is won: the newest mission as a campaign run, the beaten ones to replay', () => {
    const m = room();
    m.join('host');
    m.join('other');
    m.step(2);
    expect(m.offers(0)).toHaveLength(0);
    // U-078: while it is on, the host already has the way out the in-mission menu shows.
    expect(m.allOffers(0)).toEqual([{ kind: 'RunOffer', mission: 'one', result: 'progress', host: 0, campaign: 'one', replay: [] }]);
    m.win();
    expect(m.session.mission!.state).toBe('complete');
    for (const who of [0, 1]) {
      expect(m.offers(who)).toEqual([{ kind: 'RunOffer', mission: 'one', result: 'complete', host: 0, campaign: 'two', replay: ['one'] }]);
    }
  });

  it('after a failure the newest mission is still the same one: a retry, never skipping ahead', () => {
    const m = room();
    m.join('host');
    m.step(2);
    m.lose();
    expect(m.session.mission!.state).toBe('failed');
    expect(m.offers(0)).toEqual([{ kind: 'RunOffer', mission: 'one', result: 'failed', host: 0, campaign: 'one', replay: [] }]);
  });

  it('reaches someone who joins after the mission has ended', () => {
    const m = room();
    m.join('host');
    m.step(2);
    m.win();
    const late = m.join('late');
    m.step(2);
    expect(m.offers(late)).toHaveLength(1);
    expect(m.offers(late)[0]).toMatchObject({ result: 'complete', campaign: 'two' });
  });

  it('is not made in a room with no campaign file to move through', () => {
    const m = room(undefined, false);
    m.join('host');
    m.step(2);
    m.win();
    expect(m.offers(0)).toHaveLength(0);
  });

  it('is made again to the new host when the host leaves', () => {
    const m = room();
    m.join('host');
    m.join('second');
    m.step(2);
    m.win();
    expect(m.offers(1)[0]).toMatchObject({ host: 0 });
    // The host's seat is released as their connection closes.
    (m.session as unknown as { releaseSlot(c: unknown, r?: string): void }).releaseSlot(m.session.slots[0]!.connection, 'left');
    m.step(2);
    expect(m.offers(1).at(-1)).toMatchObject({ host: 1 });
  });
});

describe('the host chooses (U-090)', () => {
  it('a campaign run of the next mission writes it into the file, tells the room and retires it', () => {
    const m = room();
    m.join('host');
    m.join('other');
    m.step(2);
    m.win();
    m.choose(0, 'campaign', 'two');
    const save = m.saves.at(-1)!;
    expect(save.world).toBe('two');
    expect(save.completedMissions).toEqual(['one']);
    expect(save.checkpoint).toBeNull();
    expect(save.run).toBeUndefined();
    expect(m.handoffCount()).toBe(1);
    for (const who of [0, 1]) expect(m.sentHandoffs(who)).toEqual([{ kind: 'Handoff', mission: 'two', run: 'campaign' }]);
  });

  it('a replay run of a beaten mission writes the kind into the file and leaves the campaign where it was', () => {
    const m = room();
    m.join('host');
    m.step(2);
    m.win();
    m.choose(0, 'replay', 'one');
    const save = m.saves.at(-1)!;
    expect(save).toMatchObject({ world: 'one', run: 'replay', completedMissions: ['one'] });
    expect(m.sentHandoffs(0)).toEqual([{ kind: 'Handoff', mission: 'one', run: 'replay' }]);
  });

  it('only the host: another player’s choice is ignored', () => {
    const m = room();
    m.join('host');
    m.join('other');
    m.step(2);
    m.win();
    const before = m.saves.length;
    m.choose(1, 'campaign', 'two');
    expect(m.saves).toHaveLength(before);
    expect(m.handoffCount()).toBe(0);
    expect(m.sentHandoffs(1)).toHaveLength(0);
  });

  it('only what was offered: not a mission beyond the newest, not a replay of one not beaten, not while the mission is on', () => {
    const m = room();
    m.join('host');
    m.step(2);
    m.choose(0, 'campaign', 'two');
    expect(m.handoffCount()).toBe(0);
    m.win();
    const before = m.saves.length;
    m.choose(0, 'campaign', 'three');
    m.choose(0, 'replay', 'two');
    m.choose(0, 'replay', 'zzz');
    m.choose(0, 'campaign', 'one');
    expect(m.saves).toHaveLength(before);
    expect(m.handoffCount()).toBe(0);
  });

  it('retrying the mission just failed is the existing retry, with no handoff', () => {
    const m = room();
    m.join('host');
    m.step(2);
    m.lose();
    expect(m.session.mission!.state).toBe('failed');
    m.choose(0, 'campaign', 'one');
    expect(m.session.mission!.state).toBe('progress');
    expect(m.handoffCount()).toBe(0);
  });

  it('after a failure a replay of a beaten mission is a handoff', () => {
    const done = newCampaignState('greybox-01');
    done.completedMissions = ['one'];
    const m = room(done);
    m.join('host');
    m.step(2);
    m.lose();
    expect(m.offers(0)[0]).toMatchObject({ result: 'failed', campaign: 'two', replay: ['one'] });
    m.choose(0, 'replay', 'one');
    expect(m.saves.at(-1)).toMatchObject({ world: 'one', run: 'replay' });
    expect(m.handoffCount()).toBe(1);
  });
});

describe('the in-mission menu (U-078)', () => {
  const restart = (m: ReturnType<typeof room>, who: number, full: boolean) => {
    m.people[who]!.client.send({ kind: 'MissionRestart', ...(full ? { full: true } : {}) });
    for (const p of m.people) p.pair.settle();
    m.step(2);
  };

  it('lets the host go back to the last checkpoint, or to the start, while the mission is on', () => {
    const m = room();
    m.join('host');
    m.step(2);
    expect(m.session.mission!.attempt).toBe(1);
    restart(m, 0, false);
    expect(m.session.mission).toMatchObject({ state: 'progress', attempt: 2 });
    restart(m, 0, true);
    expect(m.session.mission).toMatchObject({ state: 'progress', attempt: 3, objective: 0 });
  });

  it('refuses anyone else mid-mission', () => {
    const m = room();
    m.join('host');
    m.join('other');
    m.step(2);
    restart(m, 1, false);
    restart(m, 1, true);
    expect(m.session.mission!.attempt).toBe(1);
  });

  it('refuses a mid-mission restart in a room with no campaign file', () => {
    const m = room(undefined, false);
    m.join('host');
    m.step(2);
    restart(m, 0, false);
    expect(m.session.mission!.attempt).toBe(1);
  });

  it('lets the host leave for another mission while it is on, keeping the checkpoint and marking nothing complete', () => {
    const done = newCampaignState('greybox-01');
    done.completedMissions = ['zero'];
    const m = room(done, true, ZERO_FIRST);
    m.join('host');
    m.step(2);
    m.choose(0, 'replay', 'zero');
    const save = m.saves.at(-1)!;
    expect(save).toMatchObject({ world: 'zero', run: 'replay', completedMissions: ['zero'] });
    expect(save.completedMissions).not.toContain('one');
    expect(m.sentHandoffs(0)).toEqual([{ kind: 'Handoff', mission: 'zero', run: 'replay' }]);
  });

  it('is not a handoff to pick the mission already on, as the same kind of run', () => {
    const m = room();
    m.join('host');
    m.step(2);
    m.choose(0, 'campaign', 'one');
    expect(m.handoffCount()).toBe(0);
    expect(m.session.mission!.attempt).toBe(1);
  });

  it('resumes a checkpoint only in the kind of run it was made in, and carries another kind’s through untouched', () => {
    const state = newCampaignState('greybox-01');
    state.world = 'one';
    state.checkpoint = { mission: 'one', run: 'replay', objective: 0, elapsedTicks: 50, spawns: Array.from({ length: 6 }, () => ({ x: 0, y: 0, z: 0 })), completedGroups: [], event: null };
    const saves: CampaignState[] = [];
    const session = new Session(undefined, '', world, { encounter: ENCOUNTER, mission: ONE, testHumanCount: 1, campaign: state, campaignDef: THREE, onCampaignSave: (s) => saves.push(s) });
    // A campaign run of 'one': the replay's checkpoint is not its own; the file still has it.
    expect(session.mission!.attempt).toBe(1);
    const snapshot = (session as unknown as { campaignSnapshot(): CampaignState | null }).campaignSnapshot();
    expect(snapshot!.checkpoint).toMatchObject({ mission: 'one', run: 'replay', elapsedTicks: 50 });
  });
});
