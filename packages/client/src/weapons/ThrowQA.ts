/**
 * The throw, on this machine (T-2.32).
 *
 * `CombatQA` is the model: the server owns the weapon, and this owns the copy
 * the HUD and the picture need NOW — the pouch, the cooldown, the arc the
 * player aims by, and a predicted grenade so the one they just threw leaves
 * their hand this frame instead of a round trip later.
 *
 * THREE THINGS IT IS NOT AUTHORITY OVER, all of them the server's: how many
 * you have (this copy can drift if the server refuses a throw it allowed —
 * the same trade `CombatQA` makes for the magazine, and for the same reason:
 * an ammo counter that waits for a round trip feels broken), where the
 * grenade actually is, and what the blast does.
 *
 * THE GHOST AND ITS TWIN. A thrown projectile is drawn twice over its life:
 * first as a local ghost stepped by T-2.30's own function, then — from the
 * moment the server's copy of it arrives — as the replicated entity every
 * other client is watching. The handover is the fiddly part and it is done by
 * BINDING rather than by timing: when a replicated projectile of our own kind
 * and our own slot appears, it is bound to the oldest ghost that has none, the
 * bound twin is not drawn while its ghost lives, and the ghost is retired the
 * moment the twin leaves the world. So there is exactly one grenade on screen
 * at every instant, it leaves the hand immediately, and the blast is still the
 * server's, at the server's point, on the server's tick.
 *
 * No THREE in here on purpose: everything below is numbers, so the whole
 * handover is testable in Node, and `main.ts` does the drawing.
 */
import {
  type ArcOptions,
  PROJECTILE_IDS,
  type ProjectileArc,
  type ProjectileDef,
  type ProjectileState,
  type ProjectileWorld,
  TICK_SECONDS,
  createProjectileState,
  getProjectile,
  launchOrigin,
  launchVelocity,
  projectileArc,
  stepProjectile,
} from '@sandline/shared';

/** Re-exported: the order is protocol, and shared owns it. */
export const PROJECTILE_ORDER = PROJECTILE_IDS;

/** How far ahead of the eye a projectile is born. The server's own number. */
export const LAUNCH_AHEAD_M = 0.55;

/**
 * How much of the flight the preview draws. A grenade's fuse ends the line by
 * itself; this is the backstop for a rocket, which would otherwise draw four
 * seconds of straight line across the whole range.
 */
export const ARC_PREVIEW_SECONDS = 3;

/**
 * A ghost with no twin after this long has lost its throw — the server refused
 * it, or the message did. Retire it rather than leave a grenade hanging in the
 * air forever.
 */
export const GHOST_ORPHAN_SECONDS = 1.2;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Ghost {
  /** Local id. Nothing outside this client knows or needs it. */
  id: number;
  /** Index into PROJECTILE_ORDER. */
  kind: number;
  def: ProjectileDef;
  state: ProjectileState;
  /** Where it was at the start of the current tick, so a frame can interpolate. */
  prev: Vec3;
  /** The replicated projectile this one stands in for, once it has arrived. */
  netId: number | null;
  age: number;
}

export interface LiveProjectile {
  netId: number;
  kind: number;
  ownerSlot: number;
}

export class ThrowQA {
  private index = 0;
  /**
   * Working copies of the shipped rows, one per projectile, that the tuning
   * panel edits in place — the preview arc, the pouch and the throw all read
   * these, and `onTune` hands each edit to the in-page session so the server
   * throws what the page predicts.
   */
  private readonly working: ProjectileDef[] = PROJECTILE_ORDER.map((id) => ({ ...getProjectile(id) }));
  private readonly counts: number[] = this.working.map((def) => def.carried);
  /** Called with (index, row) after every edit and reset. */
  onTune: ((index: number, def: Readonly<ProjectileDef>) => void) | null = null;
  /** Called when the selected projectile changes, so a panel can rebind. */
  onSelect: ((index: number) => void) | null = null;
  private nextThrowAt = 0;
  private readonly live: Ghost[] = [];
  private nextGhostId = 1;
  /** Ghosts retired this frame, so the caller can drop their meshes. */
  private readonly retired: number[] = [];

