import { describe, expect, it } from 'vitest';
import {
  ClientConnection, createLoopbackPair, getWeapon, loadWorld,
  parseEncounter, parseEventScript, parseMission, requireWorld, TICK_SECONDS,
} from '@sandline/shared';
import { type CampaignState, newCampaignState } from '../persistence/CampaignDatabase.ts';
import { Session } from './Session.ts';
import { type CheckpointWorld, type SlotCheckpoint } from './checkpointWorld.ts';
import type { EventCheckpoint } from './events.ts';

const starts = [-10, -6].flatMap((z) => [-6, -2, 2].map((x) => ({ x, y: 8, z })));
const world = loadWorld({
  id: 'revision-test', mapRevision: 2, floor: { halfExtent: 80 },
  squadStarts: starts,
  cover: [{ id: 'deck', x: 0, y: 5.5, z: 0, w: 80, d: 80, h: 2.5 }],
  mission: requireWorld('greybox-01').mission,
});
const encounter = parseEncounter({
  world: world.id, aliveCap: 4, probes: [0.3, 1, 1.7], areas: {},
  groups: [{ id: 'later', members: [{ archetype: 'rifleman', count: 1 }],
    zone: 'behind-objective', posture: { kind: 'hold' }, trigger: { kind: 'time', seconds: 3600 } }],
}, () => world);
const mission = parseMission({ id: world.id, world: world.id, respawn: false,
  objectives: [{ type: 'survive', label: 'Wait', seconds: 3600 }] });
const events = parseEventScript({ world: world.id, blockers: [], events: [
  { id: 'one-shot', trigger: { kind: 'time', seconds: 0 }, actions: [{ kind: 'set-flag', flag: 'briefed', value: true }] },
  { id: 'pending', trigger: { kind: 'time', seconds: 0 }, delaySeconds: 30,
    actions: [{ kind: 'set-flag', flag: 'arrived', value: true }] },
] }, encounter, world, mission);

interface Internals { captureMissionCheckpoint(): void; checkpointSlot(slot: Session['slots'][number]): SlotCheckpoint }

function play(campaign?: CampaignState, lobby = false) {
  const saves: CampaignState[] = [];
  const session = new Session(undefined, '', world, {
    encounter, mission, events, loadouts: 'class', roomLobby: lobby,
    ...(campaign ? { campaign } : {}), onCampaignSave: (s) => saves.push(s),
  });
  const x = session as unknown as Internals;
  let now = 0;
  const step = (n = 1) => { for (let i = 0; i < n; i++) session.step(now += TICK_SECONDS * 1000); };
  const snapshot = () => session.slots.map((s) => x.checkpointSlot(s));
  const save = () => { x.captureMissionCheckpoint(); return saves.at(-1)!; };
  return { session, saves, step, snapshot, save };
}

function carried(): CampaignState {
  const state = newCampaignState(world.id);
  state.completedMissions = ['earlier'];
  state.soldiers[1]!.loadout = {
    health: 100, weapon: 'marksman', primary: 'marksman', secondary: null,
    noPistol: false, pickedUp: true, ammo: [['marksman', 7]], pouch: [0, 1], kits: 2, equipment: -1,
  };
  state.soldiers[1]!.xp = 740;
  state.soldiers[1]!.rank = 1;
  state.soldiers[4] = { ...state.soldiers[4]!, captured: true, prisoner: { x: 16, y: 8, z: 12 } };
  state.replayPrisoners = [{ slot: 3, at: { x: 18, y: 16, z: 14 } }];
  return state;
}

