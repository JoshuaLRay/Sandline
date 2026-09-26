/**
 * World and body sounds in play (T-2.47), the pure half. Footsteps land on
 * the gait's foot contacts — the stride's extremes, where the pose driver
 * (`locomotionPose.ts`) has each heel down — so the feet and the sound
 * agree. A round going past is placed at the point of its path nearest the
 * head, so its crack is on the side it passed. An explosion picks its near
 * or far version by distance, and an impact its sound by what it struck.
 */
import { WORLD_SOUNDS, type WorldBox, type WorldSoundsConfig } from '@sandline/shared';
import type { LocomotionState } from '../character/locomotionState.ts';
import type { Vec3 } from './spatial.ts';

const TWO_PI = Math.PI * 2;
/**
 * Where each heel strikes, as gait phase: the stride (`sin(phase)`) is at an
 * extreme and the leading leg is planted. The left leg leads when the stride
 * is negative (the driver's convention), so it strikes at 3π/2; the right
 * at π/2.
 */
export const FOOT_CONTACTS: readonly { foot: 'left' | 'right'; phase: number }[] = [
  { foot: 'right', phase: Math.PI / 2 },
  { foot: 'left', phase: (3 * Math.PI) / 2 },
];

/** The footstep sound for a stance, or null for one that has none (idle, a vault). */
export function footstepSound(state: LocomotionState, cfg: WorldSoundsConfig = WORLD_SOUNDS): string | null {
  switch (state) {
    case 'walk':
    case 'sprint':
    case 'crouch-walk':
    case 'prone':
      return cfg.footsteps[state];
    default:
      return null;
  }
}

/**
 * Watches one soldier's gait phase frame to frame and says which foot came
 * down: a contact is played when the phase crosses its angle going forward.
 * Idle and the vault stop the gait; a stopped gait plays nothing.
 */
export class FootstepTracker {
  private last: number | null = null;

  update(phase: number, state: LocomotionState): ('left' | 'right')[] {
    if (state === 'idle' || state === 'vault') {
      this.last = null;
      return [];
    }
    const now = ((phase % TWO_PI) + TWO_PI) % TWO_PI;
    const prev = this.last;
    this.last = now;
    if (prev === null) return [];
    // How far the phase moved this frame, forward; a gait never runs backwards or a full cycle in a frame.
    const moved = (now - prev + TWO_PI) % TWO_PI;
    if (moved === 0 || moved > Math.PI) return [];
    const out: ('left' | 'right')[] = [];
    for (const contact of FOOT_CONTACTS) {
      const ahead = (contact.phase - prev + TWO_PI) % TWO_PI;
      if (ahead > 0 && ahead <= moved) out.push(contact.foot);
    }
    return out;
  }
}

/** The point of the segment `from` → `to` nearest `p`, and how far it is. */
export function nearestOnSegment(from: Vec3, to: Vec3, p: Vec3): { point: Vec3; distanceM: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - from.x) * dx + (p.y - from.y) * dy + (p.z - from.z) * dz) / len2));
  const point = { x: from.x + dx * t, y: from.y + dy * t, z: from.z + dz * t };
  return { point, distanceM: Math.hypot(point.x - p.x, point.y - p.y, point.z - p.z) };
}

/**
 * Whether a round from `origin` to `end` passed near `head`, and where to
 * play its crack: the nearest point of its path, so it sounds on the side it
 * went by. Null when it passed wide, or ended short of the head.
 */
export function nearMissAt(origin: Vec3, end: Vec3, head: Vec3, cfg: WorldSoundsConfig = WORLD_SOUNDS): Vec3 | null {
  const { point, distanceM } = nearestOnSegment(origin, end, head);
  if (distanceM > cfg.nearMiss.distanceM) return null;
  // Nearest at the path's end is a round that stopped before it reached us: that is an impact, not a pass.
  if (Math.hypot(point.x - end.x, point.y - end.y, point.z - end.z) < 1e-6) return null;
  return point;
}

/** The explosion to play at a distance. */
export function explosionSound(distanceM: number, cfg: WorldSoundsConfig = WORLD_SOUNDS): string {
  return distanceM >= cfg.explosion.farM ? cfg.explosion.far : cfg.explosion.near;
}

/** The impact sound for what a round struck: a box's kind and id, or the ground (null). */
export function impactSound(box: Pick<WorldBox, 'kind' | 'id'> | null, cfg: WorldSoundsConfig = WORLD_SOUNDS): string {
  if (box === null) return cfg.impacts.ground;
  if (box.kind === 'post-minor' || box.kind === 'post-major' || box.kind === 'rail') return cfg.impacts.post;
  if (/crate|drum/.test(box.id)) return cfg.impacts.crate;
  return cfg.impacts.wall;
}
