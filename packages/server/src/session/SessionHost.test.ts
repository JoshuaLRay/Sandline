/**
 * Session host tests (T-1.5.01, rooms from T-1.5.05).
 *
 * Almost everything here runs on loopback transports and an injected clock, via
 * the `accept` seam: routing, slot assignment, conditioning, heartbeat timeout
 * and shutdown are all logic, and testing logic through a real socket buys
 * nothing but flakes. A few tests do use a real socket, because "the WebSocket
 * path actually carries a handshake" and "the health endpoint answers" are
 * precisely the claims a loopback cannot stand in for.
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
  isRoomCode,
} from '@sandline/shared';
import { SessionHost, hostBanner, linkFromEnv } from './SessionHost.ts';
import type { Logger } from '../log.ts';
import { isNavReady } from '../ai/nav/NavMesh.ts';

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
  readonly ack: Extract<Message, { kind: 'JoinAck' }> | undefined;
  readonly bye: Extract<Message, { kind: 'Disconnect' }> | undefined;
  /** The newest roster the host sent. */
  readonly roster: Extract<Message, { kind: 'Roster' }> | undefined;
  /** The room this client landed in, from its JoinAck. */
  readonly room: string;
}

/** A client on a loopback pair, attached to the host with no socket at all. */
function attachFake(host: SessionHost, name = 'test', room = ''): FakeClient {
  const pair = createLoopbackPair();
  const received: Message[] = [];
  pair.b.onMessage((bytes) => received.push(decodeMessage(bytes)));
  host.accept(pair.a);
  const client: FakeClient = {
    transport: pair.b,
    received,
    send: (msg) => pair.b.send(encodeMessage(msg)),
    settle: () => pair.settle(),
    get ack() {
      return received.find((m) => m.kind === 'JoinAck') as FakeClient['ack'];
    },
    get bye() {
      return received.find((m) => m.kind === 'Disconnect') as FakeClient['bye'];
    },
    get roster() {
      return [...received].reverse().find((m) => m.kind === 'Roster') as FakeClient['roster'];
    },
    get room() {
      return this.ack?.room ?? '';
    },
  };
  client.send({ kind: 'Join', version: PROTOCOL_VERSION, name, room });
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

/** Run the host for `ticks` ticks of wall time, settling a client between each. */
function run(host: SessionHost, clock: ReturnType<typeof fakeClock>, ticks: number, ...clients: FakeClient[]): void {
  for (let i = 0; i < ticks; i++) {
    clock.advance(TICK_MS);
    host.tickNow();
    for (const c of clients) c.settle();
  }
}

describe('SessionHost — rooms (T-1.5.05)', () => {
  it('makes a room for a client that sends no code, and tells it the code', () => {
    const { host } = newHost();
    const client = attachFake(host);

    expect(client.ack).toBeDefined();
    expect(isRoomCode(client.room)).toBe(true);
    expect(host.registry.size).toBe(1);
    expect(host.registry.get(client.room)?.session.stats).toMatchObject({ players: 1, bots: MAX_SLOTS - 1 });
    // ADR-001: the world is six slots from the moment the room exists, so a
    // join is a bot->human swap and the entity count never changes.
    expect(host.registry.get(client.room)?.session.slots).toHaveLength(MAX_SLOTS);
  });

  it('seats two clients with the same code in one session, in different slots', () => {
    const { host } = newHost();
    const a = attachFake(host, 'a');
    const b = attachFake(host, 'b', a.room);

    expect(b.room).toBe(a.room);
    expect(a.ack?.slot).not.toBe(b.ack?.slot);
    expect(a.ack?.netId).not.toBe(b.ack?.netId);
    expect(host.registry.size).toBe(1);
    expect(host.registry.get(a.room)?.session.players).toBe(2);
  });

  it('keeps clients with different codes in different sessions that cannot see each other', () => {
    const { host, clock } = newHost();
    const a = attachFake(host, 'a');
    const b = attachFake(host, 'b');
    expect(b.room).not.toBe(a.room);
    expect(host.registry.size).toBe(2);

    run(host, clock, 3, a, b);

    // Each sees a roster with exactly one human — itself — and the deltas each
    // receives come from a session whose tick count is its own.
    expect(a.roster?.slots.filter((s) => s.human)).toEqual([{ human: true, name: 'a' }]);
    expect(b.roster?.slots.filter((s) => s.human)).toEqual([{ human: true, name: 'b' }]);
    expect(host.registry.get(a.room)?.session.players).toBe(1);
    expect(host.registry.get(b.room)?.session.players).toBe(1);
  });

  it('refuses a seventh client with `room full` rather than growing the squad', () => {
    const { host } = newHost();
    const first = attachFake(host, 'p0');
    for (let i = 1; i < MAX_SLOTS; i++) attachFake(host, `p${i}`, first.room);
    const extra = attachFake(host, 'seventh', first.room);

    expect(extra.bye).toMatchObject({ code: 'room full' });
    expect(extra.ack).toBeUndefined();
    expect(host.registry.get(first.room)?.session.players).toBe(MAX_SLOTS);
  });

  it('refuses a code that names no room, distinguishably', () => {
    const { host } = newHost();
    const lost = attachFake(host, 'lost', 'K7PM');
    expect(lost.bye).toMatchObject({ code: 'no such room' });
    expect(host.registry.size).toBe(0);
  });

  it('refuses a new room at the process cap with `host full`, and keeps serving the rooms it has', () => {
    const { host, clock } = newHost({ registry: { maxRooms: 2 } });
    const a = attachFake(host, 'a');
    const b = attachFake(host, 'b');
    const c = attachFake(host, 'c');

    expect(c.bye).toMatchObject({ code: 'host full' });
    expect(host.registry.size).toBe(2);

    // Joining an EXISTING room is still fine: the cap is on rooms, not people.
    const d = attachFake(host, 'd', a.room);
    expect(d.ack).toBeDefined();

    run(host, clock, 2, a, b, d);
    expect(a.received.filter((m) => m.kind === 'Delta').length).toBe(2);
    expect(b.received.filter((m) => m.kind === 'Delta').length).toBe(2);
  });

  it('reclaims a room once it has been empty past the grace, and not before', () => {
    const graceMs = 1000;
    const { host, clock } = newHost({ registry: { graceMs } });
    const client = attachFake(host);
    const room = host.registry.get(client.room);
    expect(room).toBeDefined();

    client.transport.close('left');
    run(host, clock, 1);
    expect(room?.session.players).toBe(0);
    expect(host.registry.size).toBe(1);

    // Still inside the grace: a returning player finds their room.
    run(host, clock, Math.floor(graceMs / TICK_MS) - 2);
    expect(host.registry.size).toBe(1);
    const back = attachFake(host, 'back', client.room);
    expect(back.ack?.room).toBe(client.room);

    // Leaving again restarts the grace; sitting it out ends the room.
    back.transport.close('left');
    run(host, clock, Math.ceil(graceMs / TICK_MS) + 2);
    expect(host.registry.size).toBe(0);
    expect(host.registry.get(client.room)).toBeUndefined();

    // The tick loop for that room has stopped: its session's tick is frozen.
    const tickAtReclaim = room?.session.tick;
    run(host, clock, 5);
    expect(room?.session.tick).toBe(tickAtReclaim);
    // And the code now names nothing.
    expect(attachFake(host, 'late', client.room).bye).toMatchObject({ code: 'no such room' });
  });

  it('does not reclaim a room while someone is in it, however long it lives', () => {
    const { host, clock } = newHost({ registry: { graceMs: 500 } });
    const client = attachFake(host);
    // Keep the heartbeat alive: pings count as being heard from.
    for (let i = 0; i < 60; i++) {
      client.send({ kind: 'Ping', id: i, clientTime: i });
      run(host, clock, 1, client);
    }
    expect(host.registry.size).toBe(1);
    expect(client.bye).toBeUndefined();
  });

  it('runs each room on its own simulation clock, starting at zero', () => {
    const { host, clock } = newHost();
    const a = attachFake(host, 'a');
    run(host, clock, 30, a);
    const b = attachFake(host, 'b');
    run(host, clock, 10, a, b);

    const roomA = host.registry.get(a.room);
    const roomB = host.registry.get(b.room);
    // Thirty ticks apart, whatever float rounding the accumulator did to the
    // absolute count: b's clock started when b's room did, not at boot.
    expect((roomA?.session.tick as number) - (roomB?.session.tick as number)).toBe(30);
    expect(roomB?.session.tick).toBeLessThanOrEqual(10);
    // Lag compensation rewinds by `nowMs - renderTimeMs`, and the client
    // computes renderTimeMs from ticks, so a room's time MUST be its own
    // tick count times the tick period — not the host's.
    expect(roomB?.simTimeMs).toBeCloseTo((roomB?.session.tick as number) * TICK_MS, 6);
    expect(roomB?.simTimeMs).toBeLessThan(host.serverTimeMs);
  });
});

describe('SessionHost — the roster (T-1.5.04)', () => {
  it('tells everyone in the room who is in it, six rows always', () => {
    const { host } = newHost();
    const a = attachFake(host, 'alpha');
    const b = attachFake(host, 'bravo', a.room);
    a.settle();

    for (const c of [a, b]) {
      expect(c.roster?.slots).toHaveLength(MAX_SLOTS);
      expect(c.roster?.slots.filter((s) => s.human).map((s) => s.name).sort()).toEqual(['alpha', 'bravo']);
    }
  });

  it('flips a row back to bot when someone leaves', () => {
    const { host } = newHost();
    const a = attachFake(host, 'alpha');
    const b = attachFake(host, 'bravo', a.room);
    const bravoSlot = b.ack?.slot as number;

    b.transport.close('left');
    a.settle();

    expect(a.roster?.slots[bravoSlot]).toEqual({ human: false, name: '' });
    expect(a.roster?.slots.filter((s) => s.human)).toHaveLength(1);
  });

  it('frees the slot at once when a client says it is leaving', () => {
    const { host } = newHost();
    const a = attachFake(host, 'alpha');
    const b = attachFake(host, 'bravo', a.room);
    b.send({ kind: 'Disconnect', code: 'left', reason: 'left' });
    b.settle();
    a.settle();
    expect(host.registry.get(a.room)?.session.players).toBe(1);
  });
});

describe('SessionHost — handshake and lifecycle', () => {
  it('rejects a stale client on version, not on room', () => {
    const { host } = newHost();
    const pair = createLoopbackPair();
    const received: Message[] = [];
    pair.b.onMessage((bytes) => received.push(decodeMessage(bytes)));
    host.accept(pair.a);
    pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION - 1, name: 'old', room: 'K7PM' }));
    pair.settle();

    expect(received.find((m) => m.kind === 'Disconnect')).toMatchObject({ code: 'bad version' });
    expect(host.registry.size).toBe(0);
  });

  it('hands a slot back to a bot when a client goes', () => {
    const { host } = newHost();
    const client = attachFake(host);
    const session = host.registry.get(client.room)?.session;
    expect(session?.stats.players).toBe(1);

    client.transport.close('left');
    expect(session?.stats).toMatchObject({ players: 0, bots: MAX_SLOTS });
  });

  it('drops a seated client that stops talking, and says why', () => {
    const { host, clock } = newHost();
    const client = attachFake(host);
    const session = host.registry.get(client.room)?.session;

    // Advanced a tick at a time, not in one jump: the timeout is measured in
    // simulation time, and Clock deliberately drops a backlog rather than
    // catching up through it (T-0.08), so one big jump advances the session by
    // five ticks and nothing times out.
    run(host, clock, Math.ceil(HEARTBEAT_TIMEOUT_MS / TICK_MS) + 2, client);

    expect(client.bye).toMatchObject({ code: 'heartbeat timeout' });
    expect(session?.stats.players).toBe(0);
  });

  it('drops a socket that never finishes its handshake', () => {
    const { host, clock } = newHost();
    const pair = createLoopbackPair();
    const received: Message[] = [];
    pair.b.onMessage((bytes) => received.push(decodeMessage(bytes)));
    host.accept(pair.a);
    expect(host.openConnections).toBe(1);

    for (let i = 0; i < Math.ceil(HEARTBEAT_TIMEOUT_MS / TICK_MS) + 2; i++) {
      clock.advance(TICK_MS);
      host.tickNow();
      pair.settle();
    }
    expect(received.find((m) => m.kind === 'Disconnect')).toMatchObject({ code: 'heartbeat timeout' });
    expect(host.openConnections).toBe(0);
  });

  it('caps the sockets it will hold, seated or not', () => {
    const { host } = newHost({ maxConnections: 2 });
    attachFake(host, 'a');
    attachFake(host, 'b');
    const pair = createLoopbackPair();
    let closed: string | null = null;
    pair.a.onClose((r) => (closed = r));
    host.accept(pair.a);
    expect(closed).toBe('host full');
    expect(host.openConnections).toBe(2);
  });

  it('tells every room and every handshaking peer it is draining, then refuses newcomers', async () => {
    const { host } = newHost();
    const seated = attachFake(host, 'seated');
    const pair = createLoopbackPair();
    const midHandshake: Message[] = [];
    pair.b.onMessage((bytes) => midHandshake.push(decodeMessage(bytes)));
    host.accept(pair.a);

    await host.stop('host SIGTERM');
    seated.settle();
    pair.settle();

    expect(seated.bye).toMatchObject({ code: 'host draining', reason: 'host SIGTERM' });
    expect(midHandshake.find((m) => m.kind === 'Disconnect')).toMatchObject({ code: 'host draining' });
    expect(host.registry.size).toBe(0);
  });
});

