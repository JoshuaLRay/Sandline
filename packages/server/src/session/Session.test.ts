import { describe, expect, it } from 'vitest';
import {
  ClientConnection,
  MAX_SLOTS,
  NetSim,
  PROTOCOL_VERSION,
  SnapshotStore,
  type WorldSnapshot,
  createLoopbackPair,
  decodeMessage,
} from '@sandline/shared';
import { Session } from './Session.ts';

/** A minimal in-process client: handshake, then drive inputs. */
function connectClient(session: Session, name: string, now = 0) {
  const pair = createLoopbackPair();
  session.addConnection(pair.a, now);
  const snapshots: WorldSnapshot[] = [];
  const store = new SnapshotStore();
  let joined: { netId: number; slot: number } | null = null;
  let closedReason: string | null = null;

  const client = new ClientConnection(pair.b, {
    onJoinAck: (netId, slot) => {
      joined = { netId, slot };
    },
    onClosed: (reason) => {
      closedReason = reason;
    },
  });

  // The session broadcasts deltas, so the client resolves them against its own
  // baseline history exactly as a real client does.
  pair.b.onMessage((bytes) => {
    let msg;
    try {
      msg = decodeMessage(bytes);
    } catch {
      return;
    }
    if (msg.kind !== 'Delta') return;
    const res = store.applyDelta(msg.tick, msg.baselineTick, msg.payload);
    if (res.ok && res.snapshot) snapshots.push(res.snapshot);
  });

  client.join(name);
  pair.settle();

  return {
    pair,
    client,
    snapshots,
    store,
    get joined() {
      return joined as { netId: number; slot: number } | null;
    },
    get closedReason() {
      return closedReason as string | null;
    },
    input(tick: number, moveX: number, moveY: number, yaw = 0, buttons = 0) {
      client.send({ kind: 'Input', tick, moveX, moveY, yaw, pitch: 0, buttons });
      pair.settle();
    },
    ack(tick: number) {
      client.send({ kind: 'Ack', tick });
      pair.settle();
    },
  };
}

