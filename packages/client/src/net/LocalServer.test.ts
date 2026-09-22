/**
 * Per-client link conditions (T-1.24 setup).
 *
 * The thing worth pinning is that the links are INDEPENDENT. A single
 * `setConditions` that reached every NetSim is what this replaced, and its
 * failure mode was silent: both sliders appeared to work, every number in the
 * netgraph looked plausible, and a tester simply could not produce the case
 * where one player lags and the other does not.
 *
 * Asserting on `joined` rather than on queue lengths is deliberate. Whether a
 * handshake has completed by a given time is the observable a tester actually
 * has, and it does not depend on how many datagrams the session chooses to
 * send in reply.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { initNav } from '@sandline/server/nav';
import { DEFAULT_LINK, LocalServer } from './LocalServer.ts';
import { NetClient } from './NetClient.ts';

const LAN = { latencyMs: 0, jitterMs: 0, lossRate: 0 };
const SLOW = { latencyMs: 300, jitterMs: 0, lossRate: 0 };

/**
 * Step the session at each instant in turn, several times per instant.
 *
 * Several instants, not one: a handshake is a ROUND TRIP, so a 300 ms link
 * needs about 600 ms of simulated time and the reply is not due at the moment
 * the request lands. Repeating within an instant is what lets a zero-latency
 * link complete inside one.
 */
function settleThrough(server: LocalServer, ...instants: number[]): void {
  for (const nowMs of instants) for (let i = 0; i < 4; i++) server.step(nowMs);
}

/** Comfortably past a 300 ms round trip, with the pump ordering to spare. */
const AFTER_SLOW_ROUND_TRIP = [400, 800];

it('refuses to exist before the navmesh WASM is initialised, and create() awaits it', async () => {
  // Runs first, before any other test here has initialised the module.
  expect(() => new LocalServer(DEFAULT_LINK)).toThrow(/initNav/);
  const server = await LocalServer.create(DEFAULT_LINK);
  expect(server.tick).toBe(0);
});

describe('LocalServer per-client links', () => {
  beforeAll(() => initNav());

  it('delays one client without touching the other', () => {
    const server = new LocalServer(LAN);
    const peer = server.connect(SLOW);
    const mine = new NetClient(server.transport, 'me');
    const theirs = new NetClient(peer.transport, 'them');
    mine.join();
    theirs.join();

    settleThrough(server, 0);
    expect(mine.joined).toBe(true);
    // 300 ms away: nothing of theirs has arrived yet, let alone come back.
    expect(theirs.joined).toBe(false);

    settleThrough(server, ...AFTER_SLOW_ROUND_TRIP);
    expect(theirs.joined).toBe(true);
  });

  it('a slow local link leaves the other client crisp', () => {
    const server = new LocalServer(SLOW);
    const peer = server.connect(LAN);
    const mine = new NetClient(server.transport, 'me');
    const theirs = new NetClient(peer.transport, 'them');
    mine.join();
    theirs.join();

    settleThrough(server, 0);
    expect(theirs.joined).toBe(true);
    expect(mine.joined).toBe(false);

    settleThrough(server, ...AFTER_SLOW_ROUND_TRIP);
    expect(mine.joined).toBe(true);
  });

  it('attaching a further client does not re-tune the existing ones', () => {
    const server = new LocalServer(LAN);
    const slow = server.connect(SLOW);
    // The replaced code re-applied one shared set of conditions here, which
    // silently reset every link already attached.
    server.connect(LAN);

    const theirs = new NetClient(slow.transport, 'them');
    theirs.join();
    settleThrough(server, 0);
    expect(theirs.joined).toBe(false);

    settleThrough(server, ...AFTER_SLOW_ROUND_TRIP);
    expect(theirs.joined).toBe(true);
  });

  it('setConditions moves the local link only', () => {
    const server = new LocalServer(DEFAULT_LINK);
    const peer = server.connect(LAN);
    server.setConditions(SLOW);

    const mine = new NetClient(server.transport, 'me');
    const theirs = new NetClient(peer.transport, 'them');
    mine.join();
    theirs.join();

    settleThrough(server, 0);
    expect(theirs.joined).toBe(true);
    expect(mine.joined).toBe(false);
  });

  it('reports in-flight packets per link, not per page', () => {
    const server = new LocalServer(LAN);
    const peer = server.connect(SLOW);
    const theirs = new NetClient(peer.transport, 'them');
    theirs.join();

    server.pump(0);
    // Their Join is still crossing a 300 ms link; mine never sent anything, so
    // the whole page's backlog is theirs and my own reads as the zero it is.
    expect(peer.inFlight).toBeGreaterThan(0);
    expect(server.local.inFlight).toBe(0);
    expect(server.inFlight).toBe(peer.inFlight);
  });
});
