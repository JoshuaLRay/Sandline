/**
 * Session host tests (T-1.5.01).
 *
 * Almost everything here runs on loopback transports and an injected clock, via
 * the `accept` seam: slot assignment, conditioning, heartbeat timeout and
 * shutdown are all logic, and testing logic through a real socket buys nothing
 * but flakes. Two tests do use a real socket, because "the WebSocket path
 * actually carries a handshake" is precisely the claim this task makes and the
 * one thing a loopback cannot stand in for.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  HEARTBEAT_TIMEOUT_MS,
  MAX_SLOTS,
  PROTOCOL_VERSION,
  type Message,
  type Transport,
  createLoopbackPair,
  decodeMessage,
  encodeMessage,
} from '@sandline/shared';
import { SessionHost, hostBanner, linkFromEnv } from './SessionHost.ts';
import type { Logger } from '../log.ts';

/** Silent logger: these tests assert on state, not on stdout. */
const quiet: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** A fake wall clock the test advances by hand. */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 0;
  return { now: () => t, advance: (ms) => void (t += ms) };
}

const TICK_MS = 1000 / 30;

interface FakeClient {
  transport: Transport;
  received: Message[];
  send(msg: Message): void;
  /** Deliver everything queued in both directions. */
  settle(): void;
}

/** A client on a loopback pair, attached to the host with no socket at all. */
function attachFake(host: SessionHost, name = 'test'): FakeClient {
  const pair = createLoopbackPair();
  const received: Message[] = [];
  pair.b.onMessage((bytes) => received.push(decodeMessage(bytes)));
  host.accept(pair.a);
  const client: FakeClient = {
    transport: pair.b,
    received,
    send: (msg) => pair.b.send(encodeMessage(msg)),
    settle: () => pair.settle(),
  };
  client.send({ kind: 'Join', version: PROTOCOL_VERSION, name });
  pair.settle();
  return client;
}

function newHost(overrides: Partial<ConstructorParameters<typeof SessionHost>[0]> = {}): {
  host: SessionHost;
  clock: ReturnType<typeof fakeClock>;
} {
  const clock = fakeClock();
  const host = new SessionHost({
    port: 0,
    log: quiet,
    autoTick: false,
    now: clock.now,
    ...overrides,
  });
  return { host, clock };
}

describe('SessionHost — slots and lifecycle', () => {
  it('gives a joining client a slot on an entity that already existed', () => {
    const { host } = newHost();
    const client = attachFake(host);

    const ack = client.received.find((m) => m.kind === 'JoinAck');
    expect(ack).toBeDefined();
    expect(host.session.stats).toMatchObject({ players: 1, bots: MAX_SLOTS - 1 });
    // ADR-001: the world is six slots from the moment the session exists, so a
    // join is a bot->human swap and the entity count never changes.
    expect(host.session.slots).toHaveLength(MAX_SLOTS);
  });

  it('seats two clients in different slots', () => {
    const { host } = newHost();
    const a = attachFake(host, 'a');
    const b = attachFake(host, 'b');

    const ackOf = (c: FakeClient) =>
      c.received.find((m) => m.kind === 'JoinAck') as Extract<Message, { kind: 'JoinAck' }>;
    expect(ackOf(a).slot).not.toBe(ackOf(b).slot);
    expect(ackOf(a).netId).not.toBe(ackOf(b).netId);
    expect(host.session.stats.players).toBe(2);
  });

  it('refuses a seventh client rather than growing the squad', () => {
    const { host } = newHost();
    for (let i = 0; i < MAX_SLOTS; i++) attachFake(host, `p${i}`);
    const extra = attachFake(host, 'seventh');

    const bye = extra.received.find((m) => m.kind === 'Disconnect');
    expect(bye).toMatchObject({ reason: 'session full' });
    expect(host.session.stats.players).toBe(MAX_SLOTS);
  });

  it('hands a slot back to a bot when a client goes', () => {
    const { host } = newHost();
    const client = attachFake(host);
    expect(host.session.stats.players).toBe(1);

    client.transport.close('left');
    expect(host.session.stats).toMatchObject({ players: 0, bots: MAX_SLOTS });
  });

  it('drops a client that stops talking, and says why', () => {
    const { host, clock } = newHost();
    const client = attachFake(host);

    // Advanced a tick at a time, not in one jump: the timeout is measured in
    // simulation time, and Clock deliberately drops a backlog rather than
    // catching up through it (T-0.08), so one big jump advances the session by
    // five ticks and nothing times out.
    const ticks = Math.ceil(HEARTBEAT_TIMEOUT_MS / TICK_MS) + 2;
    for (let i = 0; i < ticks; i++) {
      clock.advance(TICK_MS);
      host.tickNow();
    }
    client.settle();

    expect(client.received.find((m) => m.kind === 'Disconnect')).toMatchObject({
      reason: 'heartbeat timeout',
    });
    expect(host.session.stats.players).toBe(0);
  });
});

