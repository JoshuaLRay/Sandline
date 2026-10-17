import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { NavMesh, completePathLength, initNav, type NavPoint } from '../../server/src/ai/nav/NavMesh.ts';
import { loadWorldNavMesh } from '../../server/src/ai/nav/bakedNav.ts';
import { approachGraphSchema, type ApproachGraph } from './maps/approachGraph.ts';

let checkId = 0;

export function approachGraphFile(world: string): string {
  return fileURLToPath(new URL(`./maps/approaches/${world}.json`, import.meta.url));
}

export function readApproachGraph(path: string): ApproachGraph {
  return approachGraphSchema.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
}

/** Mutates only a private blocker namespace, always restored before returning.
 * Bot and escort share the standing nav/character dimensions in production.
 * Complete 3D endpoints reject partial corridors and wrong-floor projections.
 */
export function checkApproachGraph(raw: unknown, nav: Pick<NavMesh, 'path' | 'setBlocker' | 'connected'>): string[] {
  const g = approachGraphSchema.parse(raw), issues: string[] = [];
  const separatedPair = (a: string, b: string) => g.separations.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
  const reaches = (a: NavPoint, b: NavPoint) => completePathLength(nav.path(a, b), a, b) !== null;
  const directions = (a: NavPoint, b: NavPoint) => [[a, b], [b, a]] as const;
  for (const approach of g.approaches) {
    for (let i = 1; i < approach.waypoints.length; i++) {
      for (const [a, b] of directions(approach.waypoints[i - 1]!, approach.waypoints[i]!))
        if (!reaches(a, b)) issues.push(`${approach.id}: incomplete outward/return leg ${i} from ${JSON.stringify(a)}`);
    }
  }
  const namespace = ++checkId;
  const keys = g.connections.map((_, i) => `approach-check/${namespace}/${i}`);
  const toggle = (i: number, active: boolean) => nav.setBlocker(keys[i]!, g.connections[i]!.cuts, active);
  try {
    g.connections.forEach((_, i) => toggle(i, true));
    // Explicit interior probes exclude shared start/objective spaces. Never
    // silently discard probes swallowed by an overbroad cut.
    const retained = new Map(g.approaches.map((a) => [a.id, a.probes]));
    const separated = new Set(g.separations.flat());
    for (const a of g.approaches) {
      if (!separated.has(a.id)) continue;
      const probes = retained.get(a.id)!;
      for (const p of probes) {
        if (!reaches(p, p)) issues.push(`${a.id}: cut removes approach waypoint ${JSON.stringify(p)}`);
        for (const [from, to] of directions(probes[0]!, p))
          if (!reaches(from, to)) issues.push(`${a.id}: cut breaks approach continuity`);
      }
    }
    for (const [a, b] of g.separations) {
      // All retained waypoint pairs, both ways: one-way drops are shortcuts too.
      if (retained.get(a)!.some((p) => retained.get(b)!.some((q) => nav.connected(p, q) || nav.connected(q, p))))
        issues.push(`${a}/${b}: undeclared adjacency with all registered connections closed`);
    }
    for (const c of g.connections) for (const e of c.endpoints) {
      const probes = retained.get(e.approach)!;
      if (separated.has(e.approach) && !probes.some((p) => reaches(p, e.point) && reaches(e.point, p)))
        issues.push(`${c.id}: endpoint detached from ${e.approach}`);
    }
    // Restore each connection alone. An unrelated hub must not make a missing
    // crossing look connected; its endpoints must actually become reachable.
    for (const [i, c] of g.connections.entries()) {
      toggle(i, false);
      const pairs = c.endpoints.flatMap((a, j) => c.endpoints.slice(j + 1).flatMap((b): (readonly [NavPoint, NavPoint])[] =>
        c.direction === 'both' ? [...directions(a.point, b.point)] : [[a.point, b.point]]));
      for (const [a, b] of pairs) {
        if (!reaches(a, b)) issues.push(`${c.id}: declared ${c.kind} missing from ${JSON.stringify(a)}`);
      }
      if (c.direction === 'forward' && separatedPair(c.endpoints[0]!.approach, c.endpoints[1]!.approach)
        && nav.connected(c.endpoints[1]!.point, c.endpoints[0]!.point))
        issues.push(`${c.id}: undeclared reverse direction`);
      toggle(i, true);
      for (const a of c.endpoints) for (const b of c.endpoints) {
        if (separatedPair(a.approach, b.approach) && nav.connected(a.point, b.point))
          issues.push(`${c.id}: cut does not isolate its endpoints`);
      }
    }
  } finally {
    g.connections.forEach((_, i) => toggle(i, false));
  }
  return issues;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2), path = args.find((a) => !a.startsWith('--')) ?? approachGraphFile('qalat-road');
  if (args.some((a) => a.startsWith('--') && a !== '--schema-only')) throw new Error('Unknown flag');
  const graph = readApproachGraph(path);
  if (args.includes('--schema-only')) {
    console.log(`${graph.world}/${graph.stage}: schema valid; navigation NOT RUN`);
    return;
  }
  await initNav();
  const nav = loadWorldNavMesh(graph.world);
  try {
    const issues = checkApproachGraph(graph, nav);
    console.log(JSON.stringify({ world: graph.world, stage: graph.stage, approaches: graph.approaches.length,
      separations: graph.separations.length, connections: graph.connections.length, issues }));
    if (issues.length) process.exitCode = 1;
  } finally { nav.destroy(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });

export function checkWorldApproaches(world: string, nav: NavMesh): string[] {
  const path = approachGraphFile(world);
  if (!existsSync(path)) return [];
  const graph = readApproachGraph(path);
  if (graph.world !== world) throw new Error(`${path}: world mismatch`);
  return checkApproachGraph(graph, nav);
}
