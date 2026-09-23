/**
 * Measures actual snapshot bandwidth against the ADR-012 budget.
 *
 * Budget: ~18 KB/s down per player (~50 entities x ~12 B x 30 Hz).
 * Any design exceeding 40 KB/s needs review.
 *
 * Two measurements. The first is synthetic: fifty made-up entities through the
 * delta codec alone. The second (T-3.12) is the real thing: a `Session` on the
 * range with six slots and forty enemies all walking on the navmesh, one
 * client seated and acknowledging, and the bytes that client is actually sent
 * — message framing, per-client relevance and all.
 *
 * Run: pnpm bench:bandwidth
 */
import { BitWriter } from '../../shared/src/net/BitStream.ts';
import { COMPONENT_IDS } from '../../shared/src/ecs/components.ts';
import { writeDelta } from '../../shared/src/net/delta.ts';
import { writeSnapshot, type WorldSnapshot } from '../../shared/src/net/snapshot.ts';
import { Sfc32 } from '../../shared/src/math/prng.ts';
import {
  BtRegistry,
  PROTOCOL_VERSION,
  SnapshotStore,
  buildTree,
  createLoopbackPair,
  decodeMessage,
  encodeMessage,
  parseTreeDef,
} from '@sandline/shared';
import { Session } from '@sandline/server';
import type { BrainBody, BrainMemory, BrainTree } from '@sandline/server/brain';
import { initNav } from '@sandline/server/nav';
import { loadWorldNavMesh } from '@sandline/server/nav/baked';

const T = COMPONENT_IDS.Transform;
const V = COMPONENT_IDS.Velocity;
const H = COMPONENT_IDS.Health;
const ENTITIES = 50;
const TICKS = 300;
const HZ = 30;

const rng = new Sfc32(2024);
let world: WorldSnapshot = {
  tick: 0,
  entities: Array.from({ length: ENTITIES }, (_, i) => ({
    netId: i + 1,
    components: {
      [T]: [32768 + i * 40, 1000, 32768, (i * 37) % 1024, 512],
      [V]: [2048, 2048, 2048],
      [H]: [100, 100, 0, 0, 0, 0],
    },
  })),
};

const fullW = new BitWriter();
writeSnapshot(fullW, world);
const fullBytes = fullW.byteLength;

// Roughly a third of a squad moves on any given tick in a firefight.
let deltaTotal = 0;
for (let tick = 1; tick <= TICKS; tick++) {
  const next: WorldSnapshot = {
    tick,
    entities: world.entities.map((e) => {
      if (rng.nextUint32() % 3 !== 0) return e;
      const t = e.components[T] as number[];
      return {
        netId: e.netId,
        components: { ...e.components, [T]: [(t[0]! + 4) % 65536, t[1]!, (t[2]! + 2) % 65536, (t[3]! + 3) % 1024, t[4]!] },
      };
    }),
  };
  const w = new BitWriter();
  writeDelta(w, next, world);
  deltaTotal += w.byteLength;
  world = next;
}

const avgDelta = deltaTotal / TICKS;
const fullRate = (fullBytes * HZ) / 1024;
const deltaRate = (avgDelta * HZ) / 1024;

console.log(`${ENTITIES} entities (Transform + Velocity + Health), ${TICKS} ticks at ${HZ}Hz\n`);
console.log(`  full snapshot    ${fullBytes.toString().padStart(5)} B   ${(fullBytes / ENTITIES).toFixed(1)} B/entity   ${fullRate.toFixed(1)} KB/s if resent every tick`);
console.log(`  average delta    ${avgDelta.toFixed(0).padStart(5)} B   ${(avgDelta / ENTITIES).toFixed(1)} B/entity   ${deltaRate.toFixed(1)} KB/s`);
console.log(`  delta saves      ${(100 - (avgDelta / fullBytes) * 100).toFixed(1)}% versus full snapshots\n`);
console.log(`ADR-012 budget: ~18 KB/s per player, review needed above 40 KB/s.`);
console.log(verdict(deltaRate));

/* -- Six slots and forty moving enemies, on a real session (T-3.12) -------- */

const ENEMIES = 40;
const SECONDS = 20;
const WARMUP_TICKS = 30;
const PATROL_M = 14;