  get kind(): number {
    return this.index;
  }

  get def(): ProjectileDef {
    return this.working[this.index] as ProjectileDef;
  }

  get ghosts(): readonly Ghost[] {
    return this.live;
  }

  /** Ghost ids retired since the last call. Drains, like a trigger edge. */
  takeRetired(): number[] {
    return this.retired.splice(0, this.retired.length);
  }

  count(index = this.index): number {
    return this.counts[index] ?? 0;
  }

  /** Every row of the pouch, in wire order, with what is left of it (T-4.25). */
  rows(): { name: string; count: number }[] {
    return this.working.map((row, i) => ({ name: row.name, count: this.count(i) }));
  }

  select(index: number): void {
    if (index < 0 || index >= PROJECTILE_ORDER.length) return;
    const changed = index !== this.index;
    this.index = index;
    if (changed) this.onSelect?.(index);
  }

  /** The working row for a projectile index (the selected one's is `def`). */
  defOf(index: number): ProjectileDef {
    return (this.working[index] ?? this.working[0]) as ProjectileDef;
  }

  /** An edit to the working row at `index` is done: pass it on, and settle the pouch. */
  tuned(index = this.index): void {
    const def = this.defOf(index);
    if ((this.counts[index] ?? 0) > def.carried) this.counts[index] = def.carried;
    this.onTune?.(index, def);
  }

  /** Put the row at `index` back to the shipped data. */
  resetDef(index = this.index): ProjectileDef {
    const fresh = { ...getProjectile(PROJECTILE_ORDER[index] as string) };
    this.working[index] = fresh;
    this.tuned(index);
    this.onSelect?.(index);
    return fresh;
  }

  /** Whether a throw would be allowed right now, by this client's copy. */
  canThrow(now: number): boolean {
    return this.count() > 0 && now >= this.nextThrowAt;
  }

  /** Seconds of cooldown left, for the HUD. */
  cooldownLeft(now: number): number {
    const left = this.nextThrowAt - now;
    return left > 0 ? left : 0;
  }

  /** Where this throw would start: ahead of the eye, clamped by the world. */
  origin(eye: Vec3, direction: Vec3, world?: ProjectileWorld): Vec3 {
    return launchOrigin(this.def, eye, direction, LAUNCH_AHEAD_M, world);
  }

  /**
   * The arc the player aims by: `projectileArc`'s own points, at the tick the
   * server steps at, over the world the server collides with. Not a rendering
   * of a throw — the throw itself, walked ahead of time.
   */
  arc(origin: Vec3, yaw: number, pitch: number, world?: ProjectileWorld): ProjectileArc {
    const def = this.def;
    const maxSeconds = def.fuseSeconds > 0 ? Math.min(def.fuseSeconds, ARC_PREVIEW_SECONDS) : ARC_PREVIEW_SECONDS;
    const options: ArcOptions = world === undefined
      ? { dt: TICK_SECONDS, maxSeconds }
      : { dt: TICK_SECONDS, maxSeconds, world };
    return projectileArc(def, origin, launchVelocity(def, yaw, pitch), options);
  }

  /**
   * Throw one: spend it, start the cooldown, and hand back the ghost to draw.
   * Null when this client's copy says there is nothing to throw.
   */
  throwFrom(origin: Vec3, yaw: number, pitch: number, now: number): Ghost | null {
    if (!this.canThrow(now)) return null;
    const def = this.def;
    this.counts[this.index] = this.count() - 1;
    this.nextThrowAt = now + def.cooldownSeconds;
    const ghost: Ghost = {
      id: this.nextGhostId++,
      kind: this.index,
      def,
      state: createProjectileState(origin, launchVelocity(def, yaw, pitch)),
      prev: { x: origin.x, y: origin.y, z: origin.z },
      netId: null,
      age: 0,
    };
    this.live.push(ghost);
    return ghost;
  }

