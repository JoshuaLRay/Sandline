/**
 * Kinematic character controller (T-1.12, ADR-014).
 *
 * THE most safety-critical function in the codebase for netcode purposes: the
 * client predicts the local player by running this, and the server runs the
 * same code as authority. Any disagreement shows up as rubber-banding.
 *
 * Therefore it is a PURE function of (state, input, dt):
 *   - no hidden state, no wall-clock reads, no Math.random
 *   - yaw to direction goes through the table trig, never Math.sin/cos
 *
 * That last rule is the one that bites. Math.cos here would agree perfectly
 * between a Node server and a Chrome client, because both are V8, and disagree
 * only for Safari and Firefox players — an invisible bug costing a week to find
 * (ADR-014). The lint rule blocks it; this comment explains why it is there.
 */
import { type BinAngle, wireToTable } from '../math/angles.ts';
import { sin, cos } from '../math/trig.ts';
import { DEFAULT_WORLD, type WorldBox, blockedAt, overlapsFootprint, supportUnder } from './world.ts';

export interface MoveState {
  x: number;
  y: number;
  z: number;
  /** Vertical velocity; horizontal motion is driven directly by input. */
  vy: number;
  grounded: boolean;
  /** Authoritative crouch stance; remains crouched until standing clearance exists. */
  crouched: boolean;
  /**
   * A vault in progress (T-2.21), or null/absent. Everything the traversal
   * needs is in here, so a predictor handed this state mid-vault continues
   * it exactly: the position at any moment is a function of `elapsed`, not
   * of the steps that led there.
   */
  vault?: VaultState | null;
}

export interface VaultState {
  /** Seconds since the vault began. */
  elapsed: number;
  /** Facing at entry, wire units: the traversal runs straight along it. */
  yaw: number;
  /** Feet position at entry. */
  fromX: number;
  fromY: number;
  fromZ: number;
  /** The obstacle's top: the height the feet rise to. */
  topY: number;
}

export interface MoveInput {
  /** -1..1, strafe. */
  moveX: number;
  /** -1..1, forward. */
  moveY: number;
  /** Wire angle (1/1024 turn). */
  yaw: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  /** T-2.15: hold the interact button to revive a nearby downed teammate. */
  interact?: boolean;
  /**
   * Downed (T-2.13): crawling. Not a button — the server sets it from the
   * soldier's vitality and the client predictor from the replicated one, so
   * both step the same input. Sprint and jump are ignored while it is set.
   */
  downed?: boolean;
  /**
   * The trigger is held (T-2.21). Movement ignores it except to refuse a
   * vault: a soldier does not throw themselves over a wall mid-burst. A
   * client that lies about it can only deny itself vaults.
   */
  firing?: boolean;
}

export interface MoveConfig {
  walkSpeed: number;
  sprintSpeed: number;
  crouchSpeed: number;
  /** Downed and crawling (T-2.13). */
  crawlSpeed: number;
  gravity: number;
  jumpSpeed: number;
  groundY: number;
  /** Terminal velocity, so a long fall cannot produce absurd numbers. */
  maxFallSpeed: number;
  /**
   * The soldier's footprint half-width and standing height, for collision
   * (T-1.12). The footprint is a square, not a circle: box-against-box is a
   * comparison, and the 5 cm of corner a circle would shave off is not worth
   * a square root per box per tick. Matches the server hitbox's radius.
   */
  radius: number;
  height: number;
  /** Full standing height used for collision and headroom. */
  crouchHeight: number;
  /** Ledges up to this high are stepped onto; higher ones block. */
  stepHeight: number;
  /**
   * Vault (T-2.21): an obstacle taller than a step and no taller than this
   * is vaulted when walked into with forward intent. The traversal covers
   * `vaultDistance` along the facing in `vaultSeconds`, rising to the
   * obstacle's top plus `vaultLip` at the midpoint to clear the edge, and
   * looks `vaultProbe` beyond the footprint's front edge for the obstacle.
   */
  vaultMaxHeight: number;
  vaultDistance: number;
  vaultSeconds: number;
  vaultProbe: number;
  vaultLip: number;
}

/**
 * Defaults. Parity tests must NOT read these — they declare their own constants
 * in the fixture, so tuning here can never break a parity test (ADR-014, R10).
 */
export const DEFAULT_MOVE_CONFIG: MoveConfig = {
  walkSpeed: 4.2,
  sprintSpeed: 6.8,
  crouchSpeed: 1.9,
  crawlSpeed: 1.2,
  gravity: -19.6,
  jumpSpeed: 6.0,
  groundY: 0,
  maxFallSpeed: -55,
  radius: 0.35,
  height: 1.8,
  crouchHeight: 1.2,
  stepHeight: 0.45,
  vaultMaxHeight: 1.25,
  vaultDistance: 1.5,
  vaultSeconds: 0.55,
  vaultProbe: 0.35,
  vaultLip: 0.15,
};