describe('SessionHost — the tick loop', () => {
  it('runs one tick per 1/30 s of wall time and broadcasts each one', () => {
    const { host, clock } = newHost();
    const client = attachFake(host);

    run(host, clock, 30, client);

    expect(host.registry.get(client.room)?.session.tick).toBe(30);
    expect(host.serverTimeMs).toBeCloseTo(30 * TICK_MS, 6);
    expect(client.received.filter((m) => m.kind === 'Delta').length).toBe(30);
  });

  it('simulation time advances by exactly one tick per tick, whatever wall time did', () => {
    const { host, clock } = newHost();
    const client = attachFake(host);

    // A 1 s stall. Clock caps catch-up at MAX_CATCHUP_STEPS and drops the rest
    // (T-0.08), so simulation time deliberately falls behind wall time — but it
    // must still be exactly `ticks x TICK_MS`, because lag compensation rewinds
    // by that clock and a rewind to "120 ms ago" has to land on a real tick.
    clock.advance(1000);
    host.tickNow();

    const room = host.registry.get(client.room);
    expect(room?.simTimeMs).toBeCloseTo((room?.session.tick as number) * TICK_MS, 6);
    expect(host.serverTimeMs).toBeLessThan(1000);
  });
});

describe('SessionHost — link conditioning', () => {
  const link = { latencyMs: 100, jitterMs: 0, lossRate: 0 };
  const join = (): Uint8Array =>
    encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'slow', room: '' });

  it('holds a client message back by the configured latency', () => {
    const { host, clock } = newHost({ link });
    const pair = createLoopbackPair();
    host.accept(pair.a);
    pair.b.send(join());
    pair.settle();

    // The bytes are on the wire but not yet at the host.
    host.tickNow();
    expect(host.registry.size).toBe(0);

    clock.advance(link.latencyMs);
    host.tickNow();
    pair.settle();
    expect(host.registry.size).toBe(1);
  });

  it('delays what the server sends as well as what it receives', () => {
    const { host, clock } = newHost({ link });
    const pair = createLoopbackPair();
    const received: Message[] = [];
    pair.b.onMessage((bytes) => received.push(decodeMessage(bytes)));
    host.accept(pair.a);
    pair.b.send(join());
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
    pair.b.send(join());
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
    // No pump, no tick: a raw socket hands the host its bytes immediately.
    expect(host.registry.size).toBe(1);
    expect(client.ack).toBeDefined();
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

  it('has the navmesh WASM initialised before it listens (T-3.01)', async () => {
    const { host } = newHost();
    hosts.push(host);
    await host.start();
    expect(isNavReady()).toBe(true);
  });

  it('handshakes a real WebSocket client into a room', async () => {
    const { host } = newHost();
    hosts.push(host);
    const port = await host.start();
    expect(port).toBeGreaterThan(0);

    const { socket, received } = await connect(port);
    socket.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'real', room: '' }));
    await settle();

    const ack = received.find((m) => m.kind === 'JoinAck');
    expect(ack).toBeDefined();
    expect(host.registry.size).toBe(1);
    expect(host.registry.stats.players).toBe(1);
    socket.close();
  });

  it('tells a connected client why it is going, before the socket closes', async () => {
    const { host } = newHost();
    hosts.push(host);
    const port = await host.start();
    const { socket, received } = await connect(port);
    socket.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'real', room: '' }));
    await settle();

    await host.stop('host SIGTERM');
    await settle();

    expect(received.find((m) => m.kind === 'Disconnect')).toMatchObject({
      code: 'host draining',
      reason: 'host SIGTERM',
    });
  });

  it('answers a health check over plain HTTP on the same port (T-1.5.07)', async () => {
    const { host } = newHost();
    hosts.push(host);
    const port = await host.start();
    attachFake(host, 'someone');

    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, protocol: PROTOCOL_VERSION, rooms: 1, players: 1 });
    // Room codes are never listed: the URL would become a way in.
    expect(JSON.stringify(body)).not.toContain(host.registry.list()[0]?.code as string);

    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(missing.status).toBe(404);
  });

  it('refuses the upgrade itself once the connection cap is reached', async () => {
    const { host } = newHost({ maxConnections: 1 });
    hosts.push(host);
    const port = await host.start();
    const first = await connect(port);
    await settle();

    const refused = await new Promise<boolean>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`);
      socket.on('open', () => resolve(false));
      socket.on('error', () => resolve(true));
    });
    expect(refused).toBe(true);
    expect(host.openConnections).toBe(1);
    first.socket.close();
  });
});
