/**
 * Rapier bootstrap (T-0.10, ADR-005).
 *
 * We use the `-deterministic-compat` build. Two orthogonal suffixes:
 *   -deterministic : cross-platform reproducible solver (no SIMD, no threads)
 *   -compat        : WASM bundled for async load, so the SAME module initialises
 *                    in Node and in the browser
 *
 * Both are required. Dropping `-compat` to "get determinism" is a known
 * confusion — it breaks Node loading, which the shared-simulation architecture
 * depends on, and gains nothing (ADR-005).
 */
import RAPIER from '@dimforge/rapier3d-deterministic-compat';

let ready: Promise<typeof RAPIER> | null = null;

/** Idempotent async init. Safe to await from anywhere, any number of times. */
export function initPhysics(): Promise<typeof RAPIER> {
  ready ??= RAPIER.init().then(() => RAPIER);
  return ready;
}

/** Throws if called before initPhysics() has resolved. */
export function rapier(): typeof RAPIER {
  if (!ready) throw new Error('initPhysics() must be awaited before using Rapier');
  return RAPIER;
}

export const GRAVITY = { x: 0, y: -9.81, z: 0 } as const;

export function createWorld(r: typeof RAPIER = RAPIER): InstanceType<typeof RAPIER.World> {
  return new r.World(GRAVITY);
}

/** Static ground plane as a thin box, centred at the origin. */
export function addGround(
  world: InstanceType<typeof RAPIER.World>,
  r: typeof RAPIER = RAPIER,
  halfExtent = 50,
): void {
  const body = world.createRigidBody(r.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  world.createCollider(r.ColliderDesc.cuboid(halfExtent, 0.5, halfExtent), body);
}

export interface DynamicBox {
  body: ReturnType<InstanceType<typeof RAPIER.World>['createRigidBody']>;
}

export function addDynamicBox(
  world: InstanceType<typeof RAPIER.World>,
  position: { x: number; y: number; z: number },
  r: typeof RAPIER = RAPIER,
  halfExtent = 0.5,
): DynamicBox {
  const body = world.createRigidBody(
    r.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z),
  );
  world.createCollider(r.ColliderDesc.cuboid(halfExtent, halfExtent, halfExtent), body);
  return { body };
}
