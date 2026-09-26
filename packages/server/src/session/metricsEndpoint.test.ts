/**
 * The metrics endpoint on the host (T-4.33): `/metrics` on the host's port
 * serves the exposition, its gauges say what the registry holds, its
 * counters follow the rooms, refusals are counted by code as they happen,
 * every tick lands in the histogram, and no room code is in it.
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

function newHost(overrides: Partial<ConstructorParameters<typeof SessionHost>[0]> = {}) {
  const clock = fakeClock();
  const host = new SessionHost({ port: 0, log: quiet, autoTick: false, now: clock.now, ...overrides });
  return { host, clock };
}

function attach(host: SessionHost, name: string, room = '', resume = '') {
  const pair = createLoopbackPair();
  const received: Message[] = [];
  pair.b.onMessage((bytes) => received.push(decodeMessage(bytes)));
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

/** Every sample line for a metric name, `labels value`. */
function samples(text: string, name: string): string[] {
  return text
    .split('\n')
    .filter((line) => line.startsWith(name) && !line.startsWith('# '))
    .map((line) => line.slice(name.length));
}

const hosts: SessionHost[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.stop();
});

describe('the metrics endpoint (T-4.33)', () => {
  it('serves the exposition over plain HTTP on the same port, with the gauges the registry holds and no room code', async () => {
    const { host, clock } = newHost();
    hosts.push(host);
    const port = await host.start();
    const a = attach(host, 'a');
    expect(a.ack).toBeDefined();
    for (let i = 0; i < 5; i += 1) {
      clock.advance(TICK_MS);
      host.tickNow();
      a.settle();
    }
    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(samples(text, 'sandline_rooms')).toContain(' 1');
    expect(samples(text, 'sandline_players')).toEqual([' 1']);
    expect(samples(text, 'sandline_connections')).toContain(' 1');
    expect(samples(text, 'sandline_tick_seconds_count')).toEqual([' 5']);
    expect(samples(text, 'sandline_seatings_total')).toEqual(['{resumed="no"} 1', '{resumed="yes"} 0']);
    expect(Number(samples(text, 'sandline_snapshots_sent_total')[0])).toBeGreaterThan(0);
    expect(Number(samples(text, 'sandline_bytes_sent_total')[0])).toBeGreaterThan(0);
    expect(text).toContain(`sandline_info{protocol="${PROTOCOL_VERSION}",draining="no"} 1`);
    expect(text).not.toContain(a.ack!.room);
  });

  it('counts refusals by their code as they happen, a resume as a reconnect, and keeps a reclaimed room in the totals', async () => {
    const { host, clock } = newHost({ registry: { maxRooms: 1, graceMs: 1000 } });
    hosts.push(host);
    const a = attach(host, 'a');
    const code = a.ack!.room;
    // No such room, and a second room past the cap: two refusals, two codes.
    const wrong = attach(host, 'b', 'XXXX');
    expect(wrong.bye?.code).toBe('no such room');
    const full = attach(host, 'c');
    expect(full.bye?.code).toBe('host full');
    let text = host.renderMetrics();
    expect(samples(text, 'sandline_refusals_total')).toEqual(['{code="host full"} 1', '{code="no such room"} 1']);
    // A drops and resumes into the seat: a reconnect, not a refusal.
    const token = a.ack!.resume;
    a.close('socket died');
    a.settle();
    const back = attach(host, 'a', code, token);
    expect(back.ack?.resumed).toBe(true);
    text = host.renderMetrics();
    expect(samples(text, 'sandline_seatings_total')).toEqual(['{resumed="no"} 1', '{resumed="yes"} 1']);
    expect(samples(text, 'sandline_refusals_total')).toEqual(['{code="host full"} 1', '{code="no such room"} 1']);
    // Everyone leaves and the room is reclaimed: its seatings and bytes stay counted.
    for (let i = 0; i < 3; i += 1) {
      clock.advance(TICK_MS);
      host.tickNow();
      back.settle();
    }
    const bytesBefore = Number(samples(host.renderMetrics(), 'sandline_bytes_sent_total')[0]);
    expect(bytesBefore).toBeGreaterThan(0);
    back.close('left');
    back.settle();
    // One tick notices the room is empty; a grace later it is reclaimed.
    clock.advance(TICK_MS);
    host.tickNow();
    clock.advance(2000);
    host.tickNow();
    expect(host.registry.size).toBe(0);
    text = host.renderMetrics();
    expect(samples(text, 'sandline_rooms')).toContain(' 0');
    expect(samples(text, 'sandline_seatings_total')).toEqual(['{resumed="no"} 1', '{resumed="yes"} 1']);
    expect(Number(samples(text, 'sandline_bytes_sent_total')[0])).toBeGreaterThanOrEqual(bytesBefore);
  });
});
