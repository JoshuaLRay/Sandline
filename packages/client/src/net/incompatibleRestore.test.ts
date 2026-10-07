import { describe, expect, it } from 'vitest';
import {
  createLoopbackPair, createMoveState, decodeMessage, encodeMessage, parseCampaign, parseEncounter, parseEventScript,
  parseMission, requireWorld, RESTORE_MAP_CHANGED_MESSAGE, TICK_SECONDS, type Message,
} from '@sandline/shared';
import { Session, type SessionOptions } from '@sandline/server/session';
import { NetClient } from './NetClient.ts';
import { restoreChoiceModel } from '../ui/restoreChoice.ts';

type CampaignState = NonNullable<SessionOptions['campaign']>;
const world = { ...requireWorld('greybox-01'), mapRevision: 2 };
const encounter = parseEncounter({ world: world.id, aliveCap: 4, probes: [0.3, 1, 1.7], areas: {}, groups: [
  { id: 'later', members: [{ archetype: 'rifleman', count: 1 }], zone: 'behind-objective', posture: { kind: 'hold' }, trigger: { kind: 'time', seconds: 3600 } },
] });
const mission = parseMission({ id: world.id, world: world.id, respawn: false, objectives: [{ type: 'survive', label: 'Wait', seconds: 3600 }] });
const campaignDef = parseCampaign({ id: 'test', missions: ['earlier', world.id].map((id) => ({ mission: id, title: id, briefing: ['Begin'], debrief: ['Done'] })) }, () => true);
const events = parseEventScript({ world: world.id, blockers: [], events: [], supplyCaches: [
  { id: 'medical', feet: { x: 10, y: 0, z: 10 }, stock: { healthKits: 2 } },
] }, encounter, world, mission);

function room(legacy = false, supplies = false) {
  const original: CampaignState = { formatVersion: 1, world: world.id, completedMissions: ['earlier'], checkpoint: null,
    soldiers: Array.from({ length: 6 }, (_, slot) => ({ slot, classId: '', xp: 0, rank: 0 })) };
  let saved = original;
  const initial = new Session(undefined, '', world, { mission, encounter, ...(supplies ? { events } : {}), loadouts: 'class', campaign: original, onCampaignSave: (s) => { saved = s; } });
  if (supplies) {
    // The refused old-map checkpoint has spent supplies, unlike the authored new-map start.
    initial.slots[0]!.kits = 0;
  }
  (initial as unknown as { captureMissionCheckpoint(): void }).captureMissionCheckpoint();
  saved = structuredClone(saved);
  if (supplies) (saved.checkpoint!.world as { caches: { stock: { healthKits: number } }[] }).caches[0]!.stock.healthKits = 1;
  saved.checkpoint!.mapRevision = 1;
  if (legacy) delete saved.checkpoint!.missionStart;
  const saves: CampaignState[] = [];
  const session = new Session(undefined, '', world, { mission, encounter, ...(supplies ? { events } : {}), campaignDef, loadouts: 'class', campaign: saved,
    onCampaignSave: (state) => saves.push(state) });
  let now = 0;
  const clients: { net: NetClient; pair: ReturnType<typeof createLoopbackPair> }[] = [];
  const settle = () => { for (let round = 0; round < 2; round++) clients.forEach((c) => c.pair.settle()); };
  const join = () => {
    const pair = createLoopbackPair(); session.addConnection(pair.a, now);
    const net = new NetClient(pair.b, `person-${clients.length}`);
    clients.push({ net, pair }); net.join(); settle(); return { net, pair };
  };
  const step = () => { now += TICK_SECONDS * 1000; settle(); session.step(now); settle(); };
  return { session, saved, saves, join, step, settle };
}

