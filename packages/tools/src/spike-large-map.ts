/**
 * U-076: how big can a three-lane campaign map be? A measuring tool, not a mission.
 *
 * Builds a throwaway grey-box world of three lanes of a chosen length (walls between the lanes with gaps, low cover
 * every few metres, a compound at the far end), centred on the origin, then measures what the engine does with it:
 * the navmesh bake (time, bytes), the cover bake, path queries across the whole map, and a session with a human, five
 * bots and forty enemies (the AI cost bench's load) spread along the map or packed round the squad: the server's
 * tick cost and the bytes sent to one client.
 *
 * Nothing is committed from it; the numbers go on the U-076 card. Run: pnpm spike:large-map [lengthM ...]
 */
import {
  PROTOCOL_VERSION,
  Sfc32,
  TICK_SECONDS,
  buildTree,
  createLoopbackPair,
  encodeMessage,
  loadWorld,
  seedFrom,
  type Message,
  type World,
} from '@sandline/shared';
import { createBrainRegistry } from '../../server/src/ai/Brain.ts';
import { NavMesh, initNav } from '../../server/src/ai/nav/NavMesh.ts';
import { Session } from '../../server/src/session/Session.ts';
import { DEFAULT_NAV_AGENT, bakeNavMesh, bakeWorld, navConfigFor, onMesh, worldSoup } from './nav/bake.ts';
import { coverPoints } from './nav/cover.ts';

const LANE_WIDTH_M = 40;
const LANES = 3;
const WIDTH_M = LANE_WIDTH_M * LANES;
/** Roughly mission-01's own density: one solid box to about 170 m2 of ground, before the walls. */
const COVER_M2_PER_BOX = 170;
const GAP_EVERY_M = 80;
const GAP_M = 6;
const ENEMIES = 40;
const TICKS = 300;

interface Spec {
  id: string;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}

/** A three-lane world `lengthM` long along z, centred on the origin. */
function largeWorld(lengthM: number): World {
  const rng = new Sfc32(seedFrom(76, lengthM));
  const cover: Spec[] = [];
  const box = (id: string, x: number, z: number, w: number, h: number, d: number): void => {
    cover.push({ id: `${id}-${cover.length}`, x, y: h / 2, z, w, h, d });
  };
  const z0 = -lengthM / 2;
  // The outer bounds, and the two walls between the lanes, with a gap every GAP_EVERY_M to cross by.
  for (const x of [-WIDTH_M / 2, WIDTH_M / 2]) box('bound', x, 0, 0.5, 4, lengthM);
  for (const x of [-LANE_WIDTH_M / 2, LANE_WIDTH_M / 2]) {
    for (let z = z0; z < z0 + lengthM; z += GAP_EVERY_M) {
      const segment = Math.min(GAP_EVERY_M - GAP_M, z0 + lengthM - z);
      box('spine', x, z + segment / 2, 0.5, 4, segment);
    }
  }
  // Cover in the lanes, to mission-01's density.
  const count = Math.round((WIDTH_M * lengthM) / COVER_M2_PER_BOX);
  for (let i = 0; i < count; i++) {
    const x = (rng.next() - 0.5) * (WIDTH_M - 4);
    const z = z0 + 6 + rng.next() * (lengthM - 12);
    const crate = rng.next() < 0.4;
    box('cover', x, z, crate ? 1.2 : 4, crate ? 1.2 : 1, crate ? 1.2 : 0.4);
  }
  // A compound across the far end.
  const zc = z0 + lengthM - 20;
  box('compound-n', 0, zc + 6, 16.4, 2.4, 0.4);
  box('compound-w', -8, zc, 0.4, 2.4, 12);
  box('compound-e', 8, zc, 0.4, 2.4, 12);
  box('compound-s', 0, zc - 6, 16.4, 2.4, 0.4);
  return loadWorld({ id: `spike-${lengthM}`, floor: { halfExtent: lengthM / 2 + 10 }, cover });
}

