/** Geometry-only construction verification; no perception range, pursuit leash
 * or script grace period. The BVH only selects actual boxes for shared rayWorld.
 */
import { DEFAULT_MOVE_CONFIG, DEFAULT_MUZZLE_RIG, ENEMIES, rayWorld, type WorldBox, type WorldRay } from '@sandline/shared';
import observers from './qalat-observers.json' with { type: 'json' };
import { INSERTION, buildInsertionWorld } from './qalatInsertion.ts';
type Point = { x: number; y: number; z: number };
const point = (p: readonly number[]): Point => ({ x: p[0]!, y: p[1]!, z: p[2]! });

export function sampleRoute(route: readonly (readonly number[])[], maxStepM = 1): Point[] {
  const out: Point[] = [point(route[0]!)];
  for (let i = 1; i < route.length; i++) {
    const a = point(route[i - 1]!), b = point(route[i]!);
    const count = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / maxStepM);
    for (let n = 1; n <= count; n++) out.push({
      x: a.x + (b.x - a.x) * n / count, y: a.y + (b.y - a.y) * n / count, z: a.z + (b.z - a.z) * n / count,
    });
  }
  return out;
}

interface Node { bounds: WorldBox; boxes?: readonly WorldBox[]; children?: readonly Node[] }
function tree(boxes: readonly WorldBox[]): Node {
  const bounds: WorldBox = { id: 'query-bound', kind: 'blocker',
    minX: Math.min(...boxes.map((b) => b.minX)), maxX: Math.max(...boxes.map((b) => b.maxX)),
    minY: Math.min(...boxes.map((b) => b.minY)), maxY: Math.max(...boxes.map((b) => b.maxY)),
    minZ: Math.min(...boxes.map((b) => b.minZ)), maxZ: Math.max(...boxes.map((b) => b.maxZ)) };
  if (boxes.length <= 8) return { bounds, boxes };
  const alongX = bounds.maxX - bounds.minX > bounds.maxZ - bounds.minZ;
  const sorted = [...boxes].sort((a, b) => alongX ? a.minX + a.maxX - b.minX - b.maxX : a.minZ + a.maxZ - b.minZ - b.maxZ);
  const mid = Math.floor(sorted.length / 2);
  return { bounds, children: [tree(sorted.slice(0, mid)), tree(sorted.slice(mid))] };
}

export function rayOccluded(boxes: readonly WorldBox[]): (ray: WorldRay) => boolean {
  if (!boxes.length) return () => false;
  const root = tree(boxes);
  const test = (node: Node, ray: WorldRay): boolean => {
    if (rayWorld(ray, [node.bounds]) === null) return false;
    return node.boxes ? rayWorld(ray, node.boxes) !== null : node.children!.some((c) => test(c, ray));
  };
  return (ray) => test(root, ray);
}

export function between(from: Point, to: Point): WorldRay {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, length = Math.hypot(dx, dy, dz);
  return { origin: from, direction: { x: dx / length, y: dy / length, z: dz / length }, maxDistance: length };
}

export function insertionBodySamples(): Point[] {
  const { pocket } = INSERTION;
  const heights = [...new Set([.05, DEFAULT_MUZZLE_RIG.proneEyeHeight, DEFAULT_MOVE_CONFIG.proneHeight,
    DEFAULT_MUZZLE_RIG.crouchEyeHeight, DEFAULT_MOVE_CONFIG.crouchHeight, DEFAULT_MUZZLE_RIG.eyeHeight, DEFAULT_MOVE_CONFIG.height])];
  const feet: Point[] = [...INSERTION.squadStarts];
  for (let x = pocket.minX; x <= pocket.maxX; x++) for (let z = pocket.minZ; z <= pocket.maxZ; z++) feet.push({ x, y: 8, z });
  return feet.flatMap((p) => heights.map((h) => ({ ...p, y: p.y + h })));
}

export function insertionObservers(): { kind: string; points: Point[] }[] {
  const eyes = (ps: Point[]) => ps.map((p) => ({ ...p, y: p.y + DEFAULT_MUZZLE_RIG.eyeHeight }));
  const tank = ENEMIES['tank']!.vehicle!;
  // Both muzzle recipes and eight orientations include side/rear-facing fire
  // while turning or stopped, not just the route centre or forward tangent.
  const muzzles = sampleRoute(observers.tank).flatMap((p) => [tank.cannon.muzzle, tank.machineGun.muzzle].flatMap(([x, y, z]) =>
    Array.from({ length: 8 }, (_, i) => {
      const a = i * Math.PI / 4;
      return { x: p.x + x * Math.cos(a) + z * Math.sin(a), y: p.y + y, z: p.z + z * Math.cos(a) - x * Math.sin(a) };
    })));
  return [
    { kind: 'guards and reserves', points: eyes([...observers.guards, ...observers.reserve].map(point)) },
    { kind: 'patrol interpolation', points: eyes(observers.patrols.flatMap((r) => sampleRoute(r))) },
    { kind: 'reserve advance interpolation', points: eyes(observers.reserveRoutes.flatMap((r) => sampleRoute(r))) },
    { kind: 'ridge and high observers', points: eyes([...sampleRoute(observers.ridge), ...observers.overlooks.map(point), ...observers.roofProbes.map(point)]) },
    { kind: 'tank route and muzzles', points: muzzles },
  ];
}

export async function verifyInsertionScreening() {
  const world = buildInsertionWorld();
  // Only southern terrain counts. This excludes the temporary road/ridge/depot
  // continuation caps, and proves protection without the rest of the map.
  const southern = world.boxes.filter((b) => b.minZ < 60)
    .map((b) => ({ ...b, maxZ: Math.min(60, b.maxZ) }));
  const cores = southern.filter((b) => INSERTION.rockCores.some((c) => c.id === b.id));
  const blocked = rayOccluded(southern);
  const targets = insertionBodySamples();
  const evidence = [];
  for (const { kind, points } of insertionObservers()) {
    let rays = 0;
    for (const [index, from] of points.entries()) {
      for (const to of targets) {
        const ray = between(from, to); rays++;
        if (rayWorld(ray, cores) === null && !blocked(ray)) throw new Error(`${kind}: unscreened ${JSON.stringify(from)} → ${JSON.stringify(to)}`);
      }
      // Dense CPU verification must still let Vitest flush worker updates.
      if (index % 16 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    evidence.push({ kind, observers: points.length, targets: targets.length, rays, sampleStepM: 1 });
  }
  return evidence;
}
