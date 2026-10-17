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

function play(campaign = newCampaignState(world.id), lobby = false, ai = true, missionDef = mission) {
  const saves: CampaignState[] = [];
  let handoffs = 0;
  const session = new Session(undefined, '', world, {
    ...(ai ? { encounter, events } : {}), mission: missionDef, campaign, campaignDef, loadouts: 'class', roomLobby: lobby,
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

const holdingMission = parseMission({ ...mission, prisonerHoldings: Array.from({ length: 5 }, (_, i) =>
  ({ id: `carry-${i + 1}`, feet: { x: -16 + i * 4, y: 8, z: 10 } })) });
function prisonerCampaign(run: 'campaign' | 'replay') {
  const input = carried(); input.run = run;
  const prisoners = [5, 2].map((slot) => ({ slot, at: { x: 18, y: 8, z: 12 + slot } }));
  if (run === 'campaign') {
    for (const p of prisoners) input.soldiers[p.slot] = { ...input.soldiers[p.slot]!, captured: true, prisoner: p.at };
  } else {
    input.replayPrisoners = prisoners;
    input.soldiers[4] = { ...input.soldiers[4]!, captured: true, prisoner: { x: 24, y: 8, z: 18 } };
  }
  return input;
}

describe('authored prisoner placement through the restore wire (U-224)', () => {
  it('places the five-carried maximum without claiming the separate escort holding', () => {
    const input = carried();
    for (let slot = 1; slot < 6; slot++) input.soldiers[slot] = { ...input.soldiers[slot]!, captured: true, prisoner: { x: 18, y: 8, z: 12 } };
    const fresh = play(input, false, true, holdingMission);
    expect(fresh.session.slots.filter((s) => s.captured).map((s) => s.prisoner)).toEqual(holdingMission.prisonerHoldings!.map((h) => h.feet));
    expect(fresh.session.slots[0]!.captured).toBe(false);
  });

  it.each(['campaign', 'replay'] as const)('places only the active %s pool on a fresh mission start', (run) => {
    const input = prisonerCampaign(run), before = structuredClone(input);
    const fresh = play(input, false, true, holdingMission);
    expect(fresh.session.slots.filter((s) => s.captured).map((s) => ({ slot: s.index, at: s.prisoner })))
      .toEqual([2, 5].map((slot, i) => ({ slot, at: holdingMission.prisonerHoldings![i]!.feet })));
    const after = fresh.save();
    expect(after.completedMissions).toEqual(input.completedMissions);
    expect(after.soldiers[1]).toMatchObject({ xp: 740, rank: 1 });
    if (run === 'campaign') expect(after.replayPrisoners).toEqual(input.replayPrisoners);
    else expect(after.soldiers[4]!.prisoner).toEqual(input.soldiers[4]!.prisoner);
    expect(input).toEqual(before);
  });

  for (const run of ['campaign', 'replay'] as const) for (const lobby of [false, true]) {
    it(`restarts the original ${run} pool only on host choice; lobby=${lobby}`, () => {
      const saved = checkpoint(prisonerCampaign(run)); saved.checkpoint!.mapRevision = 1;
      // A later checkpoint capture must not join the original mission-start pool.
      if (run === 'campaign') saved.soldiers[3] = { ...saved.soldiers[3]!, captured: true, prisoner: { x: 70, y: 0, z: 65 } };
      else saved.replayPrisoners!.push({ slot: 3, at: { x: 70, y: 0, z: 65 } });
      const original = structuredClone(saved);
      const restored = play(saved, lobby, true, holdingMission), host = restored.join(), guest = restored.join();
      expect(restored.gate(host)).toMatchObject({ restart: 'original' });
      expect(restored.gate(guest)).toEqual(restored.gate(host));
      expect(restored.session.slots.every((s) => s.prisoner === null)).toBe(true);
      restored.send(guest, { kind: 'MissionRestart', full: true });
      restored.step(30);
      expect(restored.session.started).toBe(false);
      expect(restored.saves).toHaveLength(0);
      expect(restored.x.campaignSnapshot()).toEqual(original);
      restored.send(host, { kind: 'MissionRestart', full: true });
      expect(restored.gate(host)).toBeNull();
      expect(restored.session.started).toBe(!lobby);
      const expected = [2, 5].map((slot, i) => ({ slot, at: holdingMission.prisonerHoldings![i]!.feet }));
      expect(restored.session.slots.filter((s) => s.captured).map((s) => ({ slot: s.index, at: s.prisoner }))).toEqual(expected);
      expect(restored.inventory()).toEqual(saved.checkpoint!.missionStart!.slots);
      const after = restored.saves.at(-1)!;
      expect(after.checkpoint).toMatchObject({ mapRevision: 2, missionStart: { captured: expected } });
      if (run === 'campaign') expect(after.soldiers.filter((s) => s.captured).map((s) => ({ slot: s.slot, at: s.prisoner }))).toEqual(expected);
      else expect(after.replayPrisoners).toEqual(expected);
      expect(after.completedMissions).toEqual(saved.completedMissions);
      expect(after.soldiers[1]).toMatchObject({ xp: 740, rank: 1 });
      if (run === 'campaign') expect(after.replayPrisoners).toEqual(saved.replayPrisoners);
      else expect(after.soldiers[4]!.prisoner).toEqual(saved.soldiers[4]!.prisoner);
      // A basic lobby save reloads before ready-up without duplicating or losing captives.
      const reloaded = play(after, lobby, true, holdingMission), owner = reloaded.join();
      expect(reloaded.gate(owner)).toBeNull();
      if (lobby) reloaded.send(owner, { kind: 'RoomCommand', command: 'ready', ready: true });
      reloaded.session.restartMission();
      expect(reloaded.session.slots.filter((s) => s.captured).map((s) => s.prisoner)).toEqual(expected.map((p) => p.at));
      expect(saved).toEqual(original);
    });
  }

  it('keeps insufficient holdings blocked without overwriting the refused save', () => {
    const saved = checkpoint(prisonerCampaign('campaign')); saved.checkpoint!.mapRevision = 1;
    const small = { ...holdingMission, prisonerHoldings: holdingMission.prisonerHoldings!.slice(0, 1) };
    const restored = play(saved, false, true, small), host = restored.join();
    expect(restored.gate(host)).toMatchObject({ restart: 'prisoner-placement' });
    restored.send(host, { kind: 'MissionRestart', full: true });
    expect(restored.saves).toHaveLength(0);
    expect(restored.x.campaignSnapshot()).toEqual(saved);
    expect(() => play(prisonerCampaign('campaign'), false, true, small)).toThrow(/insufficient prisoner holdings/);
  });

  it('preserves same-revision checkpoint coordinates and spent inventory despite new authored holdings', () => {
    const saved = checkpoint(prisonerCampaign('campaign'));
    const restored = play(saved, false, true, holdingMission), host = restored.join();
    expect(restored.gate(host)).toBeNull();
    expect(restored.inventory()).toEqual((saved.checkpoint!.world as CheckpointWorld).slots);
    expect(restored.session.slots[2]!.prisoner).toEqual(saved.soldiers[2]!.prisoner);
    restored.session.retryMission();
    expect(restored.session.slots[2]!.prisoner).toEqual(saved.soldiers[2]!.prisoner);
    restored.session.restartMission();
    expect(restored.session.slots[2]!.prisoner).toEqual(saved.checkpoint!.missionStart!.captured.find((p) => p.slot === 2)!.at);
  });

  it('uses legacy carry-over inventory with authored holdings and rejects invalid standing space before play', () => {
    const saved = checkpoint(prisonerCampaign('campaign'));
    delete saved.checkpoint!.missionStart; delete saved.checkpoint!.mapRevision;
    const restored = play(saved, false, true, holdingMission), host = restored.join();
    expect(restored.gate(host)).toMatchObject({ restart: 'legacy' });
    restored.send(host, { kind: 'MissionRestart', full: true });
    expect(restored.session.slots[1]!.weaponState.ammo).toBe(7);
    expect(restored.session.slots[1]!.kits).toBe(2);
    expect(restored.session.slots[2]!.prisoner).toEqual(holdingMission.prisonerHoldings![0]!.feet);
    expect(() => play(saved, false, true, { ...holdingMission,
      prisonerHoldings: [{ id: 'bad-floor', feet: { x: 0, y: 9, z: 10 } }] })).toThrow(/unsupported/);
  });
});

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
