import { POSITION } from '../net/quantize.ts';

/** U-130: authored unions of closed 3D prisms, resolved against actual nav polygons on the server. */
export interface RegionVolume {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}
export type NavigationRegion = readonly RegionVolume[];

export function regionContains(region: NavigationRegion, p: { x: number; y: number; z: number }): boolean {
  return region.some((v) => p.x >= v.minX && p.x <= v.maxX && p.y >= v.minY && p.y <= v.maxY && p.z >= v.minZ && p.z <= v.maxZ);
}

/** Exact segment containment: split at every prism boundary, then test every interval. */
export function regionContainsSegment(region: NavigationRegion, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
  const stops = [0, 1];
  for (const v of region) for (const axis of ['X', 'Y', 'Z'] as const) {
    const key = axis.toLowerCase() as 'x' | 'y' | 'z';
    const d = b[key] - a[key];
    if (d === 0) continue;
    for (const edge of [v[`min${axis}`], v[`max${axis}`]]) {
      const t = (edge - a[key]) / d;
      if (t > 0 && t < 1) stops.push(t);
    }
  }
  stops.sort((x, y) => x - y);
  if (!regionContains(region, a) || !regionContains(region, b)) return false;
  for (let i = 1; i < stops.length; i++) {
    const t = (stops[i - 1]! + stops[i]!) / 2;
    if (!regionContains(region, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t })) return false;
  }
  return true;
}

export function parseNavigationRegion(where: string, raw: unknown): RegionVolume[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 32) throw new Error(`${where}: expected 1–32 region prisms`);
  const keys = ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ'] as const;
  return raw.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`${where}[${i}]: expected a prism`);
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!keys.includes(k as typeof keys[number]) && k !== '$comment') throw new Error(`${where}[${i}]: unknown key '${k}'`);
    const prism = {} as RegionVolume;
    for (const k of keys) {
      const n = o[k];
      if (typeof n !== 'number' || !Number.isFinite(n) || n < POSITION.min || n > POSITION.max) throw new Error(`${where}[${i}].${k}: expected a finite wire-range coordinate`);
      prism[k] = n;
    }
    for (const axis of ['X', 'Y', 'Z'] as const) if (prism[`min${axis}`] >= prism[`max${axis}`]) throw new Error(`${where}[${i}]: min${axis} must be below max${axis}`);
    return prism;
  });
}
