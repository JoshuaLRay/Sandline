/**
 * Enemies on the in-page range, for eyes (T-3.11): `?enemies` in the URL.
 *
 * Nothing spawns enemies yet — that is E-3.9's spawner — and every committed
 * tree stands still, so without this there is nothing in the page to look at
 * when judging how an enemy is drawn. This puts three riflemen downrange in
 * the in-page session: one standing at ~46 m facing the spawn line (the
 * "reads as the other side at 40 m" distance), and two walking patrols across
 * the range, so the gait, the corpse and the despawn can all be seen. A
 * killed one lies for its archetype's corpse time, despawns, and a fresh one
 * takes its place.
 *
 * The patrol is a QA fixture tree, not an enemy behaviour: it walks between
 * two points and knows nothing else. Real trees are T-3.14 onward. It needs
 * the range's navmesh in the session, which is why `?enemies` is also the one
 * page that loads the bake.
 */
import { BtRegistry, buildTree, parseTreeDef } from '@sandline/shared';
import type { BrainBody, BrainMemory, BrainTree } from '@sandline/server/brain';
import type { LocalServer } from './LocalServer.ts';

interface Point {
  x: number;
  y: number;
  z: number;
}

interface Placement {
  at: Point;
  /** Facing, wire units (1024 a turn); 512 faces the spawn line. */
  yaw: number;
  /** Walk between `at` and this, or stand when absent. */
  to?: Point;
}

/**
 * Clear of the firing lane (x -4.2..6), the cover and the post grid (posts
 * every 10 m on the multiples of ten, which the navmesh walks round anyway).
 */
export const QA_ENEMY_PLACEMENTS: readonly Placement[] = [
  { at: { x: -5, y: 0, z: 40 }, yaw: 512 },
  { at: { x: -15, y: 0, z: 22 }, yaw: 0, to: { x: -15, y: 0, z: 38 } },
  { at: { x: 14, y: 0, z: 32 }, yaw: 512, to: { x: 14, y: 0, z: 18 } },
];

/** How close, across the ground, counts as having reached a patrol end. */
const TURN_RADIUS_M = 1.2;

/** A tree that walks between two points forever. */
export function patrolTree(a: Point, b: Point): BrainTree {
  let goal = b;
  const registry = new BtRegistry<BrainBody, BrainMemory>().action('patrol', ({ blackboard, ctx }) => {
    const dx = goal.x - ctx.state.x;
    const dz = goal.z - ctx.state.z;
    if (dx * dx + dz * dz < TURN_RADIUS_M * TURN_RADIUS_M) goal = goal === b ? a : b;
    blackboard.set('intent', { goal, pace: 'walk' });
    return 'running';
  });
  return buildTree(parseTreeDef({ id: 'qa-patrol', root: { type: 'action', name: 'patrol' } }), registry);
}

export class QaEnemies {
  private readonly netIds: (number | null)[] = QA_ENEMY_PLACEMENTS.map(() => null);

  constructor(private readonly server: LocalServer) {
    this.step();
  }

  /** Respawn any placement whose enemy has despawned. Cheap; call once a tick. */
  step(): void {
    const live = this.server.enemyNetIds;
    QA_ENEMY_PLACEMENTS.forEach((placement, i) => {
      const current = this.netIds[i];
      if (current != null && live.includes(current)) return;
      const { at, to, yaw } = placement;
      this.netIds[i] = this.server.spawnEnemy('rifleman', {
        ...at,
        yaw,
        ...(to ? { tree: patrolTree(at, to) } : {}),
      });
    });
  }
}

/**
 * `?suppress` (T-3.17): one rifleman 25 m up the firing lane shooting at the
 * squadmate in slot 1, who stands 1.5 m beside the player's spawn in slot 0.
 * Its misses go past the player's camera, which is the point: a way to see
 * the vignette, the colour draining and the jolt without being the one shot.
 * A QA fixture like the patrol, not an enemy behaviour — it fires at one
 * netId and knows nothing else — and it respawns when it despawns.
 */
export const QA_SUPPRESSOR_PLACEMENT: Placement = { at: { x: -2.25, y: 0, z: 19 }, yaw: 512 };

/** A tree that wants to shoot `netId`, forever (T-3.15's trigger). */
export function shootTree(netId: number): BrainTree {
  const registry = new BtRegistry<BrainBody, BrainMemory>().action('shoot', ({ blackboard }) => {
    blackboard.set('fireAt', netId);
    return 'running';
  });
  return buildTree(parseTreeDef({ id: 'qa-shoot', root: { type: 'action', name: 'shoot' } }), registry);
}

export class QaSuppressor {
  private netId: number | null = null;

  constructor(
    private readonly server: LocalServer,
    /** Who it shoots at: slot 1's soldier, beside the player. */
    private readonly targetNetId: number,
  ) {
    this.step();
  }

  /** Respawn it once it has despawned. Cheap; call once a tick. */
  step(): void {
    if (this.netId != null && this.server.enemyNetIds.includes(this.netId)) return;
    const { at, yaw } = QA_SUPPRESSOR_PLACEMENT;
    this.netId = this.server.spawnEnemy('rifleman', { ...at, yaw, tree: shootTree(this.targetNetId) });
  }
}