describe('Session lifecycle (T-1.09, T-1.13)', () => {
  it('starts with six bot-filled slots before anyone connects', () => {
    // ADR-001: the squad exists at every player count, including zero.
    const s = new Session();
    expect(s.slots).toHaveLength(MAX_SLOTS);
    expect(s.stats.bots).toBe(MAX_SLOTS);
    expect(s.stats.players).toBe(0);
  });

  it('gives every slot a distinct netId', () => {
    const ids = new Set(new Session().slots.map((s) => s.netId));
    expect(ids.size).toBe(MAX_SLOTS);
  });

  it('completes a handshake and assigns a slot', () => {
    const s = new Session();
    const c = connectClient(s, 'alpha');
    expect(c.joined).not.toBeNull();
    expect(c.joined?.slot).toBe(0);
    expect(s.stats.players).toBe(1);
    expect(s.stats.bots).toBe(MAX_SLOTS - 1);
  });

  // The load-bearing property of ADR-001: joining swaps a bot for a human on
  // the SAME entity. No spawn, no despawn, no change in world shape.
  it('a joining player takes over a bot entity in place', () => {
    const s = new Session();
    const netIdsBefore = s.slots.map((x) => x.netId);
    const c = connectClient(s, 'alpha');
    expect(s.slots.map((x) => x.netId)).toEqual(netIdsBefore);
    expect(c.joined?.netId).toBe(netIdsBefore[0]);
    s.step(0);
    c.pair.settle();
    expect(c.snapshots.at(-1)?.entities).toHaveLength(MAX_SLOTS);
  });

  it('a leaving player hands the entity back to a bot, keeping its position', () => {
    const s = new Session();
    const c = connectClient(s, 'alpha');
    c.input(1, 1, 1, 0);
    for (let i = 0; i < 10; i++) s.step(i * 33);
    const movedX = s.slots[0]!.state.x;

    c.pair.b.close('left');
    c.pair.settle();

    expect(s.stats.players).toBe(0);
    expect(s.stats.bots).toBe(MAX_SLOTS);
    expect(s.slots[0]!.state.x).toBe(movedX);
    expect(s.slots[0]!.netId).toBe(c.joined?.netId);
  });

  it('fills all six slots and then rejects the seventh with a reason', () => {
    const s = new Session();
    const clients = Array.from({ length: MAX_SLOTS }, (_, i) => connectClient(s, `p${i}`));
    expect(s.stats.players).toBe(MAX_SLOTS);
    expect(new Set(clients.map((c) => c.joined?.slot)).size).toBe(MAX_SLOTS);

    const seventh = connectClient(s, 'overflow');
    expect(seventh.joined).toBeNull();
    expect(seventh.closedReason).toMatch(/session full/);
  });

  it('rejects a client speaking a different protocol version', () => {
    const s = new Session();
    const pair = createLoopbackPair();
    s.addConnection(pair.a, 0);
    let reason: string | null = null;
    const client = new ClientConnection(pair.b, { onClosed: (r) => (reason = r) });
    client.send({ kind: 'Join', version: PROTOCOL_VERSION + 9, name: 'stale-build' });
    pair.settle();
    expect(reason).toMatch(/version mismatch/);
    expect(s.stats.players).toBe(0);
  });

  it('disconnects a peer sending garbage rather than crashing', () => {
    const s = new Session();
    const pair = createLoopbackPair();
    s.addConnection(pair.a, 0);
    let reason: string | null = null;
    new ClientConnection(pair.b, { onClosed: (r) => (reason = r) });
    pair.b.send(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
    pair.settle();
    expect(reason).toBeTruthy();
    expect(s.stats.players).toBe(0);
  });

  it('drops a peer that goes quiet past the heartbeat timeout', () => {
    const s = new Session();
    const c = connectClient(s, 'ghost', 0);
    expect(s.stats.players).toBe(1);
    s.step(1000);
    expect(s.stats.players).toBe(1);
    s.step(6000); // past HEARTBEAT_TIMEOUT_MS
    c.pair.settle();
    expect(s.stats.players).toBe(0);
    expect(c.closedReason).toMatch(/heartbeat/);
  });
});

describe('tick loop (T-1.13)', () => {
  it('advances one tick per step', () => {
    const s = new Session();
    for (let i = 1; i <= 10; i++) {
      s.step(i * 33);
      expect(s.tick).toBe(i);
    }
  });

  it('moves a player according to their input', () => {
    const s = new Session();
    const c = connectClient(s, 'mover');
    const startZ = s.slots[0]!.state.z;
    c.input(1, 0, 1, 0); // full forward, yaw 0
    for (let i = 0; i < 30; i++) {
      s.step(i * 33);
      c.input(i + 2, 0, 1, 0);
    }
    expect(s.slots[0]!.state.z).toBeGreaterThan(startZ + 3);
  });

  it('leaves bot slots stationary with no input', () => {
    const s = new Session();
    const before = s.slots.map((x) => x.state.x);
    for (let i = 0; i < 60; i++) s.step(i * 33);
    expect(s.slots.map((x) => x.state.x)).toEqual(before);
  });

  // ADR-012: repeat a missing input briefly, then idle. Without the cap a
  // player whose connection stalls mid-sprint runs forever.
  it('consumes each input once and then holds, rather than repeating it', () => {
    /**
     * ADR-012 originally said to repeat a missing input for a few ticks. Its
     * addendum replaced that with holding still, because horizontal motion here
     * is driven directly by input: an idle step moves the player almost
     * nowhere, while a repeated step moves them a full tick's worth that their
     * own client never predicted and must then be yanked back from.
     *
     * So one input buys exactly one tick of movement. Measured against the
     * spawn rather than against zero, since spawns are data and have moved once
     * already.
     */
    const s = new Session();
    const c = connectClient(s, 'stalled');
    const startZ = s.slots[0]!.state.z;
    c.input(1, 0, 1, 0);

    s.step(33);
    const afterOne = s.slots[0]!.state.z - startZ;
    expect(afterOne, 'the single input was consumed').toBeGreaterThan(0);

    // Nothing further arrives. The player must not keep travelling.
    for (let i = 2; i < 60; i++) s.step(i * 33);
    const afterSilence = s.slots[0]!.state.z - startZ;
    expect(afterSilence - afterOne, 'no coasting on a repeated input').toBeLessThan(0.01);
  });

  // The plan's stated acceptance criterion for T-1.13.
  it('runs 300 ticks with two clients and drops no snapshots', () => {
    const s = new Session();
    const a = connectClient(s, 'alpha');
    const b = connectClient(s, 'bravo');

    for (let tick = 1; tick <= 300; tick++) {
      a.input(tick, 0, 1, 0);
      b.input(tick, 1, 0, 256);
      s.step(tick * 33);
      a.pair.settle();
      b.pair.settle();
      a.ack(s.tick);
      b.ack(s.tick);
    }

    expect(s.tick).toBe(300);
    expect(a.snapshots).toHaveLength(300);
    expect(b.snapshots).toHaveLength(300);
    // Ticks arrive in order with no gaps.
    expect(a.snapshots.map((x) => x.tick)).toEqual(Array.from({ length: 300 }, (_, i) => i + 1));
    for (const snap of a.snapshots) expect(snap.entities).toHaveLength(MAX_SLOTS);
  });

  it('shrinks its per-client payload once a client starts acking', () => {
    const s = new Session();
    const c = connectClient(s, 'acker');
    for (let i = 0; i < 10; i++) s.step(i * 33); // never acks
    const unacked = s.stats.bytesSent / s.stats.snapshotsSent;

    const s2 = new Session();
    const c2 = connectClient(s2, 'acker');
    for (let i = 0; i < 10; i++) {
      s2.step(i * 33);
      c2.pair.settle();
      c2.ack(s2.tick);
    }
    const acked = s2.stats.bytesSent / s2.stats.snapshotsSent;

    expect(acked).toBeLessThan(unacked);
    void c;
  });

  it('keeps serving clients under simulated latency and loss', () => {
    const s = new Session();
    const pair = createLoopbackPair();
    const lossy = new NetSim(pair.a, { latencyMs: 80, jitterMs: 20, lossRate: 0.2, seed: 7 });
    s.addConnection(lossy, 0);

    const snapshots: WorldSnapshot[] = [];
    const client = new ClientConnection(pair.b, { onSnapshot: (m) => snapshots.push(m.snapshot) });
    client.join('laggy');
    pair.settle();

    for (let tick = 1; tick <= 60; tick++) {
      s.step(tick * 33);
      lossy.pump(tick * 33);
      pair.settle();
    }
    // Unreliable snapshots are lossy by design; the session must keep running.
    expect(s.tick).toBe(60);
    expect(lossy.stats.sent).toBeGreaterThan(0);
  });

  it('closes every connection when the session ends', () => {
    const s = new Session();
    const a = connectClient(s, 'a');
    const b = connectClient(s, 'b');
    s.close('server shutting down');
    a.pair.settle();
    b.pair.settle();
    expect(a.closedReason).toMatch(/shutting down/);
    expect(b.closedReason).toMatch(/shutting down/);
  });
});
