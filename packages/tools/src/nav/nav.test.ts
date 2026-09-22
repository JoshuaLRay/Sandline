/**
 * The committed world bakes (T-3.03): fresh, and a mesh a soldier could
 * actually walk.
 *
 * STALENESS. Each committed bake stores the hash of every input that decided
 * it. This recomputes the hash from the LIVE world data and agent; an edited
 * box, a retuned step height or a new capsule radius fails here until
 * `pnpm gen:nav` is re-run (ADR-006: the level pipeline and the bake must not
 * silently drift).
 *
 * WALKABILITY. Loaded from the committed bytes, as the server will: every
 * spawn point and range target is on the mesh; there are paths from spawn to
 * the far end of the range and to both sides of both long walls; and no
 * segment of any of those paths passes through a box at knee height, checked
 * with the same `rayWorld` the server shoots with.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG,
  RANGE_TARGETS,
  SPAWN_POINTS,
  WORLD_IDS,
  loadWorld,
  rayWorld,
  requireWorld,
} from '@sandline/shared';
import RANGE_FILE from '../../../shared/src/data/worlds/range.json' with { type: 'json' };
import { NavMesh, type NavPath, type NavPoint, initNav, pathLength } from '../../../server/src/ai/nav/NavMesh.ts';
import { bakedNavFor, loadWorldNavMesh } from '../../../server/src/ai/nav/bakedNav.ts';
import { DEFAULT_HITBOX } from '../../../server/src/net/lagComp.ts';
import { DEFAULT_NAV_AGENT, bakeWorld, navAgentFrom, navBakeHash } from './bake.ts';

/** Knee height above the path, where a box that blocks a soldier's legs sits. */
const KNEE_M = 0.5;
/** How close a snapped point must be, across the ground, to count as "on the mesh". */
const ON_MESH_M = 0.05;
/** How close a path's last point must come to the goal to have reached it. */
const ARRIVED_M = 0.1;

const range = requireWorld('range');

describe('committed bakes are fresh (T-3.03)', () => {
  it('every world has a bake, for today’s agent, whose hash matches the live data', () => {
    for (const id of WORLD_IDS) {
      const baked = bakedNavFor(id);
      expect(baked, `no bake for '${id}' — run pnpm gen:nav`).toBeDefined();
      expect(baked!.agent).toEqual(DEFAULT_NAV_AGENT);
      expect(baked!.hash, `bake for '${id}' is stale — run pnpm gen:nav`).toBe(navBakeHash(requireWorld(id)));
    }
  });

  it('derives the agent from MoveConfig and the hitbox, not from numbers of its own', () => {
    expect(DEFAULT_NAV_AGENT).toEqual({
      radius: Math.max(DEFAULT_MOVE_CONFIG.radius, DEFAULT_HITBOX.radius),
      height: DEFAULT_MOVE_CONFIG.height,
      climb: DEFAULT_MOVE_CONFIG.stepHeight,
      groundY: DEFAULT_MOVE_CONFIG.groundY,
      vaultMaxHeight: DEFAULT_MOVE_CONFIG.vaultMaxHeight,
      vaultDistance: DEFAULT_MOVE_CONFIG.vaultDistance,
      vaultProbe: DEFAULT_MOVE_CONFIG.vaultProbe,
    });
  });

  it('goes stale when a box in the world data is edited, or the agent is retuned', () => {
    const committed = bakedNavFor('range')!.hash;
    const edited = structuredClone(RANGE_FILE) as { cover: { id: string; x: number }[] };
    edited.cover.find((b) => b.id === 'low-wall')!.x += 0.1;
    expect(navBakeHash(loadWorld(edited))).not.toBe(committed);

    const higherStep = navAgentFrom({ ...DEFAULT_MOVE_CONFIG, stepHeight: 0.6 }, DEFAULT_HITBOX);
    expect(navBakeHash(range, higherStep)).not.toBe(committed);
    const widerBody = navAgentFrom(DEFAULT_MOVE_CONFIG, { ...DEFAULT_HITBOX, radius: 0.5 });
    expect(navBakeHash(range, widerBody)).not.toBe(committed);

    // The unedited data still matches: the hash is a function of the inputs.
    expect(navBakeHash(loadWorld(structuredClone(RANGE_FILE)))).toBe(committed);
  });
});