const ms = (n: number) => `${n.toFixed(n < 10 ? 2 : 0)} ms`;
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

/** How the floor is baked: the world's own (always square, centred on the origin) or a rectangle tight to the lanes. */
type FloorMode = 'square' | 'tight';

interface Row {
  mode: FloorMode;
  voxels: number;
  /** Set when the bake failed: nothing else was measured. */
  failed?: string;
  lengthM: number;
  boxes: number;
  areaM2: number;
  bakeMs: number;
  navBytes: number;
  coverMs: number;
  coverPoints: number;
  pathUs: number;
  pathFound: number;
  spread: { tickUs: number; stepUs: number; bytesPerTick: number };
  packed: { tickUs: number; stepUs: number; bytesPerTick: number };
}

/** A session on the world with a human, five bots and `ENEMIES` riflemen; the server's cost per tick and the bytes one client is sent. */
async function session(world: World, mesh: NavMesh, cover: ReturnType<typeof coverPoints>, layout: 'spread' | 'packed') {
  const s = new Session(undefined, '', world, {
    navMesh: mesh,
    cover,
    brainTree: buildTree('friendly', createBrainRegistry()),
    profileAi: true,
  });
  const pair = createLoopbackPair();
  s.addConnection(pair.a, 0);
  pair.b.send(encodeMessage({ kind: 'Join', version: PROTOCOL_VERSION, name: 'lead', room: '' }));
  pair.settle();
  let bytes = 0;
  pair.b.onMessage((b) => {
    bytes += b.length;
  });
  const rng = new Sfc32(seedFrom(40, 0xa1));
  const tree = buildTree('rifleman', createBrainRegistry());
  const half = world.floorHalfExtent - 20;
  const lead = s.slots[0]!.state;
  for (let i = 0; i < ENEMIES; i++) {
    const near = layout === 'packed';
    const x = near ? lead.x + (rng.next() - 0.5) * 60 : (rng.next() - 0.5) * (WIDTH_M - 8);
    const z = near ? lead.z + 20 + rng.next() * 60 : -half + rng.next() * 2 * half;
    s.spawnEnemy('rifleman', { x, y: 0, z, yaw: 512, tree, group: 1 + Math.floor(i / 4) });
  }
  let now = 0;
  let stepMs = 0;
  const t0 = performance.now();
  for (let t = 0; t < TICKS; t++) {
    pair.b.send(encodeMessage({ kind: 'Input', tick: t + 1, moveX: 0, moveY: 1, yaw: 0, pitch: 0, buttons: 0 } as Message));
    pair.settle();
    now += TICK_SECONDS * 1000;
    const a = performance.now();
    s.step(now);
    stepMs += performance.now() - a;
    pair.settle();
  }
  const wall = performance.now() - t0;
  return { tickUs: (wall * 1000) / TICKS, stepUs: (stepMs * 1000) / TICKS, bytesPerTick: bytes / TICKS };
}

