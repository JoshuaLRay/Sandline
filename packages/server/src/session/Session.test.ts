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

describe('Session — a slot reused by a different client (T-1.5.02)', () => {
  /**
   * The failure this pins only exists on a long-lived host. Every in-page
   * session was built fresh per page load, so a slot had never been occupied by
   * two different clients until `SessionHost` (T-1.5.01) made one process
   * outlive its players.
   */
  it('accepts the new occupant\'s inputs even though they restart their tick count', () => {
    const s = new Session();
    const first = connectClient(s, 'first');
    expect(first.joined?.slot).toBe(0);

    /**
     * Play out a long session and let the server CONSUME all of it, so the slot
     * is left with an empty queue and a high water mark. Leaving inputs queued
     * would move the entity on its own and the assertions below would pass
     * without the new client's inputs ever being accepted — which is exactly
     * how the first version of this test managed to pass against the bug.
     */
    let now = 0;
    for (let tick = 1; tick <= 120; tick++) {
      first.input(tick, 0, 1);
      now += 33;
      s.step(now);
    }
    expect(s.slots[0]!.queue).toHaveLength(0);
    expect(s.slots[0]!.newestInputTick).toBe(120);
    const leftAt = s.slots[0]!.state.z;
    first.pair.b.close('gone');

    // Someone else sits down in the same slot and counts from 1, as every
    // client does — their page just loaded.
    const second = connectClient(s, 'second');
    expect(second.joined?.slot).toBe(0);
    for (let tick = 1; tick <= 10; tick++) {
      second.input(tick, 0, 1);
      now += 33;
      s.step(now);
    }

    // The mark of the bug: every one of those ten inputs sits at or below the
    // departed player's 120, so the ordering guard discards them all.
    expect(s.slots[0]!.lastProcessedInputTick).toBeGreaterThan(0);
    expect(s.slots[0]!.lastProcessedInputTick).toBeLessThanOrEqual(10);
    expect(s.slots[0]!.state.z).not.toBeCloseTo(leftAt, 2);
  });

  it('does not ask the new occupant to reconcile against the old one\'s ticks', () => {
    const s = new Session();
    const first = connectClient(s, 'first');
    for (let tick = 1; tick <= 50; tick++) first.input(tick, 0, 1);
    s.step(16);
    expect(s.slots[0]!.lastProcessedInputTick).toBeGreaterThan(0);
    first.pair.b.close('gone');

    // A stale ack would send the new client reconciling against a tick it never
    // predicted, which snaps it and discards every pending prediction.
    const second = connectClient(s, 'second');
    expect(second.joined?.slot).toBe(0);
    expect(s.slots[0]!.lastProcessedInputTick).toBe(-1);
    expect(s.slots[0]!.newestInputTick).toBe(-1);
  });

  it('does not let a bot walk out the inputs of the player who left', () => {
    const s = new Session();
    const c = connectClient(s, 'leaver');
    for (let tick = 1; tick <= 20; tick++) c.input(tick, 0, 1);
    c.pair.b.close('gone');
    expect(s.slots[0]!.isBot).toBe(true);
    expect(s.slots[0]!.queue).toHaveLength(0);
  });
});

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
    expect(seventh.closedReason).toMatch(/room full/);
  });

  it('rejects a client speaking a different protocol version', () => {
    const s = new Session();
    const pair = createLoopbackPair();
    s.addConnection(pair.a, 0);
    let reason: string | null = null;
    const client = new ClientConnection(pair.b, { onClosed: (r) => (reason = r) });
    client.send({ kind: 'Join', version: PROTOCOL_VERSION + 9, name: 'stale-build', room: '' });
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


describe('Session revive interaction (T-2.15)', () => {
  it('requires held E, locks the first reviver, advances progress, and revives after the configured hold', () => {
    const s = new Session();
    const reviver = connectClient(s, 'reviver');
    const target = connectClient(s, 'target');
    const targetSlot = s.slots[target.joined!.slot]!;
    const reviverSlot = s.slots[reviver.joined!.slot]!;

    // Put the target down and place both soldiers together for the range check.
    targetSlot.health.current = 0;
    targetSlot.health.downedAt = 0;
    targetSlot.state.x = reviverSlot.state.x;
    targetSlot.state.y = reviverSlot.state.y;
    targetSlot.state.z = reviverSlot.state.z;

    let now = 0;
    for (let tick = 1; tick <= 45; tick++) {
      reviver.input(tick, 0, 0, 0, 0b1000);
      target.input(tick, 0, 0);
      now += 33;
      s.step(now);
    }

    expect(targetSlot.reviveByNetId).toBe(reviverSlot.netId);
    expect(targetSlot.reviveProgressSeconds).toBeGreaterThan(1.4);
    expect(target.snapshots.at(-1)?.entities.find((e) => e.netId === targetSlot.netId)?.components[2]?.[4]).toBeGreaterThan(45);

    // Keep holding through the configured 3-second interaction.
    for (let tick = 46; tick <= 90; tick++) {
      reviver.input(tick, 0, 0, 0, 0b1000);
      target.input(tick, 0, 0);
      now += 33;
      s.step(now);
    }

    expect(targetSlot.health.current).toBeGreaterThan(0);
    expect(targetSlot.health.downedAt).toBeNull();
    expect(targetSlot.reviveByNetId).toBe(0);
    expect(targetSlot.reviveProgressSeconds).toBe(0);
  });

  it('releases the revive lock when E is released and allows another teammate to take it', () => {
    const s = new Session();
    const first = connectClient(s, 'first');
    const second = connectClient(s, 'second');
    const target = connectClient(s, 'target');
    const targetSlot = s.slots[target.joined!.slot]!;
    for (const slot of [s.slots[first.joined!.slot]!, s.slots[second.joined!.slot]!]) {
      slot.state.x = targetSlot.state.x;
      slot.state.y = targetSlot.state.y;
      slot.state.z = targetSlot.state.z;
    }
    targetSlot.health.current = 0;
    targetSlot.health.downedAt = 0;

    first.input(1, 0, 0, 0, 0b1000);
    second.input(1, 0, 0, 0, 0b1000);
    target.input(1, 0, 0);
    s.step(33);
    expect(targetSlot.reviveByNetId).toBe(s.slots[first.joined!.slot]!.netId);

    first.input(2, 0, 0);
    second.input(2, 0, 0, 0, 0b1000);
    target.input(2, 0, 0);
    s.step(66);
    expect(targetSlot.reviveByNetId).toBe(s.slots[second.joined!.slot]!.netId);
  });
});
