import { describe, expect, it } from 'vitest';
import {
  createLoopbackPair, decodeMessage, encodeMessage, parseCampaign, parseEncounter,
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

function room(legacy = false) {
  const original: CampaignState = { formatVersion: 1, world: world.id, completedMissions: ['earlier'], checkpoint: null,
    soldiers: Array.from({ length: 6 }, (_, slot) => ({ slot, classId: '', xp: 0, rank: 0 })) };
  let saved = original;
  const initial = new Session(undefined, '', world, { mission, encounter, loadouts: 'class', campaign: original, onCampaignSave: (s) => { saved = s; } });
  (initial as unknown as { captureMissionCheckpoint(): void }).captureMissionCheckpoint();
  saved = structuredClone(saved);
  saved.checkpoint!.mapRevision = 1;
  if (legacy) delete saved.checkpoint!.missionStart;
  const saves: CampaignState[] = [];
  const session = new Session(undefined, '', world, { mission, encounter, campaignDef, loadouts: 'class', campaign: saved,
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