async function measure(lengthM: number, mode: FloorMode): Promise<Row> {
  const world = largeWorld(lengthM);
  await initNav();
  const floorW = mode === 'square' ? world.floorHalfExtent * 2 : WIDTH_M + 8;
  const floorD = mode === 'square' ? world.floorHalfExtent * 2 : lengthM + 20;
  const voxels = (floorW / 0.1) * (floorD / 0.1);
  const empty = { tickUs: 0, stepUs: 0, bytesPerTick: 0 };
  const a = performance.now();
  let bytes: Uint8Array;
  try {
    if (mode === 'square') bytes = await bakeWorld(world);
    else {
      // One bare bake over a floor cut to the lanes (no vault links: a measurement, not a shippable mesh).
      const soup = worldSoup(world, DEFAULT_NAV_AGENT.groundY);
      const p = soup.positions;
      p[0] = p[9] = -floorW / 2;
      p[3] = p[6] = floorW / 2;
      p[2] = p[5] = -floorD / 2;
      p[8] = p[11] = floorD / 2;
      bytes = await bakeNavMesh(soup, navConfigFor(DEFAULT_NAV_AGENT));
    }
  } catch (e) {
    return { mode, voxels, failed: (e as Error).message, lengthM, boxes: world.boxes.length, areaM2: WIDTH_M * lengthM, bakeMs: performance.now() - a, navBytes: 0, coverMs: 0, coverPoints: 0, pathUs: 0, pathFound: 0, spread: empty, packed: empty };
  }
  const bakeMs = performance.now() - a;
  const mesh = NavMesh.load(bytes);
  const b = performance.now();
  const cover = coverPoints(world, DEFAULT_NAV_AGENT, (p) => onMesh(mesh, p, DEFAULT_NAV_AGENT.climb));
  const coverMs = performance.now() - b;

  const rng = new Sfc32(seedFrom(7, lengthM));
  const half = lengthM / 2 - 10;
  const pairs = 400;
  let found = 0;
  const c = performance.now();
  for (let i = 0; i < pairs; i++) {
    const from = { x: (rng.next() - 0.5) * (WIDTH_M - 8), y: 0, z: -half + rng.next() * 30 };
    const to = { x: (rng.next() - 0.5) * (WIDTH_M - 8), y: 0, z: half - rng.next() * 30 };
    if (mesh.path(from, to)) found++;
  }
  const pathUs = ((performance.now() - c) * 1000) / pairs;

  const spread = await session(world, mesh, cover, 'spread');
  const packed = await session(world, mesh, cover, 'packed');
  mesh.destroy();
  return {
    mode,
    voxels,
    lengthM,
    boxes: world.boxes.length,
    areaM2: WIDTH_M * lengthM,
    bakeMs,
    navBytes: bytes.length,
    coverMs,
    coverPoints: cover.length,
    pathUs,
    pathFound: found / pairs,
    spread,
    packed,
  };
}

const lengths = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n) && n > 0);
const rows: Row[] = [];
const modes = (process.env['FLOORS'] ?? 'square,tight').split(',') as FloorMode[];
for (const lengthM of lengths.length > 0 ? lengths : [250, 480, 960]) {
  for (const mode of modes) rows.push(await measure(lengthM, mode));
}
console.log(`three lanes of ${LANE_WIDTH_M} m, ${ENEMIES} enemies, ${TICKS} ticks, Node ${process.version}`);
console.log('(mission-01: about 65 x 90 m = 5,800 m2 of play, 34 boxes + kit pieces, a 231 KB navmesh, ~7.3 ms of AI per 7.9 ms tick at 40 enemies)\n');
for (const r of rows) {
  console.log(`${r.lengthM} m long: ${WIDTH_M} x ${r.lengthM} = ${r.areaM2.toLocaleString()} m2 (${(r.areaM2 / 5800).toFixed(1)}x mission-01's play area), ${r.boxes} boxes; ${r.mode} floor baked as ${(r.voxels / 1e6).toFixed(0)}M voxels`);
  if (r.failed) {
    console.log(`  navmesh bake FAILED after ${ms(r.bakeMs)}: ${r.failed}\n`);
    continue;
  }
  console.log(`  navmesh bake ${ms(r.bakeMs)} -> ${kb(r.navBytes)}   cover bake ${ms(r.coverMs)} -> ${r.coverPoints} points`);
  console.log(`  path across the map ${r.pathUs.toFixed(0)} us (${(r.pathFound * 100).toFixed(0)}% found)`);
  for (const [name, x] of [['enemies spread along the map', r.spread], ['enemies packed round the squad', r.packed]] as const) {
    console.log(`  ${name}: ${(x.tickUs / 1000).toFixed(2)} ms/tick (step ${(x.stepUs / 1000).toFixed(2)} ms of the 33.3 ms budget), ${x.bytesPerTick.toFixed(0)} B/tick to one client = ${((x.bytesPerTick * 30 * 8) / 1000).toFixed(0)} kbit/s`);
  }
  console.log('');
}