describe('SessionHost — the tick loop', () => {
  it('runs one tick per 1/30 s of wall time and broadcasts each one', () => {
    const { host, clock } = newHost();
    const client = attachFake(host);

    for (let i = 0; i < 30; i++) {
      clock.advance(TICK_MS);
      host.tickNow();
      client.settle();
    }

    expect(host.session.tick).toBe(30);
    expect(host.serverTimeMs).toBeCloseTo(30 * TICK_MS, 6);
    expect(client.received.filter((m) => m.kind === 'Delta').length).toBe(30);
  });

  it('simulation time advances by exactly one tick per tick, whatever wall time did', () => {
    const { host, clock } = newHost();
    attachFake(host);

    // A 1 s stall. Clock caps catch-up at MAX_CATCHUP_STEPS and drops the rest
    // (T-0.08), so simulation time deliberately falls behind wall time — but it
    // must still be exactly `ticks x TICK_MS`, because lag compensation rewinds
    // by that clock and a rewind to "120 ms ago" has to land on a real tick.
    clock.advance(1000);
    host.tickNow();

    expect(host.serverTimeMs).toBeCloseTo(host.session.tick * TICK_MS, 6);
    expect(host.serverTimeMs).toBeLessThan(1000);
  });
});

describe('SessionHost — link conditioning', () => {
  const link = { latencyMs: 100, jitterMs: 0, lossRate: 0 };

  it('holds a client message back by the configured latency', () => {
    const { host, clock } = newHost({ link });
    const pair = createLoopbackPair();
    host.accept(pair.a);
    pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'slow' }));
    pair.settle();

    // The bytes are on the wire but not yet at the session.
    host.tickNow();
    expect(host.session.stats.players).toBe(0);

    clock.advance(link.latencyMs);
    host.tickNow();
    pair.settle();
    expect(host.session.stats.players).toBe(1);
  });

  it('delays what the server sends as well as what it receives', () => {
    const { host, clock } = newHost({ link });
    const pair = createLoopbackPair();
    const received: Message[] = [];
    pair.b.onMessage((bytes) => received.push(decodeMessage(bytes)));
    host.accept(pair.a);
    pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'slow' }));
    pair.settle();

    clock.advance(link.latencyMs);
    host.tickNow();
    pair.settle();
    // The JoinAck was produced this instant; it owes another leg of latency.
    expect(received).toHaveLength(0);

    clock.advance(link.latencyMs);
    host.tickNow();
    pair.settle();
    expect(received.find((m) => m.kind === 'JoinAck')).toBeDefined();
  });

  it('delivers the goodbye it already queued instead of discarding it', async () => {
    const { host } = newHost({ link });
    const pair = createLoopbackPair();
    const received: Message[] = [];
    pair.b.onMessage((bytes) => received.push(decodeMessage(bytes)));
    host.accept(pair.a);
    pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'slow' }));
    pair.settle();

    // Shut down while the link still owes 100 ms in each direction. A queue
    // that is simply dropped on close turns a clean shutdown into a silent
    // vanish, which is what a reconnect backoff would then chase.
    await host.stop('going away');
    pair.settle();

    expect(received.find((m) => m.kind === 'Disconnect')).toMatchObject({ reason: 'going away' });
  });

  it('is absent entirely when unconfigured, not merely set to zero', () => {
    const { host } = newHost();
    const client = attachFake(host);
    // No pump, no tick: a raw socket hands the session its bytes immediately.
    expect(host.session.stats.players).toBe(1);
    expect(client.received.find((m) => m.kind === 'JoinAck')).toBeDefined();
  });
});

