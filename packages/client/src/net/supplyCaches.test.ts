/** U-133: the actual browser network client on the authoritative host, without a renderer. */
import { describe, expect, it } from 'vitest';
import {
  createLoopbackPair, createMoveState, decodeMessage, encodeMessage, parseEncounter, parseEventScript, requireWorld,
  TICK_SECONDS, type MissionDef,
} from '@sandline/shared';
import { Session, type SessionOptions } from '@sandline/server/session';
import { NetClient } from './NetClient.ts';

type CampaignState = NonNullable<SessionOptions['campaign']>;

const world = requireWorld('greybox-01');
const encounter = parseEncounter({ world: world.id, aliveCap: 4, probes: [1], areas: {}, groups: [
  { id: 'unused', members: [{ archetype: 'rifleman', count: 1 }], zone: 'behind-objective', posture: { kind: 'hold' }, trigger: { kind: 'script' } },
] });
const mission: MissionDef = { id: 'client-supplies', world: world.id, respawn: false, objectives: [{ type: 'survive', label: 'Wait', seconds: 1000 }] };
const script = parseEventScript({ world: world.id, blockers: [], events: [], supplyCaches: [
  { id: 'medical', feet: { x: 10, y: 0, z: 10 }, stock: { healthKits: 2, primaryMagazines: 2, projectiles: { rocket: 3 } } },
  { id: 'exhausted', feet: { x: -25, y: 0, z: 0 }, stock: {} },
] }, encounter, world, mission);
const E = 0b1000;

function room(campaign?: CampaignState) {
  const saves: CampaignState[] = [];
  const session = new Session(undefined, '', world, { encounter, mission, events: script, loadouts: 'class',
    ...(campaign ? { campaign } : {}), onCampaignSave: (s) => saves.push(s),
  });
  let now = 0; let tick = 0;
  const players: { net: NetClient; pair: ReturnType<typeof createLoopbackPair>; buttons: number }[] = [];
  const settle = () => players.forEach((p) => p.pair.settle());
  const join = (resume = '') => {
    const pair = createLoopbackPair(); session.addConnection(pair.a, now);
    const net = new NetClient(pair.b, `p${players.length}`);
    const p = { net, pair, buttons: 0 }; players.push(p); net.join('', '', '', resume); settle(); return p;
  };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      now += TICK_SECONDS * 1000; tick++;
      for (const p of players) if (p.pair.b.isOpen) p.pair.b.send(encodeMessage({ kind: 'Input', tick, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: p.buttons }));
      settle(); session.step(now); settle();
    }
  };
  const place = (p: ReturnType<typeof join>) => { session.slots[p.net.slot]!.state = createMoveState(10, 0, 9); };
  return { session, join, step, place, settle, saves };
}