describe('original mission-start data stays separate from checkpoint state (U-135)', () => {
  it('restores same-revision 3D state, spent inventory, pending timers and one-shot flags through repeated reloads', () => {
    const original = play(carried());
    const start = original.snapshot();
    original.step(2);
    original.session.slots[1]!.weaponState.ammo = 1;
    original.session.slots[1]!.kits = 0;
    original.session.slots[1]!.pouch = [0, 0];
    original.session.slots[1]!.state.x += 1;
    const saved = original.save();
    expect(saved.checkpoint).toMatchObject({ mapRevision: 2, missionStart: { slots: start } });
    const event = saved.checkpoint!.event as EventCheckpoint;
    expect(event.fired).toContain('one-shot');
    expect(event.pending).toEqual([['pending', 30]]);
    for (let i = 0; i < 3; i++) {
      const restored = play(JSON.parse(JSON.stringify(saved)) as CampaignState);
      expect(restored.snapshot()).toEqual((saved.checkpoint!.world as CheckpointWorld).slots);
      expect(restored.session.slots.map((s) => ({ x: s.state.x, y: s.state.y, z: s.state.z }))).toEqual(saved.checkpoint!.spawns);
      const resaved = restored.save();
      expect(resaved.checkpoint!.event).toEqual(event);
      expect(resaved.checkpoint!.mapRevision).toBe(2);
      expect(resaved.checkpoint!.missionStart).toEqual(saved.checkpoint!.missionStart);
      restored.session.restartMission();
      expect(restored.snapshot()).toEqual(start);
      expect(restored.session.slots[1]!.weaponState.ammo).toBe(7);
      expect(restored.session.slots[1]!.kits).toBe(2);
      expect(restored.session.slots.filter((s) => !s.captured).every((s) => s.state.y === 8)).toBe(true);
    }
  });

  it('restarts from original prisoners while retry/reload retains later captures and preserves the other pool and progression', () => {
    const original = play(carried());
    expect(original.session.captureCharacter(5, { x: 20, y: 8, z: 15 })).toBe(true);
    const saved = original.save();
    expect(saved.soldiers[5]!.captured).toBe(true);
    expect(saved.checkpoint!.missionStart!.captured.map((p) => p.slot)).toEqual([4]);
    const restored = play(JSON.parse(JSON.stringify(saved)) as CampaignState);
    expect(restored.session.slots[5]!.captured).toBe(true);
    restored.session.retryMission(true);
    expect(restored.session.slots[5]!.captured).toBe(true);
    restored.session.restartMission();
    expect(restored.session.slots[5]!.captured).toBe(false);
    expect(restored.session.slots[4]!.prisoner).toEqual(carried().soldiers[4]!.prisoner);
    const after = restored.save();
    expect(after.completedMissions).toEqual(saved.completedMissions);
    expect(after.replayPrisoners).toEqual(saved.replayPrisoners);
    expect(after.soldiers[1]).toMatchObject({ xp: 740, rank: 1, loadout: carried().soldiers[1]!.loadout });
    expect(after.soldiers[5]!.captured).toBeUndefined();
  });

  it('captures a lobby baseline only at ready-up and restores it after durable reload', () => {
    const room = play(carried(), true);
    const pair = createLoopbackPair();
    room.session.addConnection(pair.a, 0);
    const client = new ClientConnection(pair.b, {});
    client.join('owner');
    pair.settle();
    const slot = room.session.slots[1]!;
    slot.kits = 1;
    const start = room.snapshot();
    client.send({ kind: 'RoomCommand', command: 'ready', ready: true });
    pair.settle();
    expect(room.session.started).toBe(true);
    slot.kits = 0;
    const saved = room.save();
    expect(saved.checkpoint!.missionStart!.slots).toEqual(start);
    const restored = play(saved, true);
    const resumedPair = createLoopbackPair();
    restored.session.addConnection(resumedPair.a, 0);
    const resumedClient = new ClientConnection(resumedPair.b, {});
    resumedClient.join('owner');
    resumedPair.settle();
    resumedClient.send({ kind: 'RoomCommand', command: 'ready', ready: true });
    resumedPair.settle();
    expect(restored.session.slots[1]!.kits).toBe(0);
    restored.session.restartMission();
    expect(restored.session.slots[1]!.kits).toBe(1);
  });

  it('keeps replay start inventory independent of campaign carry-over', () => {
    const state = carried();
    state.run = 'replay';
    const replay = play(state);
    const start = replay.snapshot();
    expect(start[1]!.weapon).not.toBe('marksman');
    replay.session.slots[1]!.weapon = getWeapon('marksman');
    replay.session.slots[1]!.weaponState.ammo = 1;
    const restored = play(replay.save());
    restored.session.restartMission();
    expect(restored.snapshot()).toEqual(start);
    expect(restored.save().soldiers[1]!.loadout).toEqual(state.soldiers[1]!.loadout);
  });

  it.each([undefined, 1])('does not relabel restored revision %s when writing the existing checkpoint', (mapRevision) => {
    const original = play(carried());
    const saved = original.save();
    if (mapRevision === undefined) delete saved.checkpoint!.mapRevision;
    else saved.checkpoint!.mapRevision = mapRevision;
    const restored = play(saved);
    Object.assign(restored.session.slots[0]!.health, { current: 0, diedAt: 0 });
    restored.step();
    // U-143: provenance is now checked before restore; waiting cannot overwrite the refused save.
    expect(restored.session.started).toBe(false);
    expect(restored.saves).toHaveLength(0);
    const snapshot = (restored.session as unknown as { campaignSnapshot(): CampaignState }).campaignSnapshot();
    expect(snapshot.checkpoint).toEqual(saved.checkpoint);
  });

  it('carries another mission/run checkpoint unchanged and keeps legacy save fallback', () => {
    const original = play(carried());
    const saved = original.save();
    saved.checkpoint!.run = 'replay';
    const other = play(saved);
    Object.assign(other.session.slots[0]!.health, { current: 0, diedAt: 0 });
    other.step();
    expect(other.saves.at(-1)!.checkpoint).toEqual(saved.checkpoint);
    delete saved.checkpoint!.run;
    delete saved.checkpoint!.missionStart;
    delete saved.checkpoint!.mapRevision;
    const legacy = play(saved);
    legacy.session.restartMission();
    // This fixture carries prisoners; U-144 must supply authored holding positions before restart is allowed.
    expect(legacy.session.started).toBe(false);
    expect(legacy.session.slots[4]!.prisoner).toBeNull();
    expect(legacy.session.slots[1]!.weaponState.ammo).toBe(7);
    expect(legacy.session.slots[1]!.kits).toBe(2);
  });
});