function verdict(rate: number): string {
  return rate <= 18
    ? `VERDICT: ${rate.toFixed(1)} KB/s is inside the 18 KB/s budget.`
    : rate <= 40
      ? `VERDICT: ${rate.toFixed(1)} KB/s is over the 18 KB/s target but under the 40 KB/s review line.`
      : `VERDICT: ${rate.toFixed(1)} KB/s EXCEEDS the review line. Revisit ADR-012.`;
}

/**
 * Everyone walks: each body paces PATROL_M metres up range from wherever it
 * first thinks, and back, forever. One tree, routes keyed by netId, so the five
 * bot slots and the forty enemies all share it.
 */
function patrolEveryone(): BrainTree {
  const routes = new Map<number, { a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number }; toB: boolean }>();
  const registry = new BtRegistry<BrainBody, BrainMemory>().action('patrol', ({ blackboard, ctx }) => {
    let route = routes.get(ctx.netId);
    if (!route) {
      const a = { x: ctx.state.x, y: 0, z: ctx.state.z };
      route = { a, b: { ...a, z: a.z + PATROL_M }, toB: true };
      routes.set(ctx.netId, route);
    }
    const goal = route.toB ? route.b : route.a;
    if (Math.hypot(goal.x - ctx.state.x, goal.z - ctx.state.z) < 1.2) route.toB = !route.toB;
    blackboard.set('intent', { goal: route.toB ? route.b : route.a, pace: 'walk' });
    return 'running';
  });
  return buildTree(parseTreeDef({ id: 'bench-patrol', root: { type: 'action', name: 'patrol' } }), registry);
}

await initNav();
const tree = patrolEveryone();
const session = new Session(undefined, '', 'range', { navMesh: loadWorldNavMesh('range'), brainTree: tree });

// Eight lanes clear of the firing lane and the post grid, five rows up range:
// every one inside 120 m of the spawn line, so all 46 are in the client's view
// and this is the full cost, not what the radius saves.
const lanes = [-65, -45, -25, -15, 15, 25, 45, 65];
const rows = [12, 28, 44, 60, 74];
for (const x of lanes) {
  for (const z of rows) session.spawnEnemy('rifleman', { x, y: 0, z, tree });
}
if (session.enemies.length !== ENEMIES) throw new Error(`spawned ${session.enemies.length} enemies, wanted ${ENEMIES}`);

const pair = createLoopbackPair();
session.addConnection(pair.a, 0);
const store = new SnapshotStore();
let received = 0;
let counting = false;
pair.b.onMessage((bytes) => {
  if (counting) received += bytes.length;
  const msg = decodeMessage(bytes);
  if (msg.kind !== 'Delta') return;
  if (store.applyDelta(msg.tick, msg.baselineTick, msg.payload).ok) pair.b.send(encodeMessage({ kind: 'Ack', tick: msg.tick }));
});
pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'bench', room: '' }));
pair.settle();

const tickMs = 1000 / HZ;
for (let i = 1; i <= WARMUP_TICKS; i++) {
  session.step(i * tickMs);
  pair.settle();
}
counting = true;
const bodies = () => [...session.slots, ...session.enemies];
const startAt = new Map(bodies().map((b) => [b.netId, { x: b.state.x, z: b.state.z }]));
const measured = SECONDS * HZ;
for (let i = WARMUP_TICKS + 1; i <= WARMUP_TICKS + measured; i++) {
  session.step(i * tickMs);
  pair.settle();
  for (const b of bodies()) {
    const at = startAt.get(b.netId);
    if (at && Math.hypot(b.state.x - at.x, b.state.z - at.z) > 2) startAt.delete(b.netId);
  }
}
const travelled = ENEMIES + session.slots.length - startAt.size;

const inView = store.current?.entities.length ?? 0;
const sessionRate = received / SECONDS / 1024;
console.log(`\n${session.slots.length} slots + ${session.enemies.length} enemies, one client seated and standing, everyone else walking, ${SECONDS} s at ${HZ}Hz\n`);
console.log(`  entities in view ${inView.toString().padStart(5)}   ${travelled} of them walked more than 2 m`);
console.log(`  bytes received   ${received.toString().padStart(5)} B   ${(received / measured).toFixed(0)} B/tick   ${sessionRate.toFixed(1)} KB/s`);
console.log(verdict(sessionRate));
session.close();
// The seated client's own slot stands (it sends no input); everyone else must
// have walked, or the number above flatters the design.
if (travelled < ENEMIES + session.slots.length - 1) throw new Error(`only ${travelled} bodies walked`);
export {};