describe('a real NetClient waits for the host restore decision (U-143)', () => {
  it('withholds cache selection and cancellation traffic until the restore gate clears', () => {
    const r = room(false, true); const host = r.join(); r.step();
    expect(host.net.restoreChoice).not.toBeNull();
    const sent = host.pair.b.sent.length;
    host.net.selectSupply('medical', { kind: 'health-kit' });
    host.net.selectSupply('medical', null);
    r.settle();
    expect(host.pair.b.sent).toHaveLength(sent);
    expect(host.net.supplyProgress).toEqual([]);
    expect(r.saves).toHaveLength(0);
  });

  it('refuses forged cache requests without advancing or rewriting the incompatible checkpoint', () => {
    const r = room(false, true); const host = r.join();
    host.pair.b.send(encodeMessage({ kind: 'SupplySelect', requestId: 1, cacheId: 'medical', item: { kind: 'health-kit' } }));
    for (let tick = 1; tick <= 35; tick++) {
      host.pair.b.send(encodeMessage({ kind: 'Input', tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0b1000 }));
      r.step();
    }
    expect(r.session.tick).toBe(0);
    expect(host.net.supplyProgress).toEqual([]);
    expect(host.net.supplyCaches[0]!.stock.healthKits).toBe(2);
    expect(r.saves).toHaveLength(0);
    expect(r.saved.checkpoint!.world).toMatchObject({ caches: [{ id: 'medical', stock: { healthKits: 1 } }] });
  });

  it('restarts with authored caches, then preserves paired finite stock and inventory through retry and JSON reload', () => {
    const r = room(false, true); const host = r.join();
    host.net.restartMission(true); r.settle();
    expect(host.net.restoreChoice).toBeNull();
    expect(host.net.supplyCaches[0]!.stock.healthKits).toBe(2);
    const slot = r.session.slots[host.net.slot]!;
    slot.state = createMoveState(10, 0, 9); slot.kits = 0;
    host.net.selectSupply('medical', { kind: 'health-kit' });
    for (let tick = 1; tick <= 30; tick++) {
      host.pair.b.send(encodeMessage({ kind: 'Input', tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0b1000 }));
      r.step();
    }
    expect(slot.kits).toBe(1);
    expect(host.net.supplyCaches[0]!.stock.healthKits).toBe(1);
    (r.session as unknown as { captureMissionCheckpoint(): void }).captureMissionCheckpoint();
    const saved = JSON.parse(JSON.stringify(r.saves.at(-1))) as CampaignState;
    host.net.selectSupply('medical', { kind: 'health-kit' });
    for (let tick = 31; tick <= 60; tick++) {
      host.pair.b.send(encodeMessage({ kind: 'Input', tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0b1000 }));
      r.step();
    }
    expect(slot.kits).toBe(2);
    expect(host.net.supplyCaches[0]!.stock.healthKits).toBe(0);
    r.session.retryMission(true); r.settle();
    expect(slot.kits).toBe(1);
    expect(host.net.supplyCaches[0]!.stock.healthKits).toBe(1);
    const restored = new Session(undefined, '', world, { mission, encounter, events, campaignDef, loadouts: 'class', campaign: saved });
    const pair = createLoopbackPair(); restored.addConnection(pair.a, 0);
    const net = new NetClient(pair.b, 'reloaded'); net.join(); pair.settle();
    expect(net.restoreChoice).toBeNull();
    expect(net.supplyCaches[0]!.stock.healthKits).toBe(1);
    expect(restored.slots[0]!.kits).toBe(1);
  });

  it.each([false, true])('receives the exact choice, blocks prediction and gameplay traffic, and resumes only after host restart (legacy=%s)', (legacy) => {
    const r = room(legacy); const host = r.join(); const other = r.join(); r.step();
    expect(host.net.restoreChoice).toMatchObject({ host: 0, restart: legacy ? 'legacy' : 'original' });
    expect(other.net.restoreChoice).toEqual(host.net.restoreChoice);
    expect(restoreChoiceModel(host.net.restoreChoice, host.net.runOffer, host.net.slot, 'owner', campaignDef)!.message).toBe(RESTORE_MAP_CHANGED_MESSAGE);
    const before = host.net.simulated;
    const traffic = host.pair.b.sent.length;
    host.net.tick(1, { moveX: 1, moveY: 1, yaw: 200, jump: true, sprint: true, crouch: false }, 100);
    host.net.fire(1, 0, 0, 0, true); host.net.throwProjectile(1, 0, 0, 0); host.net.equip(1); host.net.reload();
    r.step();
    expect(host.net.simulated).toEqual(before);
    expect(host.pair.b.sent).toHaveLength(traffic);
    // A forged Input cannot bypass the authoritative stop either.
    other.pair.b.send(encodeMessage({ kind: 'Input', tick: 10, moveX: 1, moveY: 1, yaw: 900, pitch: 0, buttons: 255 }));
    other.net.restartMission(true); r.step();
    expect(r.session.tick).toBe(0);
    expect(r.session.slots[other.net.slot]!.queue).toHaveLength(0);
    expect(r.saves).toHaveLength(0);
    host.net.restartMission(true); r.step();
    expect(host.net.restoreChoice).toBeNull(); expect(other.net.restoreChoice).toBeNull();
    expect(r.session.started).toBe(true);
    const input = { moveX: 1, moveY: 0, yaw: 0, jump: false, sprint: false, crouch: false };
    host.net.tick(20, input, 0); r.step();
    expect(host.pair.b.sent.map((packet) => decodeMessage(packet.data)).some((message) => message.kind === 'Input')).toBe(true);
    expect(r.session.slots[host.net.slot]!.lastProcessedInputTick).toBe(20);
  });

  it('uses the same host-validated mission select and preserves the refused checkpoint', () => {
    const r = room(); const host = r.join(); const other = r.join();
    other.net.chooseRun('replay', 'earlier'); r.settle(); expect(r.saves).toHaveLength(0);
    host.net.chooseRun('campaign', 'unoffered'); r.settle(); expect(r.saves).toHaveLength(0);
    host.net.chooseRun('replay', 'earlier'); r.settle();
    expect(r.saves.at(-1)).toMatchObject({ world: 'earlier', run: 'replay' });
    expect(r.saves.at(-1)!.checkpoint).toEqual(r.saved.checkpoint);
    const sent: Message[] = host.pair.a.sent.map((packet) => decodeMessage(packet.data));
    expect(sent.filter((message) => message.kind === 'Handoff')).toEqual([{ kind: 'Handoff', mission: 'earlier', run: 'replay' }]);
  });

  it('forgets the gate on transport reset so the new room can supply its own decision', () => {
    const r = room(); const host = r.join(); expect(host.net.restoreChoice).not.toBeNull();
    host.net.resetForRejoin(); expect(host.net.restoreChoice).toBeNull();
  });
});
