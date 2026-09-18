import { afterAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  ClientConnection,
  MAX_SLOTS,
  SnapshotStore,
  type Transport,
  decodeMessage,
  encodeMessage,
} from '@sandline/shared';
import { Session } from '../session/Session.ts';
import { type WsServerHandle, startWsServer } from './WsTransport.ts';

/** Adapt a Node `ws` socket to the Transport interface for headless tests. */
function nodeClientTransport(url: string): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    const messageHandlers: ((d: Uint8Array) => void)[] = [];
    const closeHandlers: ((r: string) => void)[] = [];
    let open = true;

    socket.on('message', (data: ArrayBuffer | Buffer) => {
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
      for (const h of messageHandlers) h(bytes);
    });
    socket.on('close', () => {
      if (!open) return;
      open = false;
      for (const h of closeHandlers) h('closed');
    });
    socket.on('error', reject);
    socket.on('open', () =>
      resolve({
        get isOpen() {
          return open;
        },
        send: (d) => socket.send(d),
        onMessage: (h) => messageHandlers.push(h),
        onClose: (h) => closeHandlers.push(h),
        close: () => {
          open = false;
          socket.close();
        },
      }),
    );
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const servers: WsServerHandle[] = [];
afterAll(async () => {
  for (const s of servers) await s.close();
});

describe('WebSocket transport end to end (T-1.07, T-1.08)', () => {
  it('carries a full session over a real socket', async () => {
    const session = new Session();
    const handle = await startWsServer({
      port: 0, // ephemeral
      onConnection: (t) => session.addConnection(t, Date.now()),
    });
    servers.push(handle);

    const transport = await nodeClientTransport(`ws://127.0.0.1:${handle.port}`);
    const store = new SnapshotStore();
    let joinedSlot = -1;

    const client = new ClientConnection(transport, {
      onJoinAck: (_netId, slot) => (joinedSlot = slot),
    });
    // Deltas are applied through the store; the connection surfaces them raw.
    transport.onMessage(() => undefined);
    client.join('socket-tester');
    await wait(100);

    expect(joinedSlot).toBe(0);
    expect(session.stats.players).toBe(1);
    expect(session.stats.bots).toBe(MAX_SLOTS - 1);

    transport.close();
    await wait(100);
    expect(session.stats.players).toBe(0);
    void store;
  });

  it('accepts several concurrent sockets and rejects the seventh', async () => {
    const session = new Session();
    const handle = await startWsServer({
      port: 0,
      onConnection: (t) => session.addConnection(t, Date.now()),
    });
    servers.push(handle);

    const slots: number[] = [];
    const reasons: string[] = [];
    const clients = [];
    for (let i = 0; i < MAX_SLOTS + 1; i++) {
      const t = await nodeClientTransport(`ws://127.0.0.1:${handle.port}`);
      const c = new ClientConnection(t, {
        onJoinAck: (_n, slot) => slots.push(slot),
        onClosed: (r) => reasons.push(r),
      });
      c.join(`p${i}`);
      clients.push({ t, c });
      await wait(30);
    }
    await wait(120);

    expect(new Set(slots).size).toBe(MAX_SLOTS);
    expect(reasons.some((r) => /room full/.test(r))).toBe(true);
    for (const { t } of clients) t.close();
  });

  it('survives a peer sending garbage without taking down the server', async () => {
    const session = new Session();
    const handle = await startWsServer({
      port: 0,
      onConnection: (t) => session.addConnection(t, Date.now()),
    });
    servers.push(handle);

    const bad = await nodeClientTransport(`ws://127.0.0.1:${handle.port}`);
    bad.send(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff]));
    await wait(80);
    expect(session.stats.players).toBe(0);

    // A well-behaved client still connects afterwards.
    const good = await nodeClientTransport(`ws://127.0.0.1:${handle.port}`);
    let slot = -1;
    const c = new ClientConnection(good, { onJoinAck: (_n, s) => (slot = s) });
    c.join('good');
    await wait(80);
    expect(slot).toBeGreaterThanOrEqual(0);
    good.close();
    bad.close();
  });

  it('delivers ticking deltas that a client can apply', async () => {
    const session = new Session();
    const handle = await startWsServer({
      port: 0,
      onConnection: (t) => session.addConnection(t, Date.now()),
    });
    servers.push(handle);

    const transport = await nodeClientTransport(`ws://127.0.0.1:${handle.port}`);
    const store = new SnapshotStore();
    const applied: number[] = [];

    const client = new ClientConnection(transport, {});
    transport.onMessage((bytes) => {
      // Peek for Delta frames alongside the connection's own handling.
      try {
        const msg = decodeMessage(bytes);
        if (msg.kind === 'Delta') {
          const res = store.applyDelta(msg.tick, msg.baselineTick, msg.payload);
          if (res.ok) {
            applied.push(msg.tick);
            transport.send(encodeMessage({ kind: 'Ack', tick: msg.tick }));
          }
        }
      } catch {
        // Non-delta frames are handled by ClientConnection.
      }
    });
    client.join('ticker');
    await wait(60);

    const now = Date.now();
    for (let i = 1; i <= 20; i++) session.step(now + i * 33);
    await wait(150);

    expect(applied.length).toBeGreaterThan(15);
    expect(store.current?.entities).toHaveLength(MAX_SLOTS);
    transport.close();
  });
});
