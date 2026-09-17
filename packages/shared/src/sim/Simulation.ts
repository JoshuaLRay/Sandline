/**
 * The simulation (T-0.12).
 *
 * Composes clock + ECS world + physics. Identical code runs on the server as the
 * authority and on the client as prediction (ADR-003) — that is the whole point
 * of keeping `shared` platform-free.
 *
 * Deliberately NOT deterministic as a whole: per ADR-014 only the character
 * controller and weapon spread need client/server parity. Damage, AI and debris
 * are replicated, never predicted, and may diverge freely.
 */
import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { type SimWorld, createSimWorld, spawnReplicated } from '../ecs/world.ts';
import { NetId, Transform } from '../ecs/components.ts';
import { TICK_SECONDS } from './Clock.ts';
import { addGround, createWorld, initPhysics, rapier } from './physics.ts';

export interface SimulationOptions {
  /** Static ground, on by default; scenarios may opt out. */
  ground?: boolean;
}

export interface EntitySnapshot {
  netId: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface Snapshot {
  tick: number;
  entities: EntitySnapshot[];
}

export class Simulation {
  readonly world: SimWorld;
  readonly physics: InstanceType<typeof RAPIER.World>;
  private readonly bodies = new Map<number, ReturnType<InstanceType<typeof RAPIER.World>['createRigidBody']>>();
  private currentTick = 0;

  private constructor(options: SimulationOptions) {
    const r = rapier();
    this.world = createSimWorld();
    this.physics = createWorld(r);
    if (options.ground !== false) addGround(this.physics, r);
  }

  /** Physics WASM must be initialised first, so construction is async. */
  static async create(options: SimulationOptions = {}): Promise<Simulation> {
    await initPhysics();
    return new Simulation(options);
  }

  get tick(): number {
    return this.currentTick;
  }

  /** Spawn a dynamic capsule bound to a replicated ECS entity. */
  spawnActor(position: { x: number; y: number; z: number }): number {
    const r = rapier();
    const eid = spawnReplicated(this.world, position);
    const body = this.physics.createRigidBody(
      r.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .lockRotations(),
    );
    this.physics.createCollider(r.ColliderDesc.capsule(0.6, 0.35), body);
    this.bodies.set(eid, body);
    return eid;
  }

  /** Advance exactly one fixed tick. */
  step(): void {
    this.physics.timestep = TICK_SECONDS;
    this.physics.step();
    for (const [eid, body] of this.bodies) {
      const t = body.translation();
      Transform.x[eid] = t.x;
      Transform.y[eid] = t.y;
      Transform.z[eid] = t.z;
    }
    this.currentTick++;
  }

  snapshot(): Snapshot {
    const entities: EntitySnapshot[] = [];
    for (const eid of this.bodies.keys()) {
      entities.push({
        netId: NetId.id[eid] as number,
        x: Transform.x[eid] as number,
        y: Transform.y[eid] as number,
        z: Transform.z[eid] as number,
        yaw: Transform.yaw[eid] as number,
      });
    }
    return { tick: this.currentTick, entities };
  }

  /** Flat numeric sample for the parity harness (T-0.11). */
  sample(): number[] {
    const out: number[] = [];
    for (const e of this.snapshot().entities) out.push(e.x, e.y, e.z, e.yaw);
    return out;
  }

  dispose(): void {
    this.physics.free();
    this.bodies.clear();
  }
}
