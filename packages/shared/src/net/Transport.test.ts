import { describe, expect, it } from 'vitest';
import { NetSim } from './NetSim.ts';
import { ClockSync } from './clockSync.ts';
import { createLoopbackPair } from './Transport.ts';

describe('loopback transport (T-1.06)', () => {
  it('delivers a message from one end to the other', () => {
    const { a, b, pump } = createLoopbackPair();
    const got: Uint8Array[] = [];
    b.onMessage((d) => got.push(d));
    a.send(new Uint8Array([1, 2, 3]));
    pump();
    expect([...(got[0] as Uint8Array)]).toEqual([1, 2, 3]);
  });

  // Queued rather than synchronous delivery is deliberate: it makes tests
  // control exactly when messages land, and makes reentrancy impossible.
  it('does not deliver until pumped', () => {
    const { a, b, pump } = createLoopbackPair();
    let count = 0;
    b.onMessage(() => count++);
    a.send(new Uint8Array([1]));
    expect(count).toBe(0);
    pump();
    expect(count).toBe(1);
  });

  it('copies payloads so a caller reusing a buffer cannot corrupt them', () => {
    const { a, b, pump } = createLoopbackPair();
    const got: Uint8Array[] = [];
    b.onMessage((d) => got.push(d));
    const buf = new Uint8Array([7]);
    a.send(buf);
    buf[0] = 99; // caller mutates after sending
    pump();
    expect((got[0] as Uint8Array)[0]).toBe(7);
  });

  it('preserves order in each direction', () => {
    const { a, b, pump } = createLoopbackPair();
    const got: number[] = [];
    b.onMessage((d) => got.push(d[0] as number));
    for (let i = 0; i < 20; i++) a.send(new Uint8Array([i]));
    pump();
    expect(got).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('settles a request/response exchange in one call', () => {
    const { a, b, settle } = createLoopbackPair();
    b.onMessage(() => b.send(new Uint8Array([2])));
    const replies: number[] = [];
    a.onMessage((d) => replies.push(d[0] as number));
    a.send(new Uint8Array([1]));
    settle();
    expect(replies).toEqual([2]);
  });

  it('closes both ends and reports the reason', () => {
    const { a, b } = createLoopbackPair();
    let aReason = '';
    let bReason = '';
    a.onClose((r) => (aReason = r));
    b.onClose((r) => (bReason = r));
    a.close('bye');
    expect(a.isOpen).toBe(false);
    expect(b.isOpen).toBe(false);
    expect(aReason).toBe('bye');
    expect(bReason).toBe('bye');
  });

  it('treats close as idempotent', () => {
    const { a } = createLoopbackPair();
    let closes = 0;
    a.onClose(() => closes++);
    a.close();
    a.close();
    a.close();
    expect(closes).toBe(1);
  });

  it('silently drops sends after close instead of throwing', () => {
    const { a, b, pump } = createLoopbackPair();
    let count = 0;
    b.onMessage(() => count++);
    a.close();
    expect(() => a.send(new Uint8Array([1]))).not.toThrow();
    pump();
    expect(count).toBe(0);
  });
});

describe('NetSim (T-1.21)', () => {
  it('holds a message until its latency has elapsed', () => {
    const { a, b, pump } = createLoopbackPair();
    const sim = new NetSim(a, { latencyMs: 100, seed: 1 });
    const got: number[] = [];
    b.onMessage((d) => got.push(d[0] as number));

    sim.send(new Uint8Array([1]));
    sim.pump(50);
    pump();
    expect(got).toHaveLength(0);

    sim.pump(100);
    pump();
    expect(got).toHaveLength(1);
  });

  it('reports how much is still in flight', () => {
    const sim = new NetSim(createLoopbackPair().a, { latencyMs: 50, seed: 1 });
    sim.send(new Uint8Array([1]));
    sim.send(new Uint8Array([2]));
    expect(sim.inFlight).toBe(2);
    sim.pump(50);
    expect(sim.inFlight).toBe(0);
  });

  it('drops unreliable traffic at roughly the configured rate', () => {
    const sim = new NetSim(createLoopbackPair().a, { lossRate: 0.3, seed: 42 });
    for (let i = 0; i < 10_000; i++) sim.send(new Uint8Array([i & 0xff]), 'unreliable');
    const rate = sim.stats.dropped / sim.stats.sent;
    expect(rate).toBeGreaterThan(0.25);
    expect(rate).toBeLessThan(0.35);
  });

  // Modelling loss on a reliable channel would test a network we never have:
  // TCP would have retransmitted it.
  it('never drops reliable traffic', () => {
    const sim = new NetSim(createLoopbackPair().a, { lossRate: 0.9, seed: 42 });
    for (let i = 0; i < 1000; i++) sim.send(new Uint8Array([1]), 'reliable');
    expect(sim.stats.dropped).toBe(0);
  });

  it('duplicates at roughly the configured rate', () => {
    const sim = new NetSim(createLoopbackPair().a, { duplicateRate: 0.2, seed: 5 });
    for (let i = 0; i < 5000; i++) sim.send(new Uint8Array([1]));
    const rate = sim.stats.duplicated / sim.stats.sent;
    expect(rate).toBeGreaterThan(0.15);
    expect(rate).toBeLessThan(0.25);
  });

  // The whole reason NetSim is clock-driven rather than timer-driven: a failing
  // netcode test must fail the same way when re-run.
  it('is fully reproducible for a given seed', () => {
    const run = () => {
      const sim = new NetSim(createLoopbackPair().a, { lossRate: 0.3, jitterMs: 20, latencyMs: 50, seed: 777 });
      for (let i = 0; i < 500; i++) sim.send(new Uint8Array([i & 0xff]), 'unreliable');
      return { ...sim.stats };
    };
    expect(run()).toEqual(run());
  });

  it('produces different patterns for different seeds', () => {
    const drops = (seed: number) => {
      const sim = new NetSim(createLoopbackPair().a, { lossRate: 0.3, seed });
      for (let i = 0; i < 500; i++) sim.send(new Uint8Array([1]), 'unreliable');
      return sim.stats.dropped;
    };
    expect(drops(1)).not.toBe(drops(2));
  });

  it('can reorder packets under jitter', () => {
    // Real networks reorder. Code must not assume they do not (ADR-008).
    const { a, b, pump } = createLoopbackPair();
    const sim = new NetSim(a, { latencyMs: 50, jitterMs: 45, seed: 3 });
    const got: number[] = [];
    b.onMessage((d) => got.push(d[0] as number));
    for (let i = 0; i < 40; i++) sim.send(new Uint8Array([i]));
    sim.pump(200);
    pump();
    expect(got).toHaveLength(40);
    const inOrder = got.every((v, i) => v === i);
    expect(inOrder).toBe(false);
  });

  it('discards in-flight traffic when closed', () => {
    const sim = new NetSim(createLoopbackPair().a, { latencyMs: 100, seed: 1 });
    sim.send(new Uint8Array([1]));
    sim.close();
    expect(sim.inFlight).toBe(0);
    expect(sim.isOpen).toBe(false);
  });
});

describe('ClockSync (T-1.10)', () => {
  /** Simulate a link with fixed one-way latency and a server clock offset. */
  function simulate(oneWayMs: number, serverOffset: number, samples: number, jitter = 0, seedShift = 0) {
    const sync = new ClockSync();
    let clientNow = 1000;
    for (let i = 0; i < samples; i++) {
      const j = jitter === 0 ? 0 : ((i * 37 + seedShift) % (jitter * 2)) - jitter;
      const ping = sync.beginPing(clientNow);
      const serverTime = clientNow + oneWayMs + j / 2 + serverOffset;
      clientNow += oneWayMs * 2 + j;
      sync.acceptPong(ping.id, serverTime, clientNow);
      clientNow += 50;
    }
    return sync;
  }

  it('estimates round-trip time', () => {
    expect(simulate(40, 0, 10).rtt).toBeCloseTo(80, 0);
  });

  it('estimates the server offset', () => {
    expect(simulate(40, 5000, 10).offset).toBeCloseTo(5000, 0);
  });

  // The plan's T-1.10 criterion: 100ms +/- 30ms jitter converges within 10ms.
  it('converges to within 10 ms under jitter', () => {
    const sync = simulate(50, 12345, 16, 30);
    expect(Math.abs(sync.offset - 12345)).toBeLessThan(10);
  });

  // A mean would be permanently skewed by one badly delayed packet.
  it('resists a single outlier, where a mean would not', () => {
    const sync = new ClockSync();
    let now = 0;
    for (let i = 0; i < 15; i++) {
      const p = sync.beginPing(now);
      now += 80;
      sync.acceptPong(p.id, now - 40, now);
      now += 10;
    }
    const clean = sync.offset;

    const spike = sync.beginPing(now);
    now += 3000; // one catastrophically delayed packet
    sync.acceptPong(spike.id, now - 1500, now);

    expect(Math.abs(sync.offset - clean)).toBeLessThan(30);
  });

  it('reports jitter', () => {
    expect(simulate(50, 0, 16, 40).jitter).toBeGreaterThan(0);
    expect(simulate(50, 0, 16, 0).jitter).toBe(0);
  });

  it('ignores an unknown or duplicated pong', () => {
    const sync = new ClockSync();
    const p = sync.beginPing(0);
    expect(sync.acceptPong(p.id, 50, 100)).not.toBeNull();
    expect(sync.acceptPong(p.id, 50, 100)).toBeNull(); // duplicate
    expect(sync.acceptPong(9999, 50, 100)).toBeNull(); // never sent
    expect(sync.sampleCount).toBe(1);
  });

  it('bounds its sample window', () => {
    const sync = new ClockSync(8);
    let now = 0;
    for (let i = 0; i < 100; i++) {
      const p = sync.beginPing(now);
      now += 60;
      sync.acceptPong(p.id, now - 30, now);
    }
    expect(sync.sampleCount).toBe(8);
  });

  it('renders behind server time by the interpolation delay', () => {
    const sync = simulate(40, 1000, 10);
    const now = 50_000;
    expect(sync.serverTime(now) - sync.renderTime(now, 100)).toBeCloseTo(100, 6);
  });

  it('is safe before any sample arrives', () => {
    const sync = new ClockSync();
    expect(sync.rtt).toBe(0);
    expect(sync.offset).toBe(0);
    expect(sync.jitter).toBe(0);
  });
});