describe('linkFromEnv', () => {
  it('is null when nothing is set, so the default path has no decorator', () => {
    expect(linkFromEnv({})).toBeNull();
  });

  it('fills the unset fields with zero once any one is set', () => {
    expect(linkFromEnv({ LINK_LATENCY_MS: '80' })).toEqual({
      latencyMs: 80,
      jitterMs: 0,
      lossRate: 0,
    });
  });

  it('reads all three', () => {
    expect(linkFromEnv({ LINK_LATENCY_MS: '200', LINK_JITTER_MS: '40', LINK_LOSS: '0.2' })).toEqual({
      latencyMs: 200,
      jitterMs: 40,
      lossRate: 0.2,
    });
  });

  it('rejects nonsense loudly rather than silently running at zero', () => {
    expect(() => linkFromEnv({ LINK_LATENCY_MS: 'soon' })).toThrow(/non-negative/);
    expect(() => linkFromEnv({ LINK_LATENCY_MS: '-5' })).toThrow(/non-negative/);
    // A percentage is the obvious mistake, and 20 would mean dropping every
    // packet twenty times over rather than one in five.
    expect(() => linkFromEnv({ LINK_LOSS: '20' })).toThrow(/fraction/);
  });
});

describe('hostBanner', () => {
  it('says raw socket when there is no conditioning', () => {
    expect(hostBanner(8080, null)).toMatchObject({ port: 8080, slots: MAX_SLOTS, link: 'raw socket' });
  });

  it('spells out that the latency applies each way', () => {
    expect(hostBanner(8080, { latencyMs: 200, jitterMs: 40, lossRate: 0.2 }).link).toBe(
      '200ms +/-40ms, 20% loss (each way)',
    );
  });
});

describe('SessionHost — over a real socket', () => {
  const hosts: SessionHost[] = [];
  afterEach(async () => {
    await Promise.all(hosts.splice(0).map((h) => h.stop()));
  });

  /** Minimal client socket. The bot has its own; this one only needs bytes. */
  function connect(port: number): Promise<{ socket: WebSocket; received: Message[] }> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`);
      socket.binaryType = 'arraybuffer';
      const received: Message[] = [];
      socket.on('message', (data: ArrayBuffer | Buffer) => {
        received.push(decodeMessage(data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data)));
      });
      socket.on('error', reject);
      socket.on('open', () => resolve({ socket, received }));
    });
  }

  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

  it('handshakes a real WebSocket client into a slot', async () => {
    const { host } = newHost();
    hosts.push(host);
    const port = await host.start();
    expect(port).toBeGreaterThan(0);

    const { socket, received } = await connect(port);
    socket.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'real' }));
    await settle();

    expect(received.find((m) => m.kind === 'JoinAck')).toBeDefined();
    expect(host.session.stats.players).toBe(1);
    socket.close();
  });

  it('tells a connected client why it is going, before the socket closes', async () => {
    const { host } = newHost();
    hosts.push(host);
    const port = await host.start();
    const { received } = await connect(port);
    await settle();

    await host.stop('host SIGTERM');
    await settle();

    expect(received.find((m) => m.kind === 'Disconnect')).toMatchObject({
      reason: 'host SIGTERM',
    });
  });
});
