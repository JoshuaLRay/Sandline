/**
 * World factory and network identity allocation (T-0.09).
 */
import { addComponent, addEntity, createWorld as createBitWorld, removeEntity } from 'bitecs';
import { NetId, Replicated, Transform } from './components.ts';

export interface SimWorld {
  readonly ecs: ReturnType<typeof createBitWorld>;
  /** Monotonic; never reused within a session. */
  nextNetId: number;
}

export function createSimWorld(): SimWorld {
  return { ecs: createBitWorld(), nextNetId: 1 };
}

/** Create a replicated entity with a fresh, never-reused NetId. */
export function spawnReplicated(
  world: SimWorld,
  position: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): number {
  const eid = addEntity(world.ecs);
  addComponent(world.ecs, Transform, eid);
  addComponent(world.ecs, NetId, eid);
  addComponent(world.ecs, Replicated, eid);
  Transform.x[eid] = position.x;
  Transform.y[eid] = position.y;
  Transform.z[eid] = position.z;
  Transform.yaw[eid] = 0;
  Transform.pitch[eid] = 0;
  NetId.id[eid] = world.nextNetId++;
  return eid;
}

export function despawn(world: SimWorld, eid: number): void {
  removeEntity(world.ecs, eid);
}
