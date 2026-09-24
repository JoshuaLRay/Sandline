/**
 * What the client does with a projectile and a blast (T-2.32, T-2.33).
 *
 * Driven by handing the client the exact bytes a server would send, because
 * both behaviours here are about TIMING against the interpolation delay, and
 * neither is visible from either end on its own: a projectile must go into its
 * own list rather than the soldiers', and a blast must wait until the render
 * clock reaches the tick it happened on.
 */
import { describe, expect, it } from 'vitest';
import {
  BitWriter,
  COMPONENT_IDS,
  INTERPOLATION_DELAY_MS,
  type Message,
  POSITION,
  TICK_SECONDS,
  VELOCITY,
  type WorldSnapshot,
  createLoopbackPair,
  decodeMessage,
  encodeMessage,
  quantize,
  requireWorld,
  writeDelta,
} from '@sandline/shared';
import { NetClient, type ServerDetonation, type ServerShot } from './NetClient.ts';

const TICK_MS = TICK_SECONDS * 1000;
const T = COMPONENT_IDS.Transform;
const V = COMPONENT_IDS.Velocity;

function projectileEntity(netId: number, x: number, y: number, z: number, kind = 0, ownerSlot = 3) {
  return {
    netId,
    components: {
      [T]: [quantize(x, POSITION), quantize(y, POSITION), quantize(z, POSITION), 0, 0],
      [V]: [quantize(0, VELOCITY), quantize(0, VELOCITY), quantize(12, VELOCITY)],
      [COMPONENT_IDS.Projectile]: [kind, ownerSlot],
    },
  };
}

function soldierEntity(netId: number) {
  return {
    netId,
    components: {
      [T]: [quantize(1, POSITION), quantize(0, POSITION), quantize(2, POSITION), 0, 0],
      [COMPONENT_IDS.PlayerSlot]: [1, 0],
    },
  };
}

/** A client fed raw messages, with no server on the other end. */
function fed() {
  const pair = createLoopbackPair();
  const net = new NetClient(pair.b, 'tester');
  const blasts: ServerDetonation[] = [];
  const shots: ServerShot[] = [];
  net.onDetonation = (event) => blasts.push(event);
  net.onShot = (event) => shots.push(event);
  return {
    net,
    blasts,
    shots,
    /** Deliver a full snapshot for `tick`, as a Delta with no baseline. */
    snapshot(tick: number, entities: WorldSnapshot['entities']): void {
      const w = new BitWriter();
      writeDelta(w, { tick, entities }, null);
      pair.a.send(
        encodeMessage({ kind: 'Delta', tick, baselineTick: null, lastProcessedInputTick: -1, payload: w.toUint8Array() }),
      );
      pair.settle();
    },
    detonation(tick: number, netId = 2001): void {
      pair.a.send(
        encodeMessage({ kind: 'Detonation', netId, projectile: 0, tick, x: 1, y: 0.2, z: 3, targets: [] }),
      );
      pair.settle();
    },
    hitEvent(overrides: Partial<Extract<Message, { kind: 'HitEvent' }>> = {}): void {
      pair.a.send(
        encodeMessage({
          kind: 'HitEvent',
          shooterNetId: 4,
          targetNetId: 0,
          x: 20,
          y: 1.5,
          z: 3,
          originX: 0,
          originY: 1.55,
          originZ: 0,
          damage: 0,
          ...overrides,
        }),
      );
      pair.settle();
    },
  };
}

describe('projectiles are not soldiers (T-2.32)', () => {
  it('goes into its own list, never the remote players', () => {
    const client = fed();
    client.snapshot(10, [soldierEntity(4), projectileEntity(2001, 1, 1.5, 3)]);
    client.net.advanceClock(TICK_MS);

    const projectiles = client.net.projectiles();
    expect(projectiles).toHaveLength(1);
    expect(projectiles[0]?.netId).toBe(2001);
    expect(projectiles[0]?.kind).toBe(0);
    expect(projectiles[0]?.ownerSlot).toBe(3);
    expect(projectiles[0]?.vz).toBeCloseTo(12, 1);

    // The renderer builds a humanoid, a pose driver and a foot solver for
    // everything `remotes()` returns; a grenade in there would get all three.
    const remotes = client.net.remotes();
    expect(remotes.has(2001)).toBe(false);
    expect(remotes.has(4)).toBe(true);
  });

  it('stops being drawn once the render clock passes the moment it vanished', () => {
    const client = fed();
    client.snapshot(10, [soldierEntity(4), projectileEntity(2001, 1, 1.5, 3)]);
    client.net.advanceClock(TICK_MS);
    expect(client.net.projectiles()).toHaveLength(1);

    // Gone from the world — but still in the air at the render time, which is
    // an interpolation delay behind, so it keeps being drawn for now.
    client.snapshot(11, [soldierEntity(4)]);
    client.net.advanceClock(TICK_MS);
    expect(client.net.projectiles()).toHaveLength(1);

    // Once the clock has caught up past the tick it vanished on, it is gone.
    for (let tick = 12; tick < 20; tick += 1) {
      client.snapshot(tick, [soldierEntity(4)]);
      client.net.advanceClock(TICK_MS);
    }
    expect(client.net.projectiles()).toHaveLength(0);
  });
});

