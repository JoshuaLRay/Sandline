/**
 * The AI debug report on the session (T-3.09).
 *
 * Real `Session`s over loopback, every byte a client receives counted: a host
 * without the flag must send nothing, a client that did not ask must receive
 * nothing, and the one that asked gets every brain's reasons at 10 Hz.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ClientConnection,
  MAX_SLOTS,
  type Message,
  buildTree,
  createLoopbackPair,
  decodeMessage,
  parseTreeDef,
  spawnFor,
} from '@sandline/shared';
import { type NavMesh, initNav } from './nav/NavMesh.ts';
import { loadWorldNavMesh } from './nav/bakedNav.ts';
import { Session, type SessionOptions } from '../session/Session.ts';
import { BRAIN_PERIOD_TICKS, type BrainTree, createBrainRegistry } from './Brain.ts';

const TICK_MS = 1000 / 30;
type Report = Extract<Message, { kind: 'AiDebug' }>;

/** A client over loopback that counts every byte it is sent, and the AiDebug bytes apart. */
function client(session: Session, name: string) {
  const pair = createLoopbackPair();
  session.addConnection(pair.a, 0);
  const conn = new ClientConnection(pair.b, {});
  const reports: Report[] = [];
  let bytes = 0;
  let aiDebugBytes = 0;
  pair.b.onMessage((data) => {
    bytes += data.length;
    const msg = decodeMessage(data);
    if (msg.kind !== 'AiDebug') return;
    aiDebugBytes += data.length;
    reports.push(msg);
  });
  conn.join(name);
  pair.settle();
  return {
    reports,
    get bytes() {
      return bytes;
    },
    get aiDebugBytes() {
      return aiDebugBytes;
    },
    ask(on: boolean) {
      conn.send({ kind: 'AiDebugRequest', on });
      pair.settle();
    },
    settle() {
      pair.settle();
    },
    leave() {
      pair.b.close('gone');
      pair.settle();
    },
  };
}

function run(session: Session, ticks: number, clients: { settle(): void }[], from = 0): number {
  let now = from;
  for (let i = 0; i < ticks; i++) {
    now += TICK_MS;
    session.step(now);
    for (const c of clients) c.settle();
  }
  return now;
}

/** Every bot walks four metres north of its spawn, through a sequence so the path has depth. */
function walkingTree(): BrainTree {
  const registry = createBrainRegistry().action('walk', ({ ctx, blackboard }) => {
    const spawn = spawnFor(ctx.netId - 1);
    blackboard.set('intent', { goal: { x: spawn.x, y: spawn.y, z: spawn.z + 4 }, pace: 'walk' });
    return 'running';
  });
  return buildTree(
    parseTreeDef({ id: 'test-walk', root: { type: 'sequence', children: [{ type: 'action', name: 'walk' }] } }),
    registry,
  );
}

describe('AI debug reports (T-3.09)', () => {
  let mesh: NavMesh;
  beforeAll(async () => {
    await initNav();
    mesh = loadWorldNavMesh('range');
  });

  function session(options: SessionOptions): Session {
    return new Session(undefined, '', undefined, { brainTree: walkingTree(), navMesh: mesh, ...options });
  }

  it('a host without the flag sends nothing, even to a client that asked', () => {
    const s = session({});
    const asker = client(s, 'asker');
    asker.ask(true);
    run(s, 90, [asker]);
    expect(asker.aiDebugBytes).toBe(0);
    expect(asker.reports).toHaveLength(0);
    expect(s.stats.aiDebugSent).toBe(0);
    expect(s.stats.aiDebugBytesSent).toBe(0);
    console.log(`[T-3.09] flagless host: asker received ${asker.bytes} B, 0 of them AI debug`);
  });

  it('a host with the flag sends only to the client that asked; the other receives exactly what it would without the flag', () => {
    const quietRef = (() => {
      const s = session({});
      const a = client(s, 'asker');
      const b = client(s, 'quiet');
      a.ask(true);
      run(s, 90, [a, b]);
      return b.bytes;
    })();

    const s = session({ aiDebug: true });
    const asker = client(s, 'asker');
    const quiet = client(s, 'quiet');
    asker.ask(true);
    run(s, 90, [asker, quiet]);

    expect(quiet.aiDebugBytes).toBe(0);
    expect(quiet.reports).toHaveLength(0);
    // Byte for byte what the same client gets from a host that never allowed it.
    expect(quiet.bytes).toBe(quietRef);
    // 10 Hz: one report every third tick, 30 over 90 ticks.
    expect(asker.reports).toHaveLength(90 / BRAIN_PERIOD_TICKS);
    for (const r of asker.reports) expect(r.tick % BRAIN_PERIOD_TICKS).toBe(0);
    expect(asker.aiDebugBytes).toBe(s.stats.aiDebugBytesSent);
    expect(s.stats.aiDebugSent).toBe(asker.reports.length);
    console.log(
      `[T-3.09] flag on: asker ${asker.aiDebugBytes} B AI debug in ${asker.reports.length} reports ` +
        `(~${Math.round(asker.aiDebugBytes / asker.reports.length)} B each, ${Math.round((asker.aiDebugBytes / 90) * 30)} B/s); quiet 0 B`,
    );
  });

  it('reports every bot brain: tree path, intent, corridor and position', () => {
    const s = session({ aiDebug: true });
    const asker = client(s, 'asker');
    asker.ask(true);
    run(s, 12, [asker]);
    const last = asker.reports.at(-1)!;
    // The asker holds one slot; the other five are bots.
    expect(last.brains).toHaveLength(MAX_SLOTS - 1);
    const seated = s.slots.find((slot) => !slot.isBot)!;
    expect(last.brains.map((b) => b.netId)).not.toContain(seated.netId);
    for (const b of last.brains) {
      const slot = s.slots.find((sl) => sl.netId === b.netId)!;
      expect(b.tree).toEqual(['root sequence', 'root.children[0] action:walk']);
      const spawn = spawnFor(slot.index);
      expect(b.intent?.pace).toBe('walk');
      expect(Math.abs(b.intent!.z - (spawn.z + 4))).toBeLessThan(0.01);
      expect(b.corridor.length).toBeGreaterThanOrEqual(2);
      expect(Math.abs(b.corridor.at(-1)!.z - (spawn.z + 4))).toBeLessThan(0.5);
      // Position as of the report's tick, to the wire's 1/64 m.
      expect(Math.abs(b.position.x - slot.state.x)).toBeLessThan(1 / 64);
      expect(Math.abs(b.position.z - slot.state.z)).toBeLessThan(1 / 64);
      // Nothing to perceive or hide behind until T-3.13 and T-3.18.
      expect(b.cones).toEqual([]);
      expect(b.targets).toEqual([]);
      expect(b.cover).toBeNull();
    }
  });

  it('stops when the client says so, and forgets a client that leaves', () => {
    const s = session({ aiDebug: true });
    const asker = client(s, 'asker');
    asker.ask(true);
    let now = run(s, 30, [asker]);
    const before = asker.reports.length;
    expect(before).toBe(10);
    asker.ask(false);
    now = run(s, 30, [asker], now);
    expect(asker.reports.length).toBe(before);

    asker.ask(true);
    now = run(s, 3, [asker], now);
    expect(asker.reports.length).toBe(before + 1);
    const sent = s.stats.aiDebugSent;
    asker.leave();
    run(s, 30, [], now);
    expect(s.stats.aiDebugSent).toBe(sent);
  });
});
