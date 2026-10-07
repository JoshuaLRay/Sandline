import { describe, expect, it } from 'vitest';
import {
  ClientConnection, createLoopbackPair, decodeMessage as decode, loadWorld, parseCampaign, parseEncounter,
  parseEventScript, parseMission, PROJECTILE_IDS, PROTOCOL_VERSION, requireWorld, TICK_SECONDS, type Message,
} from '@sandline/shared';
import { type CampaignState, newCampaignState } from '../persistence/CampaignDatabase.ts';
import { Session } from './Session.ts';
import type { CheckpointWorld, SlotCheckpoint } from './checkpointWorld.ts';
import type { EventCheckpoint } from './events.ts';

const starts = [-10, -6].flatMap((z) => [-6, -2, 2].map((x) => ({ x, y: 8, z })));
const world = loadWorld({
  id: 'restore-test', mapRevision: 2, floor: { halfExtent: 80 }, squadStarts: starts,
  cover: [{ id: 'deck', x: 0, y: 5.5, z: 0, w: 80, d: 80, h: 2.5 }],
  mission: requireWorld('greybox-01').mission,
});
const encounter = parseEncounter({
  world: world.id, aliveCap: 4, probes: [0.3, 1, 1.7], areas: {},
  groups: [{ id: 'guard', members: [{ archetype: 'rifleman', count: 1 }], zone: 'behind-objective',
    posture: { kind: 'hold' }, trigger: { kind: 'start' },
    sockets: [{ id: 'G1', archetype: 'rifleman', feet: { x: 14, y: 8, z: 14 }, face: { x: 14, z: 16 } }] }],
}, () => world);
const mission = parseMission({ id: world.id, world: world.id, respawn: false,
  objectives: [{ type: 'survive', label: 'Wait', seconds: 3600 }] });
const events = parseEventScript({ world: world.id, blockers: [], events: [
  { id: 'one-shot', trigger: { kind: 'time', seconds: 0 }, actions: [{ kind: 'set-flag', flag: 'briefed', value: true }] },
  { id: 'pending', trigger: { kind: 'time', seconds: 0 }, delaySeconds: 30,
    actions: [{ kind: 'set-flag', flag: 'arrived', value: true }] },
] }, encounter, world, mission);
const entry = (id: string) => ({ mission: id, title: id, briefing: ['Begin'], debrief: ['Done'] });
const campaignDef = parseCampaign({ id: 'test', missions: [entry('earlier'), entry(world.id), entry('later')] }, () => true);
interface Internals {
  captureMissionCheckpoint(): void;
  campaignSnapshot(): CampaignState;
  checkpointSlot(slot: Session['slots'][number]): SlotCheckpoint;
  eventRun: { checkpoint(): EventCheckpoint };
  nowMs: number;
}

function play(campaign = newCampaignState(world.id), lobby = false, ai = true) {
  const saves: CampaignState[] = [];
  let handoffs = 0;
  const session = new Session(undefined, '', world, {
    ...(ai ? { encounter, events } : {}), mission, campaign, campaignDef, loadouts: 'class', roomLobby: lobby,
    onCampaignSave: (state) => saves.push(structuredClone(state)), onHandoff: () => handoffs++,
  });
  const x = session as unknown as Internals;
  let now = 0;
  const people: { client: ClientConnection; pair: ReturnType<typeof createLoopbackPair>; heard: Message[]; resume: string }[] = [];
  const settle = () => { for (let round = 0; round < 2; round++) people.forEach((person) => person.pair.settle()); };
  const join = (resume = '') => {
    const pair = createLoopbackPair();
    session.addConnection(pair.a, now);
    const heard: Message[] = [];
    const person = { pair, heard, resume: '', client: new ClientConnection(pair.b, {
      onRestoreGate: (m) => heard.push(m), onRunOffer: (m) => heard.push(m), onHandoff: (m) => heard.push(m),
    }) };
    pair.b.onMessage((data) => {
      // JoinAck also contains the resume token; ClientConnection intentionally keeps only the seat.
      const decoded = decode(data);
      if (decoded.kind === 'JoinAck') person.resume = decoded.resume ?? '';
    });
    people.push(person);
    person.client.send({ kind: 'Join', version: PROTOCOL_VERSION, name: `person-${people.length}`, room: '', ...(resume ? { resume } : {}) });
    settle();
    return person;
  };
  const send = (person: ReturnType<typeof join>, message: Message) => { person.client.send(message); settle(); };
  const step = (count = 1) => {
    for (let i = 0; i < count; i++) {
      now += TICK_SECONDS * 1000;
      if (i % 30 === 0) for (const person of people) person.client.send({ kind: 'Ping', id: 1, clientTime: 0 });
      settle(); session.step(now); settle();
    }
  };
  const gate = (person: ReturnType<typeof join>) => person.heard.filter((m): m is Extract<Message, { kind: 'RestoreGate' }> => m.kind === 'RestoreGate').at(-1)?.choice;
  return { session, x, saves, join, send, step, gate, handoffs: () => handoffs,
    save: () => { x.captureMissionCheckpoint(); return saves.at(-1)!; },
    inventory: () => session.slots.map((slot) => x.checkpointSlot(slot)),
  };
}