describe('headless NetClient cache state (U-133)', () => {
  it('receives stock/feet, progress and paired inventory changes while retaining all exhausted caches', () => {
    const r = room(); const a = r.join(); const b = r.join(); r.place(a);
    const s = r.session.slots[a.net.slot]!; s.kits = 0; r.step();
    expect(a.net.supplyCaches).toEqual(r.session.supplyCaches);
    expect(a.net.pickups()).toEqual([]);
    a.net.selectSupply('medical', { kind: 'health-kit' }); r.settle(); a.buttons = E;
    r.step(29); expect(a.net.kits).toBe(0); expect(a.net.supplyProgress[0]?.percent).toBe(96);
    r.step(); expect(a.net.kits).toBe(1); expect(a.net.supplyProgress).toEqual([]);
    expect(a.net.supplyCaches.find((c) => c.id === 'medical')!.stock.healthKits).toBe(1);
    expect(b.net.supplyCaches).toEqual(a.net.supplyCaches);
    expect(a.net.supplyCaches.find((c) => c.id === 'exhausted')!.stock).toEqual({ projectiles: {}, healthKits: 0, primaryAmmoUnits: 0 });
    a.net.selectSupply('medical', { kind: 'health-kit' }); r.settle(); r.step(30);
    expect(a.net.kits).toBe(2); expect(a.net.supplyCaches.find((c) => c.id === 'medical')!.stock.healthKits).toBe(0);
    expect(a.net.supplyCaches).toHaveLength(2); expect(a.net.pickups()).toEqual([]);
  });

  it('disconnects a client forging server-owned stock without changing authoritative supplies', () => {
    const r = room(); const p = r.join();
    p.pair.b.send(encodeMessage({ kind: 'Supplies', full: true, caches: [] })); r.settle();
    expect(p.net.disconnectCode).toBe('protocol error');
    expect(r.session.supplyCaches).toEqual(script.supplyCaches);
  });

  it('refuses incompatible and stale selections without time or stock cost', () => {
    const r = room(); const p = r.join(); r.place(p); const s = r.session.slots[p.net.slot]!; s.kits = 0;
    p.net.selectSupply('medical', { kind: 'projectile', projectile: 'rocket' }); r.settle(); p.buttons = E; r.step(30);
    expect(p.net.supplyProgress).toEqual([]); expect(p.net.supplyCaches).toHaveLength(2); expect(s.pouch[1]).toBe(0);
    p.net.selectSupply('medical', { kind: 'health-kit' }); r.settle(); r.step(30); expect(s.kits).toBe(1); s.kits = 0;
    p.pair.b.send(encodeMessage({ kind: 'SupplySelect', requestId: 2, cacheId: 'medical', item: { kind: 'health-kit' } })); r.settle(); r.step(30);
    expect(p.net.kits).toBe(0); expect(p.net.supplyCaches.find((c) => c.id === 'medical')!.stock.healthKits).toBe(1);
  });

  it('clears local state for rejoin, receives spent stock and never resumes a disconnected hold', () => {
    const r = room(); const a = r.join(); r.join(); r.place(a); const s = r.session.slots[a.net.slot]!; s.kits = 0;
    a.net.selectSupply('medical', { kind: 'health-kit' }); r.settle(); a.buttons = E; r.step(30);
    a.net.selectSupply('medical', { kind: 'health-kit' }); r.settle(); r.step(15);
    const resume = a.net.resumeToken; a.net.resetForRejoin(); expect(a.net.supplyCaches).toEqual([]); expect(a.net.supplyProgress).toEqual([]);
    a.pair.b.close('network lost'); const back = r.join(resume); r.step();
    expect(back.net.slot).toBe(0); expect(back.net.kits).toBe(1);
    expect(back.net.supplyCaches.find((c) => c.id === 'medical')!.stock.healthKits).toBe(1);
    expect(back.net.supplyProgress).toEqual([]); back.buttons = E; r.step(30); expect(back.net.kits).toBe(1);
  });

  it('shows restored stock and inventory together on checkpoint retry and JSON host reload', () => {
    const r = room(); const a = r.join(); r.place(a); const s = r.session.slots[0]!; s.kits = 0;
    a.net.selectSupply('medical', { kind: 'health-kit' }); r.settle(); a.buttons = E; r.step(30);
    (r.session as unknown as { captureMissionCheckpoint(): void }).captureMissionCheckpoint();
    const save = JSON.parse(JSON.stringify(r.saves.at(-1))) as CampaignState;
    a.net.selectSupply('medical', { kind: 'health-kit' }); r.settle(); r.step(30);
    expect(a.net.kits).toBe(2);
    r.session.retryMission(true); r.step(); expect(a.net.kits).toBe(1);
    expect(a.net.supplyCaches.find((c) => c.id === 'medical')!.stock.healthKits).toBe(1);
    const restored = room(save); const b = restored.join(); restored.step();
    expect(b.net.kits).toBe(1); expect(b.net.supplyCaches).toEqual(a.net.supplyCaches); expect(b.net.supplyProgress).toEqual([]);
    restored.session.restartMission(); restored.step(); expect(b.net.kits).toBe(3);
    expect(b.net.supplyCaches.find((c) => c.id === 'medical')!.stock.healthKits).toBe(2);
  });

  it('sends incremental stock once per completion, with no stock traffic during a timed hold', () => {
    const r = room(); const a = r.join(); r.place(a); r.session.slots[0]!.kits = 0;
    const before = a.pair.a.sent.length; a.net.selectSupply('medical', { kind: 'health-kit' }); r.settle(); a.buttons = E; r.step(30);
    // Count actual server datagrams; progress and snapshots cannot hide a full stock resend.
    const messages = a.pair.a.sent.slice(before).map((p) => p.data);
    const supplies = messages.map(decodeMessage).filter((m) => m.kind === 'Supplies');
    expect(supplies).toHaveLength(1); expect(supplies[0]).toMatchObject({ full: false, caches: [{ id: 'medical' }] });
  });
});