  /** Fly every ghost one tick. Called from the tick loop, never the frame loop. */
  tick(world?: ProjectileWorld): void {
    for (const ghost of this.live) {
      ghost.prev = { x: ghost.state.x, y: ghost.state.y, z: ghost.state.z };
      const step = stepProjectile(ghost.def, ghost.state, TICK_SECONDS, world);
      ghost.state = step.state;
      ghost.age += TICK_SECONDS;
    }
    /**
     * A ghost that predicted its own detonation does NOT go off: the blast is
     * the server's, drawn when the server says so (T-2.33). It simply stops
     * being drawn once the server takes its twin away — or, if the throw never
     * reached the server at all, once it has waited long enough to know.
     */
    this.retireWhere((g) => g.netId === null && g.age > GHOST_ORPHAN_SECONDS);
  }

  /**
   * Match ghosts to the replicated projectiles that have arrived, and retire
   * the ones whose twin has left the world.
   *
   * `live` is every projectile the client can currently see; `ourSlot` is this
   * player's squad slot, which is how a projectile is known to be ours — the
   * replicated `Projectile` component carries the thrower's slot precisely so
   * a client can recognise its own.
   */
  bind(live: Iterable<LiveProjectile>, ourSlot: number): void {
    const present = new Set<number>();
    const bound = new Set<number>();
    for (const ghost of this.live) if (ghost.netId !== null) bound.add(ghost.netId);
    for (const projectile of live) {
      present.add(projectile.netId);
      if (projectile.ownerSlot !== ourSlot || bound.has(projectile.netId)) continue;
      const ghost = this.live.find((g) => g.netId === null && g.kind === projectile.kind);
      if (!ghost) continue;
      ghost.netId = projectile.netId;
      bound.add(projectile.netId);
    }
    this.retireWhere((g) => g.netId !== null && !present.has(g.netId));
  }

  /** True while this replicated projectile is being drawn as somebody's ghost. */
  isGhosted(netId: number): boolean {
    return this.live.some((g) => g.netId === netId);
  }

  private retireWhere(doomed: (ghost: Ghost) => boolean): void {
    for (let i = this.live.length - 1; i >= 0; i -= 1) {
      const ghost = this.live[i];
      if (ghost && doomed(ghost)) {
        this.retired.push(ghost.id);
        this.live.splice(i, 1);
      }
    }
  }

  /** The pouch a class spawns with (T-4.27), indexed like the rows; what the server will let this soldier throw. */
  setCounts(counts: readonly number[]): void {
    this.working.forEach((_def, i) => {
      this.counts[i] = Math.max(0, Math.floor(counts[i] ?? 0));
    });
  }

  /** Give everything back, for the harness reset key. */
  reset(): void {
    for (const ghost of this.live) this.retired.push(ghost.id);
    this.live.length = 0;
    this.working.forEach((def, i) => {
      this.counts[i] = def.carried;
    });
    this.nextThrowAt = 0;
  }

  readout(now: number): string {
    const def = this.def;
    const pouch = this.working.map((row, i) => {
      const mark = i === this.index ? '>' : ' ';
      return `${mark}${i + 5} ${row.name} x${this.count(i)}`;
    }).join('   ');
    const cooldown = this.cooldownLeft(now);
    const use = def.kind === 'rocket' ? 'click to fire, RMB aims' : 'hold LMB to aim, release to throw';
    const state = cooldown > 0 ? `ready in ${cooldown.toFixed(1)}s` : this.count() > 0 ? `${use} (G quick-throws)` : 'empty';
    return `${pouch}\n${def.name}  ${state}  ${this.live.length} in flight (predicted)`;
  }
}
