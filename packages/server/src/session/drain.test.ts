/**
 * Drain and reclaim on deploy (T-4.32), on a fake clock: a draining host
 * takes no new rooms but still admits a reconnect into a room it holds;
 * it stops the moment nobody is seated, or at the cap with the players
 * told; and while it drains, `/healthz` says so for the platform to stop
 * sending it new connections.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { type Message, PROTOCOL_VERSION, createLoopbackPair, decodeMessage, encodeMessage } from '@sandline/shared';
import { SessionHost } from './SessionHost.ts';
import type { Logger } from '../log.ts';

const TICK_MS = 1000 / 30;
const quiet: Logger = { debug() {}, info() {}, warn() {}, error() {} };

function fakeClock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function newHost() {
  const clock = fakeClock();
  const host = new SessionHost({ port: 0, log: quiet, autoTick: false, now: clock.now, registry: { graceMs: 1000 } });
  return { host, clock };
}

function attach(host: SessionHost, name: string, room = '', resume = '') {
  const pair = createLoopbackPair();
  const received: Message[] = [];
  pair.b.onMessage((bytes) => {
    const msg = decodeMessage(bytes);
    received.push(msg);
    // A player who answers every snapshot: the heartbeat never times them out, so only the drain can end the seat.
    if (msg.kind === 'Delta') pair.b.send(encodeMessage({ kind: 'Ack', tick: msg.tick }));
  });
  host.accept(pair.a);
  pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name, room, ...(resume === '' ? {} : { resume }) }));
  pair.settle();
  return {
    received,
    settle: () => pair.settle(),
    close: (reason: string) => pair.b.close(reason),
    get ack() {
      return received.find((m) => m.kind === 'JoinAck') as Extract<Message, { kind: 'JoinAck' }> | undefined;
    },
    get bye() {
      return received.find((m) => m.kind === 'Disconnect') as Extract<Message, { kind: 'Disconnect' }> | undefined;
    },
  };
}

function run(host: SessionHost, clock: ReturnType<typeof fakeClock>, ticks: number, ...clients: { settle: () => void }[]): void {
  for (let i = 0; i < ticks; i += 1) {
    clock.advance(TICK_MS);
    host.tickNow();
    for (const c of clients) c.settle();
  }
}

const hosts: SessionHost[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.stop();
});

describe('drain and reclaim on deploy (T-4.32)', () => {
  it('stops at once with nobody seated', async () => {
    const { host } = newHost();
    hosts.push(host);
    await host.start();
    let stopped = false;
    const drained = host.drain(60_000).then(() => {
      stopped = true;
    });
    await drained;
    expect(stopped).toBe(true);
    expect(host.isDraining).toBe(true);
  });

  it('keeps a room in progress, refuses a new room, admits a reconnect into the room it holds, and stops when the last player leaves', async () => {
    const { host, clock } = newHost();
    hosts.push(host);
    const a = attach(host, 'alice');
    const code = a.ack!.room;
    let stopped = false;
    const drained = host.drain(600_000).then(() => {
      stopped = true;
    });
    run(host, clock, 3, a);
    expect(stopped).toBe(false);
    expect(host.health()).toMatchObject({ ok: false, draining: true });
    // A new room is what a deploy must not start here; a code for this room is still welcome.
    const newcomer = attach(host, 'bob');
    expect(newcomer.bye?.code).toBe('host draining');
    const friend = attach(host, 'carol', code);
    expect(friend.ack?.room).toBe(code);
    // A drop and a resume into the same seat, mid-drain.
    const token = a.ack!.resume;
    a.close('socket died');
    a.settle();
    const back = attach(host, 'alice', code, token);
    expect(back.ack?.resumed).toBe(true);
    run(host, clock, 3, back, friend);
    expect(stopped).toBe(false);
    // Everyone leaves: the host stops on the next tick, with nothing left to cut short.
    back.close('left');
    friend.close('left');
    back.settle();
    friend.settle();
    run(host, clock, 1);
    await drained;
    expect(stopped).toBe(true);
  });

  it('stops at the cap with the players told, and not a tick sooner', async () => {
    const { host, clock } = newHost();
    hosts.push(host);
    const a = attach(host, 'alice');
    let stopped = false;
    const drained = host.drain(10_000).then(() => {
      stopped = true;
    });
    run(host, clock, 299, a);
    expect(stopped).toBe(false);
    expect(a.bye).toBeUndefined();
    run(host, clock, 2, a);
    await drained;
    expect(stopped).toBe(true);
    expect(a.bye?.code).toBe('host draining');
    expect(a.bye?.reason).toMatch(/restart/);
  });
});