/** Clamp a stick axis. Guards against a hostile client sending moveX = 1e9. */
function axis(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/**
 * One tick of movement, with collision against `world` (T-1.12).
 *
 * The order is horizontal then vertical, and each horizontal axis separately:
 *
 *   1. X, then Z, each pushed out of any box that blocks at standing height.
 *      Resolving the axes one at a time is what makes walking into a wall at
 *      an angle SLIDE along it instead of stopping dead — the blocked axis
 *      loses its motion and the other keeps its own. A box you could step
 *      onto, or one entirely above your head, does not block.
 *   2. Y against the highest surface under the footprint: the ground, or the
 *      top of any box no higher than a step above the feet. Landing on it
 *      grounds you; being above it does not. So walking off a crate falls,
 *      walking onto a step rises, and a jump that comes down on cover stands
 *      on it. A box overhead within standing height stops an upward move.
 *
 * Nothing here tunnels at the speeds this game has: the footprint is 0.7 m
 * wide and sprint moves 0.23 m per tick, so a box thinner than a post still
 * overlaps the footprint at every tick along the way.
 *
 * Still pure, still only arithmetic and comparison. `world` defaults to the
 * shared static world so that every caller — server session, client
 * predictor, headless bot — collides with the same scenery without being
 * told; tests pass their own, per the fixture rule.
 */
export function stepCharacter(
  state: Readonly<MoveState>,
  input: Readonly<MoveInput>,
  dt: number,
  config: MoveConfig = DEFAULT_MOVE_CONFIG,
  world: readonly WorldBox[] = DEFAULT_WORLD,
): MoveState {
  const mx = axis(input.moveX);
  const my = axis(input.moveY);

  // Normalise diagonal input so moving on both axes is not faster.
  const lenSq = mx * mx + my * my;
  const scale = lenSq > 1 ? 1 / Math.sqrt(lenSq) : 1; // sqrt IS IEEE-exact
  const downed = input.downed === true;
  // Crouch is an authoritative stance, not merely a button state. Releasing
  // crouch while under a ceiling keeps the character crouched until the
  // resulting position has enough headroom for the full standing height.
  let crouched = !downed && (input.crouch || state.crouched);
  const effectiveHeight = crouched ? config.crouchHeight : config.height;
  const speed = downed
    ? config.crawlSpeed
    : crouched
      ? config.crouchSpeed
      : input.sprint
        ? config.sprintSpeed
        : config.walkSpeed;

  // Table trig, not Math.cos. See the header.
  const a: BinAngle = wireToTable(input.yaw);
  const s = sin(a);
  const c = cos(a);

  // A vault in progress owns the whole tick (T-2.21): no strafe, no jump, no
  // crouch, and no collision, which was settled when it started.
  const active = state.vault ?? null;
  if (active) return advanceVault(active, dt, config, world);

  // A vault begins here, before ordinary movement: walking into a vaultable
  // obstacle with forward intent, on the ground, standing, not firing.
  if (
    state.grounded &&
    !downed &&
    !crouched &&
    !input.jump &&
    input.firing !== true &&
    my > 0.5 &&
    Math.abs(mx) <= 0.5
  ) {
    const started = tryStartVault(state, input.yaw, s, c, config, world);
    if (started) return advanceVault(started, dt, config, world);
  }

  // Forward is +Z rotated by yaw. Right is cross(forward, up), NOT
  // cross(up, forward) - in a right-handed Y-up system, a viewer looking along
  // +Z has +X on their LEFT, so the other cross product sends D leftward and
  // A rightward. That was shipped once and reported immediately.
  const worldX = (my * s - mx * c) * speed * scale;
  const worldZ = (my * c + mx * s) * speed * scale;

  const half = config.radius;
  const feet = state.y;
  /** Blocks horizontal movement: too tall to step onto, and not above the head. */
  const blocks = (box: WorldBox): boolean =>
    box.maxY > feet + config.stepHeight && box.minY < feet + effectiveHeight;

  // 1. Horizontal, one axis at a time.
  let x = state.x + worldX * dt;
  if (worldX !== 0) {
    for (const box of world) {
      if (!blocks(box) || !overlapsFootprint(x, state.z, half, box)) continue;
      x = worldX > 0 ? box.minX - half : box.maxX + half;
    }
  }
  let z = state.z + worldZ * dt;
  if (worldZ !== 0) {
    for (const box of world) {
      if (!blocks(box) || !overlapsFootprint(x, z, half, box)) continue;
      z = worldZ > 0 ? box.minZ - half : box.maxZ + half;
    }
  }

  // A released crouch is only allowed to transition to standing when the
  // character's current feet position has full-height clearance. Keep the
  // crouched stance while moving through a low ceiling; after horizontal
  // movement, re-check at the resulting position so walking out from under
  // cover permits the same tick's stand transition.
  if (crouched && !input.crouch && !downed) {
    const canStand = !world.some((box) =>
      box.minY >= feet + config.stepHeight &&
      box.minY < feet + config.height &&
      overlapsFootprint(x, z, half, box),
    );
    if (canStand) crouched = false;
  }
  const resolvedHeight = crouched ? config.crouchHeight : config.height;

  // 2. Vertical.
  let vy = state.vy;
  let grounded = state.grounded;

  if (grounded && input.jump && !downed) {
    vy = config.jumpSpeed;
    grounded = false;
  } else if (!grounded) {
    vy += config.gravity * dt;
    if (vy < config.maxFallSpeed) vy = config.maxFallSpeed;
  } else {
    vy = 0;
  }

  let y = state.y + vy * dt;

  // The highest surface under the footprint that the feet can reach: the
  // ground, or a box top no more than a step above where the feet were. A box
  // top far below the feet is also a candidate — that is what a fall lands on.
  let support = config.groundY;
  for (const box of world) {
    if (box.maxY <= feet + config.stepHeight && box.maxY > support && overlapsFootprint(x, z, half, box)) {
      support = box.maxY;
    }
  }
  if (y <= support) {
    y = support;
    vy = 0;
    grounded = true;
  } else {
    grounded = false;
  }

  // Head room: a box overhead within standing height stops an upward move.
  for (const box of world) {
    if (box.minY >= y + config.stepHeight && box.minY < y + resolvedHeight && overlapsFootprint(x, z, half, box)) {
      y = Math.max(support, box.minY - effectiveHeight);
      if (vy > 0) vy = 0;
    }
  }

  return { x, y, z, vy, grounded, crouched, vault: null };
}

/**
 * Look for a vaultable obstacle just ahead and a clear place to land beyond
 * it (T-2.21). Returns the vault to run, or null. Pure arithmetic and
 * comparison, like everything the server and the predictor share.
 *
 * "Vaultable": a box overlapping the footprint one probe ahead whose top is
 * higher than a step and no higher than `vaultMaxHeight` above the feet,
 * and which rises from no higher than a step (a floating box is a ceiling,
 * not a hurdle). Anything ahead that is taller than the vault height and in
 * the way is a wall and refuses the vault. "Clear to land": the landing
 * footprint, `vaultDistance` along the facing, has a support no higher than
 * the obstacle's top plus a step and nothing on it that would block a
 * standing soldier.
 */
export function tryStartVault(
  state: Readonly<MoveState>,
  yaw: number,
  dirX: number,
  dirZ: number,
  config: MoveConfig,
  world: readonly WorldBox[],
): VaultState | null {
  const half = config.radius;
  const feet = state.y;
  const aheadX = state.x + dirX * (half + config.vaultProbe);
  const aheadZ = state.z + dirZ * (half + config.vaultProbe);

  let topY = -Infinity;
  for (const box of world) {
    if (!overlapsFootprint(aheadX, aheadZ, half, box)) continue;
    if (box.minY >= feet + config.height) continue; // overhead, not in the way
    if (box.maxY <= feet + config.stepHeight) continue; // a step, walked onto
    // Too tall to vault, and in the way: a wall. Stop looking.
    if (box.maxY > feet + config.vaultMaxHeight) return null;
    if (box.minY > feet + config.stepHeight) continue; // floating: a ceiling
    if (box.maxY > topY) topY = box.maxY;
  }
  if (topY === -Infinity) return null;

  const endX = state.x + dirX * config.vaultDistance;
  const endZ = state.z + dirZ * config.vaultDistance;
  const landing = supportUnder(endX, endZ, half, topY + config.stepHeight, world, config.groundY);
  if (blockedAt(endX, endZ, half, landing, config.stepHeight, config.height, world)) return null;

  return { elapsed: 0, yaw, fromX: state.x, fromY: feet, fromZ: state.z, topY };
}

/**
 * One tick of a vault (T-2.21). The traversal is a closed form of elapsed
 * time, so 30 and 120 Hz steps trace the same path and land on the same
 * tick of real time: along the facing at a constant rate, and up on a
 * smoothstep to the obstacle's top with a parabolic lip on top of it. On
 * completion the feet come down on whatever supports the landing footprint,
 * which the start already checked.
 */
export function advanceVault(
  vault: Readonly<VaultState>,
  dt: number,
  config: MoveConfig,
  world: readonly WorldBox[],
): MoveState {
  const elapsed = vault.elapsed + dt;
  const p = elapsed >= config.vaultSeconds ? 1 : elapsed / config.vaultSeconds;
  const a: BinAngle = wireToTable(vault.yaw);
  const dirX = sin(a);
  const dirZ = cos(a);
  const x = vault.fromX + dirX * config.vaultDistance * p;
  const z = vault.fromZ + dirZ * config.vaultDistance * p;

  if (p >= 1) {
    const y = supportUnder(x, z, config.radius, vault.topY + config.stepHeight, world, config.groundY);
    return { x, y, z, vy: 0, grounded: true, crouched: false, vault: null };
  }

  const rise = p * p * (3 - 2 * p);
  const lip = 4 * p * (1 - p) * config.vaultLip;
  const y = vault.fromY + (vault.topY - vault.fromY) * rise + lip;
  return { x, y, z, vy: 0, grounded: false, crouched: false, vault: { ...vault, elapsed } };
}

export function createMoveState(x = 0, y = 0, z = 0): MoveState {
  return { x, y, z, vy: 0, grounded: y <= 0, crouched: false, vault: null };
}
