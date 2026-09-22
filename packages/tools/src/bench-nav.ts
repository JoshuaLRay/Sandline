/**
 * T-3.01's measurements for the ADR-006 addendum: Recast WASM init, bake time
 * for the spike soup, and µs per Detour query at the three calls M3 makes.
 *
 * Init is measured in a fresh process — it is the one cost paid once per
 * runtime, before a session's first tick. Bake and queries are best of REPS.
 * The browser engines' init and path cost are logged by NavMesh.test.ts under
 * `pnpm test:parity-browsers`.
 *
 * Run: pnpm bench:nav
 */
import { NavMesh, initNav } from '../../server/src/ai/nav/NavMesh.ts';
import { SPIKE_BOXES, SPIKE_FLOOR_HALF_EXTENT, SPIKE_FROM, SPIKE_TO, bakeNavMesh, boxSoup } from './nav/bake.ts';

const REPS = 5;
const QUERIES = 5000;

const t0 = performance.now();
await initNav();
const initMs = performance.now() - t0;

const soup = boxSoup(SPIKE_FLOOR_HALF_EXTENT, SPIKE_BOXES);
let bakeMs = Infinity;
let bytes: Uint8Array = new Uint8Array();
for (let i = 0; i < REPS; i++) {
  const t = performance.now();
  bytes = await bakeNavMesh(soup);
  bakeMs = Math.min(bakeMs, performance.now() - t);
}

const mesh = NavMesh.load(bytes);
function perQuery(run: () => unknown): number {
  let best = Infinity;
  for (let r = 0; r < REPS; r++) {
    const t = performance.now();
    for (let i = 0; i < QUERIES; i++) run();
    best = Math.min(best, ((performance.now() - t) * 1000) / QUERIES);
  }
  return best;
}
const pathUs = perQuery(() => mesh.path(SPIKE_FROM, SPIKE_TO));
const nearestUs = perQuery(() => mesh.nearestPoint(SPIKE_FROM));
const rayUs = perQuery(() => mesh.raycast(SPIKE_FROM, SPIKE_TO));
mesh.destroy();

console.log(`recast-navigation, Node ${process.version}`);
console.log(`  WASM init        ${initMs.toFixed(1)} ms (once per runtime)`);
console.log(`  bake (spike)     ${bakeMs.toFixed(1)} ms  → ${bytes.length} bytes`);
console.log(`  path (47 m, round the wall)  ${pathUs.toFixed(1)} µs`);
console.log(`  nearest point    ${nearestUs.toFixed(1)} µs`);
console.log(`  mesh raycast     ${rayUs.toFixed(1)} µs`);
