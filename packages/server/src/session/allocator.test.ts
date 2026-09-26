/**
 * The allocator on real hosts (T-4.31): two `SessionHost`s on loopback
 * ports, each the other's peer. A connection asking for a room the other
 * holds is answered before the upgrade with a `fly-replay` to it; a new
 * room goes to the emptier host, and a tie stays; `/internal/room` answers
 * a peer yes or no and answers the public side nothing; a peer that has
 * stopped is skipped and the connection taken here.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { type Message, PROTOCOL_VERSION, createLoopbackPair, decodeMessage, encodeMessage } from '@sandline/shared';
import { SessionHost } from './SessionHost.ts';
import type { Logger } from '../log.ts';
import type { PeerInfo } from '../allocator/Allocator.ts';

const quiet: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** Two hosts that know each other by instance name once both listen. */
async function pair(maxRooms = 4) {
  const urls = new Map<string, string>();
  const peersFor = (self: string) => () => Promise.resolve([...urls.entries()].filter(([name]) => name !== self).map(([instance, url]) => ({ instance, url })) as PeerInfo[]);
  // Seeded apart: two registries on the default seed would draw the same first code, and then both hosts hold it.
  const make = (instance: string, seed: number) =>
    new SessionHost({
      port: 0,
      log: quiet,
      autoTick: false,
      registry: { maxRooms, seed },
      allocator: { instance, region: 'test', peers: peersFor(instance), timeoutMs: 300 },
    });
  const a = make('host-a', 1);
  const b = make('host-b', 2);
  const portA = await a.start();
  const portB = await b.start();
  urls.set('host-a', `http://127.0.0.1:${portA}`);
  urls.set('host-b', `http://127.0.0.1:${portB}`);
  return { a, b, portA, portB };
}

/** A loopback client seated straight into a host (no upgrade, no allocator): makes rooms to hold. */
function seat(host: SessionHost, name: string): string {
  const p = createLoopbackPair();
  let room = '';
  p.b.onMessage((bytes) => {
    const msg: Message = decodeMessage(bytes);
    if (msg.kind === 'JoinAck') room = msg.room;
  });
  host.accept(p.a);
  p.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name, room: '' }));
  p.settle();
  return room;
}

/** Open a real socket to a host and say how the upgrade went: accepted, or the status and replay header it was answered with. */
function upgrade(port: number, room = ''): Promise<{ accepted: boolean; status?: number; replay?: string }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/${room === '' ? '' : `?room=${room}`}`);
    socket.on('unexpected-response', (_req, res) => {
      const replay = res.headers['fly-replay'];
      resolve({ accepted: false, status: res.statusCode ?? 0, ...(typeof replay === 'string' ? { replay } : {}) });
      res.resume();
    });
    socket.on('open', () => {
      socket.close();
      resolve({ accepted: true });
    });
    socket.on('error', (e) => {
      if (!/Unexpected server response/.test(e.message)) reject(e);
    });
  });
}

const hosts: SessionHost[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.stop();
});

describe('the allocator on real hosts (T-4.31)', () => {
  it("replays an upgrade for a room the other host holds, and takes one for a room it holds itself", async () => {
    const { a, b, portB } = await pair();
    hosts.push(a, b);
    const onA = seat(a, 'alice');
    const onB = seat(b, 'bob');
    expect(await upgrade(portB, onA)).toEqual({ accepted: false, status: 409, replay: 'instance=host-a' });
    expect(await upgrade(portB, onB)).toEqual({ accepted: true });
    // A code nobody holds is taken here, for the handshake to refuse in the usual way.
    expect(await upgrade(portB, 'ZZZZ')).toEqual({ accepted: true });
  });

  it('sends a new room to the emptier host and keeps a tie', async () => {
    const { a, b, portB } = await pair();
    hosts.push(a, b);
    seat(b, 'bob');
    seat(b, 'bill');
    expect(await upgrade(portB)).toEqual({ accepted: false, status: 409, replay: 'instance=host-a' });
    seat(a, 'alice');
    seat(a, 'anne');
    expect(await upgrade(portB)).toEqual({ accepted: true });
  });

  it('answers a peer yes or no on /internal/room, and the public side nothing', async () => {
    const { a, b, portA } = await pair();
    hosts.push(a, b);
    const onA = seat(a, 'alice');
    // Loopback counts as private here; a public caller would see 404 for every code.
    expect((await fetch(`http://127.0.0.1:${portA}/internal/room/${onA}`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${portA}/internal/room/ZZZZ`)).status).toBe(404);
    const health = (await (await fetch(`http://127.0.0.1:${portA}/healthz`)).json()) as Record<string, unknown>;
    expect(health).toMatchObject({ instance: 'host-a', region: 'test', rooms: 1, draining: false });
    const alone = new SessionHost({ port: 0, log: quiet, autoTick: false });
    hosts.push(alone);
    const port = await alone.start();
    const own = seat(alone, 'solo');
    expect((await fetch(`http://127.0.0.1:${port}/internal/room/${own}`)).status).toBe(404);
  });

  it('skips a peer that has stopped and takes the connection here', async () => {
    const { a, b, portB } = await pair();
    hosts.push(a, b);
    seat(a, 'alice');
    seat(b, 'bob');
    seat(b, 'bill');
    expect(await upgrade(portB)).toEqual({ accepted: false, status: 409, replay: 'instance=host-a' });
    await a.stop();
    expect(await upgrade(portB)).toEqual({ accepted: true });
  });
});