describe('a blast waits for its tick (T-2.33)', () => {
  it('is not drawn on arrival, and is drawn exactly once when the clock reaches it', () => {
    const client = fed();
    // No snapshots, so the client's server clock is the one this test winds
    // forward a frame at a time.
    const tick = 30;
    client.detonation(tick);
    expect(client.blasts).toHaveLength(0);

    const dueAt = tick * TICK_MS + INTERPOLATION_DELAY_MS;
    let elapsed = 0;
    while (elapsed < dueAt - TICK_MS) {
      client.net.advanceClock(TICK_MS);
      elapsed += TICK_MS;
      expect(client.blasts).toHaveLength(0);
    }
    // Two more frames: one to arrive at the tick, one to prove it is not
    // redelivered on every frame after.
    client.net.advanceClock(TICK_MS);
    client.net.advanceClock(TICK_MS);
    client.net.advanceClock(TICK_MS);
    expect(client.blasts).toHaveLength(1);
    expect(client.blasts[0]?.netId).toBe(2001);
  });

  it('releases several blasts in the order they went off', () => {
    const client = fed();
    client.detonation(12, 2100);
    client.detonation(6, 2099);
    for (let i = 0; i < 40; i += 1) client.net.advanceClock(TICK_MS);
    expect(client.blasts.map((b) => b.netId)).toEqual([2099, 2100]);
  });

  it('forgets everything about a session it has left', () => {
    const client = fed();
    client.snapshot(10, [projectileEntity(2001, 1, 1.5, 3)]);
    client.detonation(300);
    client.net.resetForRejoin();
    for (let i = 0; i < 40; i += 1) client.net.advanceClock(TICK_MS);
    expect(client.net.projectiles()).toHaveLength(0);
    expect(client.blasts).toHaveLength(0);
  });
});

describe('a shot carries its own origin on the wire (B-01)', () => {
  it('hands the origin the server sent straight through, not something derived here', () => {
    /**
     * The regression this guards: the client used to have no origin of its
     * own for someone else's shot, and approximated one from their replicated
     * position at draw time — which drifts from the true muzzle by however
     * far a strafing shooter moved during the round trip and the
     * interpolation delay. The fix moves the origin onto the wire, computed
     * once by the server from the same rewound position it already traces
     * the shot from; this only has to prove the value survives encode/decode
     * and reaches `onShot` unchanged.
     */
    const client = fed();
    client.hitEvent({ shooterNetId: 4, targetNetId: 0, x: 20, y: 1.5, z: 3, originX: -6, originY: 1.5625, originZ: -2 });

    expect(client.shots).toHaveLength(1);
    expect(client.shots[0]).toMatchObject({ originX: -6, originY: 1.5625, originZ: -2 });
  });
});

describe('the session names its world (T-3.02)', () => {
  function acked(world: string) {
    const pair = createLoopbackPair();
    const net = new NetClient(pair.b, 'tester');
    const fromClient: Message[] = [];
    pair.a.onMessage((bytes) => fromClient.push(decodeMessage(bytes)));
    const refusals: { reason: string; code: string }[] = [];
    let joined = 0;
    net.onJoined = () => joined++;
    net.onDisconnect = (reason, code) => refusals.push({ reason, code });
    pair.a.send(encodeMessage({ kind: 'JoinAck', netId: 7, slot: 2, serverTick: 0, room: 'K7PM', world, resume: '', resumed: false }));
    pair.settle();
    return { net, fromClient, refusals, joined: () => joined };
  }

  it('builds the named world from the same data and joins', () => {
    const { net, refusals, joined } = acked('range');
    expect(net.joined).toBe(true);
    expect(joined()).toBe(1);
    expect(refusals).toEqual([]);
    expect(net.world?.id).toBe('range');
    expect(net.world?.boxes).toBe(requireWorld('range').boxes);
  });

  it('refuses a world this build does not have, typed, rather than render the wrong scenery', () => {
    const { net, fromClient, refusals, joined } = acked('atlantis');
    expect(net.joined).toBe(false);
    expect(joined()).toBe(0);
    expect(net.world).toBeNull();
    expect(refusals).toHaveLength(1);
    expect(refusals[0]!.code).toBe('unknown world');
    expect(refusals[0]!.reason).toMatch(/atlantis/);
    // The host is told why, with the same code, rather than seeing a silent drop.
    const bye = fromClient.find((m) => m.kind === 'Disconnect');
    expect(bye).toMatchObject({ kind: 'Disconnect', code: 'unknown world' });
  });
});

describe('the resume token (T-4.18)', () => {
  it('keeps the seat token across a rejoin reset, and offers it in the next Join', () => {
    const pair = createLoopbackPair();
    const net = new NetClient(pair.b, 'tester');
    const fromClient: Message[] = [];
    pair.a.onMessage((bytes) => fromClient.push(decodeMessage(bytes)));
    const token = '0123456789abcdef0123456789abcdef';
    pair.a.send(encodeMessage({ kind: 'JoinAck', netId: 7, slot: 2, serverTick: 0, room: 'K7PM', world: 'range', resume: token, resumed: false }));
    pair.settle();
    expect(net.resumeToken).toBe(token);
    expect(net.resumed).toBe(false);
    net.resetForRejoin();
    expect(net.resumeToken).toBe(token);
    net.join('K7PM', '', '', net.resumeToken);
    pair.settle();
    expect(fromClient.find((m) => m.kind === 'Join')).toMatchObject({ room: 'K7PM', resume: token });
    pair.a.send(encodeMessage({ kind: 'JoinAck', netId: 7, slot: 2, serverTick: 90, room: 'K7PM', world: 'range', resume: 'f'.repeat(32), resumed: true }));
    pair.settle();
    expect(net.resumed).toBe(true);
    expect(net.resumeToken).toBe('f'.repeat(32));
  });
});
