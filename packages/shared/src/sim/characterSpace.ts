import { type MoveConfig, type MoveState, DEFAULT_MOVE_CONFIG } from './CharacterController.ts';
import { type WorldBox, blockedAt, supportUnder } from './world.ts';

/** The character capsule footprint; bodies are never steps. */
export interface CharacterSpace {
  netId?: number | undefined;
  x: number;
  y: number;
  z: number;
  height: number;
  radius: number;
}

export function characterSpace(state: Readonly<MoveState>, config: MoveConfig = DEFAULT_MOVE_CONFIG, lying = false, netId?: number): CharacterSpace {
  return { netId, x: state.x, y: state.y, z: state.z, radius: config.radius,
    height: lying || state.prone ? config.proneHeight : state.crouched ? config.crouchHeight : config.height };
}

/** Resolve against known character positions after static-world movement, without pushing another body. */
export function keepCharacterSpace(from: Readonly<MoveState>, next: MoveState, others: readonly CharacterSpace[], config: MoveConfig, world: readonly WorldBox[], netId?: number): MoveState {
  const me = characterSpace(next, config);
  const near = others.filter((b) => b.y < next.y + me.height && next.y < b.y + b.height &&
    Math.abs(b.x - next.x) < b.radius + me.radius + 1 && Math.abs(b.z - next.z) < b.radius + me.radius + 1);
  const overlaps = (x: number, z: number, b: CharacterSpace) =>
    (x - b.x) ** 2 + (z - b.z) ** 2 < (b.radius + me.radius - 1e-7) ** 2;
  if (!near.some((b) => overlaps(next.x, next.z, b))) return next;
  const valid = (x: number, z: number) => !near.some((b) => overlaps(x, z, b)) &&
    !blockedAt(x, z, me.radius, next.y, config.stepHeight, me.height, world) &&
    Math.abs(supportUnder(x, z, me.radius, next.y + config.stepHeight, world, config.groundY) - next.y) <= config.stepHeight;
  // A lower id has right of way. The other body yields sideways, or backs
  // out of a one-person passage, using no more than this tick's movement.
  // This is collision recovery, not a teleport through the other character.
  const dx = next.x - from.x;
  const dz = next.z - from.z;
  if (netId !== undefined && near.some((b) => b.netId !== undefined && b.netId < netId && overlaps(next.x, next.z, b))) {
    for (const [x, z] of [[from.x - dz, from.z + dx], [from.x + dz, from.z - dx], [from.x - dx, from.z - dz]]) {
      if (valid(x!, z!)) return { ...next, x: x!, z: z!, vault: null };
    }
  }
  // Walking into an occupied place stops the blocked axis and retains the slide.
  if (valid(from.x, next.z)) return { ...next, x: from.x, vault: null };
  if (valid(next.x, from.z)) return { ...next, z: from.z, vault: null };
  if (valid(from.x, from.z)) return { ...next, x: from.x, z: from.z, vault: null };
  // Spawn/restore or a body moving into an idle character: find a nearby free
  // footprint on the same surface. Fixed ordering breaks exact-coincidence ties.
  const candidates: { x: number; z: number }[] = [];
  for (const b of near) {
    const gap = b.radius + me.radius + 0.001;
    for (const dx of [-gap, 0, gap]) for (const dz of [-gap, 0, gap]) {
      if (dx !== 0 || dz !== 0) candidates.push({ x: b.x + dx, z: b.z + dz });
    }
  }
  candidates.sort((a, b) => (a.x - next.x) ** 2 + (a.z - next.z) ** 2 - ((b.x - next.x) ** 2 + (b.z - next.z) ** 2));
  const free = candidates.find((p) => valid(p.x, p.z));
  if (free) return { ...next, ...free, vault: null };
  // A descending body cannot land inside an occupied footprint. Keep its
  // previous clearance until it can move aside; never sink through the body.
  if (near.every((b) => from.y >= b.y + b.height || from.y + me.height <= b.y || !overlaps(from.x, from.z, b))) {
    return { ...from, vy: 0, vault: null };
  }
  return { ...next, x: from.x, z: from.z, vault: null };
}
