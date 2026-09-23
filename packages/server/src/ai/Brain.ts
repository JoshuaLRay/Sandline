/**
 * A bot slot's brain (T-3.08).
 *
 * One behaviour tree instance (T-3.07) per bot slot, ticked by the session at
 * 10 Hz: every third tick, on the phase its netId picks, so six brains land
 * two to a phase and no tick carries all of them. What a brain decides is an
 * intent on its blackboard — where to go and how — and the session's path
 * following (T-3.05) walks the latest one at 30 Hz, so a soldier keeps moving
 * smoothly between thoughts.
 *
 * A brain belongs to the SLOT's occupant, not to the entity (ADR-001). A human
 * taking the slot stops it; a human leaving hands the entity to a new brain,
 * built from nothing but the entity as it stands then — whatever the old brain
 * remembered went with it.
 */
import { Blackboard, type BtTree, type BehaviorTree, BtRegistry, type HealthState, type MoveState, buildTree } from '@sandline/shared';
import type { LocomotionIntent } from './locomotion/followPath.ts';

/** Ticks between a brain's thoughts: 30 Hz sim, 10 Hz brains. */
export const BRAIN_PERIOD_TICKS = 3;

/** What every brain remembers. Trees that need more extend it in their own task. */
export interface BrainMemory {
  /** What locomotion should be doing; null stands the soldier still. */
  intent: LocomotionIntent | null;
}

/** The entity a brain drives, read live: the session's own slot, never a copy. */
export interface BrainBody {
  readonly netId: number;
  readonly state: Readonly<MoveState>;
  readonly yaw: number;
  readonly health: Readonly<HealthState>;
}

export type BrainTree = BtTree<BrainBody, BrainMemory>;
export type BrainRegistry = BtRegistry<BrainBody, BrainMemory>;

/** The phase (tick mod 3) a netId thinks on. */
export function brainPhase(netId: number): number {
  return netId % BRAIN_PERIOD_TICKS;
}

/** The server's leaves. `idle` wants nothing and never finishes. */
export function createBrainRegistry(): BrainRegistry {
  return new BtRegistry<BrainBody, BrainMemory>().action('idle', ({ blackboard }) => {
    blackboard.set('intent', null);
    return 'running';
  });
}

let idleTree: BrainTree | null = null;
/** The committed `idle` tree bound to the server's registry, built once. */
export function defaultBrainTree(): BrainTree {
  return (idleTree ??= buildTree('idle', createBrainRegistry()));
}

export class Brain {
  readonly phase: number;
  /** Where the entity stood when this brain took it over. */
  readonly startedAt: Readonly<{ x: number; y: number; z: number }>;
  private readonly bt: BehaviorTree<BrainBody, BrainMemory>;
  private stopped = false;
  private lastThought = -1;
  private thoughts = 0;

  /**
   * `generation` counts the brains this slot has had, so a fresh brain after
   * a leave draws a different random stream from the one it replaces.
   */
  constructor(body: BrainBody, tree: BrainTree = defaultBrainTree(), generation = 0) {
    this.phase = brainPhase(body.netId);
    this.startedAt = { x: body.state.x, y: body.state.y, z: body.state.z };
    this.bt = tree.instantiate({
      seed: (Math.imul(body.netId, 0x9e3779b1) ^ Math.imul(generation + 1, 0x85ebca6b)) >>> 0,
      blackboard: new Blackboard<BrainMemory>({ intent: null }),
      ctx: body,
    });
  }

  /** Whether this brain thinks on `tick`. */
  due(tick: number): boolean {
    return !this.stopped && tick % BRAIN_PERIOD_TICKS === this.phase;
  }

  /** Tick the tree once. The session calls this only on `due` ticks. */
  think(tick: number): void {
    if (this.stopped) throw new Error(`brain for netId ${this.bt.ctx.netId} thought after it was stopped`);
    this.bt.tick(tick);
    this.lastThought = tick;
    this.thoughts++;
  }

  /** Halt whatever is running; the brain never thinks again. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.bt.halt();
  }

  /** The latest intent, as of the last thought; null once stopped. */
  get intent(): Readonly<LocomotionIntent> | null {
    return this.stopped ? null : this.bt.blackboard.get('intent');
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  get memory(): Readonly<BrainMemory> {
    return this.bt.blackboard.snapshot();
  }

  /** The tick of the last thought, or -1. */
  get lastThoughtTick(): number {
    return this.lastThought;
  }

  get thoughtCount(): number {
    return this.thoughts;
  }

  get tree(): BehaviorTree<BrainBody, BrainMemory> {
    return this.bt;
  }
}
