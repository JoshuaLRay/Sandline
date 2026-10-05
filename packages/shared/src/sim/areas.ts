import type { GroundArea } from './world.ts';

/** Optional inclusive feet-height bounds. Both ends must be authored together. */
export function parseAreaHeightBounds(
  where: string,
  raw: Record<string, unknown>,
  ErrorType: new (message: string) => Error = Error,
): Pick<GroundArea, 'minY' | 'maxY'> {
  if (!('minY' in raw) && !('maxY' in raw)) return {};
  const { minY, maxY } = raw;
  if (typeof minY !== 'number' || !Number.isFinite(minY) || typeof maxY !== 'number' || !Number.isFinite(maxY) || minY > maxY) {
    throw new ErrorType(`${where}: minY and maxY must both be finite numbers with minY <= maxY`);
  }
  return { minY, maxY };
}

/** Legacy circles ignore height; bounded areas never infer a missing actor y. */
export function areaContains(area: GroundArea, feet: { x: number; y?: number; z: number }): boolean {
  const dx = feet.x - area.x, dz = feet.z - area.z;
  if (!(dx * dx + dz * dz <= area.radius * area.radius)) return false;
  if (area.minY === undefined && area.maxY === undefined) return true;
  return feet.y !== undefined && Number.isFinite(feet.y)
    && feet.y >= (area.minY ?? -Infinity) && feet.y <= (area.maxY ?? Infinity);
}