function carried(): CampaignState {
  const state = newCampaignState(world.id);
  state.completedMissions = ['earlier'];
  state.soldiers[1]!.xp = 740;
  state.soldiers[1]!.rank = 1;
  state.soldiers[1]!.loadout = {
    health: 100, weapon: 'marksman', primary: 'marksman', secondary: null, noPistol: false,
    pickedUp: true, ammo: [['marksman', 7]], pouch: [0, 1], kits: 2, equipment: -1,
  };
  state.replayPrisoners = [{ slot: 3, at: { x: 70, y: 0, z: 70 } }];
  return state;
}

function checkpoint(input = carried()): CampaignState {
  const original = play(input);
  original.step(2);
  original.session.slots[1]!.weaponState.ammo = 1;
  original.session.slots[1]!.kits = 0;
  original.session.slots[1]!.health.current = 41;
  original.session.slots[1]!.state.x += 1;
  return JSON.parse(JSON.stringify(original.save())) as CampaignState;
}

describe('incompatible restores are quarantined (U-143)', () => {
  it('cannot bypass revision quarantine by disabling the encounter/AI runtime', () => {
    const saved = checkpoint(); saved.checkpoint!.mapRevision = 1;
    const restored = play(saved, false, false); const host = restored.join();
    expect(restored.session.mission).toBeNull();
    expect(restored.session.started).toBe(false);
    expect(restored.gate(host)).toMatchObject({ restart: 'original' });
    restored.step(60);
    expect(restored.session.tick).toBe(0);
    restored.send(host, { kind: 'MissionRestart', full: true });
    expect(restored.gate(host)).toBeNull();
    expect(restored.saves.at(-1)!.checkpoint).toMatchObject({ mapRevision: 2, missionStart: saved.checkpoint!.missionStart });
  });
  it.each([undefined, 1, 3])('refuses revision %s before old-world or fresh encounter initialization', (revision) => {
    const saved = checkpoint();
    if (revision === undefined) delete saved.checkpoint!.mapRevision;
    else saved.checkpoint!.mapRevision = revision;
    saved.checkpoint!.spawns = starts.map(() => ({ x: 70, y: 0, z: 60 }));
    const oldWorld = saved.checkpoint!.world as CheckpointWorld;
    oldWorld.enemies[0]!.x = 70; oldWorld.enemies[0]!.y = 0;
    oldWorld.ground.push({ weapon: 0, ammo: 3, x: 70, y: 0, z: 65, yaw: 0, authored: true });
    oldWorld.placed.push({ kind: PROJECTILE_IDS.indexOf('c4'), ownerSlot: 0,
      state: { x: 70, y: 0, z: 66, vx: 0, vy: 0, vz: 0, age: 1, bounces: 0, resting: true } });
    const restored = play(saved);
    expect(restored.session.started).toBe(false);
    expect(restored.session.slots.map((s) => ({ x: s.state.x, y: s.state.y, z: s.state.z }))).toEqual(starts);
    expect(restored.session.enemies).toHaveLength(0);
    expect(restored.session.spawner).toBeNull();
    expect(restored.session.director).toBeNull();
    expect(restored.session.pickups).toHaveLength(0);
    expect(restored.session.projectilesNow()).toHaveLength(0);
    const initialEvents = restored.x.eventRun.checkpoint();
    expect(initialEvents).toMatchObject({ fired: [], flags: [] });
    expect(initialEvents.pending ?? []).toEqual([]);
    expect(restored.x.campaignSnapshot()).toEqual(saved);
    expect(restored.saves).toHaveLength(0);
    const host = restored.join();
    expect(restored.gate(host)).toEqual({ mission: world.id, host: 0, restart: 'original' });
    restored.send(host, { kind: 'Input', tick: 1, moveX: 1, moveY: 1, yaw: 500, pitch: 200, buttons: 255 });
    restored.send(host, { kind: 'Fire', tick: 1, yaw: 0, pitch: 0, weapon: 0, ads: true, renderTimeMs: 0 });
    restored.send(host, { kind: 'Throw', tick: 1, yaw: 0, pitch: 0, projectile: 0 });
    restored.send(host, { kind: 'Equip', item: 1 });
    restored.send(host, { kind: 'Reload' });
    const inventory = restored.inventory();
    restored.step(1);
    const clock = restored.x.nowMs;
    restored.step(900);
    expect(restored.session.tick).toBe(0);
    expect(restored.x.nowMs).toBeCloseTo(clock, 9);
    expect(restored.session.scoreboard.elapsedTicks).toBe(0);
    expect(restored.session.slots[0]!.queue).toHaveLength(0);
    expect(restored.session.slots[0]!.yaw).toBe(0);
    expect(restored.inventory()).toEqual(inventory);
    expect(restored.x.eventRun.checkpoint()).toEqual(initialEvents);
    expect(restored.x.campaignSnapshot()).toEqual(saved);
  });

  it('keeps lobby ready/start, checkpoint retry, nonhost restart and invalid mission choices blocked', () => {
    const saved = checkpoint(); saved.checkpoint!.mapRevision = 1;
    const restored = play(saved, true);
    const host = restored.join(); const other = restored.join();
    for (const person of [host, other]) restored.send(person, { kind: 'RoomCommand', command: 'ready', ready: true });
    restored.send(host, { kind: 'RoomCommand', command: 'start' });
    restored.send(host, { kind: 'MissionRestart' });
    restored.send(other, { kind: 'MissionRestart', full: true });
    restored.send(other, { kind: 'RoomCommand', command: 'choose', run: 'replay', mission: 'earlier' });
    restored.send(host, { kind: 'RoomCommand', command: 'choose', run: 'campaign', mission: 'later' });
    restored.session.retryMission(true);
    restored.session.restartMission();
    restored.step(30);
    expect(restored.session.started).toBe(false);
    expect(restored.session.enemies).toHaveLength(0);
    expect(restored.saves).toHaveLength(0);
    expect(restored.handoffs()).toBe(0);
    expect(restored.gate(other)).toMatchObject({ host: 0 });
  });

  it('reissues the decision on reconnect and host changes without advancing gameplay', () => {
    const saved = checkpoint(); delete saved.checkpoint!.mapRevision;
    const restored = play(saved, true);
    const host = restored.join(); const other = restored.join();
    host.pair.b.close('network drop');
    restored.send(other, { kind: 'Ping', id: 1, clientTime: 0 });
    expect(restored.gate(other)).toMatchObject({ host: 1 });
    restored.step(90);
    const resumed = restored.join(host.resume);
    expect(resumed.client.slot).toBe(0);
    expect(restored.session.stats.resumes).toBe(1);
    expect(restored.gate(resumed)).toMatchObject({ host: 0, restart: 'original' });
    expect(restored.gate(other)).toMatchObject({ host: 0 });
    expect(other.heard.filter((m) => m.kind === 'RunOffer').at(-1)).toMatchObject({ host: 0 });
    restored.send(other, { kind: 'MissionRestart', full: true });
    expect(restored.session.started).toBe(false);
    resumed.pair.b.close('left');
    restored.send(other, { kind: 'MissionRestart', full: true });
    expect(restored.gate(other)).toBeNull();
    // Ready-up is still required after the host's restart choice.
    expect(restored.session.started).toBe(false);
    restored.send(other, { kind: 'RoomCommand', command: 'ready', ready: true });
    expect(restored.session.started).toBe(true);
  });

  it.each([false, true])('restarts from authored starts and original inventory, keeping ready-up=%s and repeated restart stable', (lobby) => {
    const saved = checkpoint(); saved.checkpoint!.mapRevision = 1;
    saved.checkpoint!.missionStart!.slots[1]!.ammo = [['marksman', 3]];
    saved.checkpoint!.missionStart!.slots[1]!.kits = 1;
    const restored = play(saved, lobby); const host = restored.join();
    restored.step(90);
    restored.send(host, { kind: 'MissionRestart', full: true });
    expect(restored.gate(host)).toBeNull();
    expect(restored.session.started).toBe(!lobby);
    if (lobby) {
      expect(restored.session.spawner).toBeNull();
      // The acknowledged current basic start survives a process reload before ready-up.
      const reloaded = play(restored.saves.at(-1)!, true); const owner = reloaded.join();
      reloaded.send(owner, { kind: 'RoomCommand', command: 'ready', ready: true });
      expect(reloaded.session.slots[1]!.weaponState.ammo).toBe(3);
      expect(reloaded.session.slots[1]!.kits).toBe(1);
      restored.send(host, { kind: 'RoomCommand', command: 'ready', ready: true });
    }
    expect(restored.session.enemies).toHaveLength(1);
    expect(restored.session.slots.map((s) => ({ x: s.state.x, y: s.state.y, z: s.state.z }))).toEqual(starts);
    expect(restored.inventory()).toEqual(saved.checkpoint!.missionStart!.slots);
    const after = restored.saves.at(-1)!;
    expect(after.checkpoint!.mapRevision).toBe(2);
    expect(after.completedMissions).toEqual(saved.completedMissions);
    expect(after.replayPrisoners).toEqual(saved.replayPrisoners);
    expect(after.soldiers[1]).toMatchObject({ xp: 740, rank: 1, loadout: saved.soldiers[1]!.loadout });
    for (let i = 0; i < 3; i++) {
      restored.session.slots[1]!.weaponState.ammo = 0;
      restored.session.slots[1]!.kits = 0;
      restored.send(host, { kind: 'MissionRestart', full: true });
      expect(restored.inventory()).toEqual(saved.checkpoint!.missionStart!.slots);
      expect(restored.session.enemies).toHaveLength(1);
    }
  });

  it('uses explicit legacy pre-mission carry-over/class inventory, never spent checkpoint stock', () => {
    const saved = checkpoint(); delete saved.checkpoint!.missionStart; delete saved.checkpoint!.mapRevision;
    const restored = play(saved); const host = restored.join();
    expect(restored.gate(host)).toMatchObject({ restart: 'legacy' });
    restored.send(host, { kind: 'MissionRestart', full: true });
    expect(restored.session.slots[1]!.weaponState.ammo).toBe(7);
    expect(restored.session.slots[1]!.kits).toBe(2);
    expect(restored.session.slots[0]!.kits).toBeGreaterThan(0);
    expect(restored.saves.at(-1)!.checkpoint!.missionStart).toBeDefined();
  });

  it.each(['campaign', 'replay'] as const)('keeps both pools and the refused %s checkpoint on mission select; never places old prisoners', (run) => {
    const input = carried(); input.run = run;
    input.soldiers[4] = { ...input.soldiers[4]!, captured: true, prisoner: { x: 68, y: 0, z: 66 } };
    const saved = checkpoint(input); saved.checkpoint!.mapRevision = 1;
    const restored = play(saved); const host = restored.join();
    expect(restored.gate(host)).toMatchObject({ restart: 'prisoner-placement' });
    for (const slot of restored.session.slots) {
      expect(slot.prisoner).toBeNull();
      expect(slot.state.y).toBe(8);
    }
    restored.send(host, { kind: 'MissionRestart', full: true });
    restored.send(host, { kind: 'RoomCommand', command: 'choose', run, mission: world.id });
    expect(restored.session.started).toBe(false);
    expect(restored.saves).toHaveLength(0);
    restored.send(host, { kind: 'RoomCommand', command: 'choose', run: 'replay', mission: 'earlier' });
    const after = restored.saves.at(-1)!;
    expect(after.checkpoint).toEqual(saved.checkpoint);
    expect(after.soldiers).toEqual(saved.soldiers);
    expect(after.replayPrisoners).toEqual(saved.replayPrisoners);
    expect(after.completedMissions).toEqual(saved.completedMissions);
    expect(after).toMatchObject({ world: 'earlier', run: 'replay' });
    expect(restored.handoffs()).toBe(1);
  });

  it.each(['mission', 'run'])('carries an unrelated %s checkpoint untouched without blocking the active run', (other) => {
    const saved = checkpoint(); delete saved.checkpoint!.mapRevision;
    if (other === 'mission') saved.checkpoint!.mission = 'elsewhere';
    else saved.checkpoint!.run = 'replay';
    const restored = play(saved); const host = restored.join();
    expect(restored.session.started).toBe(true);
    expect(restored.gate(host)).toBeNull();
    restored.session.restartMission();
    expect(restored.x.campaignSnapshot().checkpoint).toEqual(saved.checkpoint);
  });

  it('continues to restore same-revision 3D state, inventory, one-shot flags and remaining timers without replenishment', () => {
    const saved = checkpoint();
    const restored = play(saved); const host = restored.join();
    expect(restored.gate(host)).toBeNull();
    expect(restored.inventory()).toEqual((saved.checkpoint!.world as CheckpointWorld).slots);
    expect(restored.session.slots.map((s) => ({ x: s.state.x, y: s.state.y, z: s.state.z }))).toEqual(saved.checkpoint!.spawns);
    expect(restored.x.eventRun.checkpoint()).toEqual(saved.checkpoint!.event);
    restored.step(15);
    const after = restored.save();
    expect((after.checkpoint!.event as EventCheckpoint).fired.filter((id) => id === 'one-shot')).toHaveLength(1);
    const due = (after.checkpoint!.event as EventCheckpoint).pending![0]![1];
    expect(due).toBe(30);
    expect(due - (after.checkpoint!.world as CheckpointWorld).seconds).toBeLessThan(30 - (saved.checkpoint!.world as CheckpointWorld).seconds);
    expect(restored.session.slots[1]!.weaponState.ammo).toBe(1);
    expect(restored.session.slots[1]!.kits).toBe(0);
  });
});