describe('the range navmesh, from the committed bytes (T-3.03)', () => {
  let mesh: NavMesh;
  beforeAll(async () => {
    await initNav();
    mesh = loadWorldNavMesh('range');
  });

  function reach(from: NavPoint, to: NavPoint): NavPath {
    const path = mesh.path(from, to);
    expect(path, `no path ${JSON.stringify(from)} → ${JSON.stringify(to)}`).not.toBeNull();
    const last = path!.points[path!.points.length - 1]!;
    expect(Math.hypot(last.x - to.x, last.z - to.z), 'path stopped short of the goal').toBeLessThan(ARRIVED_M);
    return path!;
  }

  /**
   * Every WALKED segment, raised to knee height, against the world's boxes.
   * A vault leg (T-3.04) crosses its box on purpose; `vaults` names those
   * legs by their first point, and `vaultLegsCross` checks them separately.
   */
  function throughABox(points: readonly NavPoint[], vaults: readonly number[] = []): string | null {
    for (let i = 1; i < points.length; i++) {
      if (vaults.includes(i - 1)) continue;
      const a = points[i - 1]!;
      const b = points[i]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (length === 0) continue;
      const hit = rayWorld(
        {
          origin: { x: a.x, y: a.y + KNEE_M, z: a.z },
          direction: { x: dx / length, y: dy / length, z: dz / length },
          maxDistance: length,
        },
        range.boxes,
      );
      if (hit) return `segment ${i} crosses '${hit.box.id}' at ${hit.distance.toFixed(2)} m`;
    }
    return null;
  }

  it('the knee check itself catches a segment through a wall (so a pass means something)', () => {
    expect(throughABox([{ x: -11.5, y: 0, z: 2 }, { x: -11.5, y: 0, z: 6 }])).toMatch(/west-wall-a/);
    expect(throughABox([{ x: -11.5, y: 0, z: 2 }, { x: -11.5, y: 0, z: 3 }])).toBeNull();
  });

  it('has every spawn point and range target on it', () => {
    for (const p of [...SPAWN_POINTS, ...RANGE_TARGETS]) {
      const near = mesh.nearestPoint(p);
      expect(near, `nothing near ${JSON.stringify(p)}`).not.toBeNull();
      expect(Math.hypot(near!.point.x - p.x, near!.point.z - p.z)).toBeLessThan(ON_MESH_M);
      expect(Math.abs(near!.point.y - p.y)).toBeLessThan(0.2);
    }
  });

  const spawn = SPAWN_POINTS[0]!;
  const farTarget = RANGE_TARGETS[RANGE_TARGETS.length - 1]!;
  /** Both sides of each long wall (z = 4), and the far end of the range. */
  const goals: Record<string, NavPoint> = {
    'far end of the range': { x: farTarget.x, y: 0, z: farTarget.z },
    'south of the west wall': { x: -11.5, y: 0, z: 2 },
    'north of the west wall': { x: -11.5, y: 0, z: 6 },
    'south of the east wall': { x: 12.5, y: 0, z: 2 },
    'north of the east wall': { x: 12.5, y: 0, z: 6 },
  };

  for (const [name, goal] of Object.entries(goals)) {
    it(`paths from spawn to the ${name}, never walking through a box at knee height`, () => {
      const path = reach(spawn, goal);
      expect(throughABox(path.points, path.vaults)).toBeNull();
      // Any vault on the way is over the one box on the range that has links.
      for (const i of path.vaults) {
        expect(throughABox([path.points[i]!, path.points[i + 1]!])).toMatch(/'low-wall'/);
      }
    });
  }

  it('routes round a wall it cannot cross: north of the west wall is further than the straight line', () => {
    const north = goals['north of the west wall']!;
    const path = reach({ x: -11.5, y: 0, z: 2 }, north);
    // 4 m straight through the 2.4 m wall; the doorway or its end is longer.
    expect(pathLength(path.points)).toBeGreaterThan(4.5);
    expect(path.vaults).toEqual([]);
    expect(throughABox(path.points)).toBeNull();
  });
});

describe('a gap narrower than a soldier is not walkable (T-3.03)', () => {
  /** A 40 m barrier across z = 0 with one gap of `gap` metres at x = 0. */
  function gapWorld(gap: number) {
    const half = 20;
    const side = half - gap / 2;
    return loadWorld({
      id: 'gap',
      floor: { halfExtent: 25 },
      cover: [
        { id: 'west', x: -(gap / 2 + side / 2), y: 0, z: 0, w: side, h: 2.4, d: 0.3 },
        { id: 'east', x: gap / 2 + side / 2, y: 0, z: 0, w: side, h: 2.4, d: 0.3 },
      ],
    });
  }

  async function crossing(gap: number): Promise<number> {
    await initNav();
    const mesh = NavMesh.load(await bakeWorld(gapWorld(gap)));
    const path = mesh.path({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 5 });
    mesh.destroy();
    expect(path).not.toBeNull();
    return pathLength(path!.points);
  }

  it('sends a soldier round the barrier rather than through a 0.6 m gap (capsule is 0.7 m)', async () => {
    expect(await crossing(0.6)).toBeGreaterThan(40);
  });

  it('walks straight through a 1.2 m gap', async () => {
    expect(await crossing(1.2)).toBeLessThan(10.5);
  });
});
