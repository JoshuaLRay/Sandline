/** Authored carried-squad holdings. The escort POW keeps its encounter socket. */
import { POSITION } from '../net/quantize.ts';
import { MAX_SLOTS } from '../net/Connection.ts';
import type { MoveConfig } from './CharacterController.ts';
import { DEFAULT_MOVE_CONFIG } from './moveDefaults.ts';
import { blockedAt, supportUnder, type World } from './world.ts';

export interface PrisonerHolding {
  readonly id: string;
  readonly feet: Readonly<{ x: number; y: number; z: number }>;
}

export function parsePrisonerHoldings(raw: unknown): PrisonerHolding[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length >= MAX_SLOTS) {
    throw new Error('prisonerHoldings: expected 1–5 carried-squad holdings');
  }
  const ids = new Set<string>();
  return raw.map((value, i) => {
    const at = `prisonerHoldings[${i}]`;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${at}: expected an object`);
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some((key) => key !== 'id' && key !== 'feet') ||
      typeof row['id'] !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(row['id']) || ids.has(row['id'])) {
      throw new Error(`${at}: expected a unique holding id and feet`);
    }
    ids.add(row['id']);
    const feet = row['feet'];
    if (!feet || typeof feet !== 'object' || Array.isArray(feet)) throw new Error(`${at}.feet: expected x/y/z`);
    const point = feet as Record<string, unknown>;
    if (Object.keys(point).some((key) => !['x', 'y', 'z'].includes(key)) || ['x', 'y', 'z'].some((key) =>
      typeof point[key] !== 'number' || !Number.isFinite(point[key]) || point[key] < POSITION.min || point[key] > POSITION.max)) {
      throw new Error(`${at}.feet: expected finite x/y/z within wire bounds`);
    }
    return { id: row['id'], feet: { x: point['x'] as number, y: point['y'] as number, z: point['z'] as number } };
  });
}

/** Fail content loading rather than snapping a holding onto a different floor. */
export function checkPrisonerHoldings(holdings: readonly PrisonerHolding[], world: World, config: MoveConfig = DEFAULT_MOVE_CONFIG): void {
  holdings.forEach(({ id, feet: p }, i) => {
    if (Math.abs(p.x) + config.radius > world.floorHalfWidth || Math.abs(p.z) + config.radius > world.floorHalfDepth ||
      Math.abs(supportUnder(p.x, p.z, config.radius, p.y + .001, world.boxes, config.groundY) - p.y) > .001 ||
      blockedAt(p.x, p.z, config.radius, p.y, 0, config.height, world.boxes)) {
      throw new Error(`prisoner holding '${id}': unsupported, obstructed or outside the authored floor`);
    }
    for (const other of holdings.slice(0, i)) {
      const q = other.feet;
      if (p.y < q.y + config.height && q.y < p.y + config.height &&
        (p.x - q.x) ** 2 + (p.z - q.z) ** 2 < (2 * config.radius) ** 2) {
        throw new Error(`prisoner holding '${id}': overlaps '${other.id}'`);
      }
    }
  });
}

/** Ascending squad slot maps to authored array order, independent of saved pool order/coordinates. */
export function placePrisoners(slots: readonly number[], holdings: readonly PrisonerHolding[]): { slot: number; at: { x: number; y: number; z: number } }[] | null {
  if (new Set(slots).size !== slots.length || slots.some((slot) => !Number.isInteger(slot) || slot < 0 || slot >= MAX_SLOTS)) {
    throw new Error('prisoner slots must be unique squad indices');
  }
  if (slots.length > holdings.length) return null;
  return [...slots].sort((a, b) => a - b).map((slot, i) => ({ slot, at: { ...holdings[i]!.feet } }));
}
