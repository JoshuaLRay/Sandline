import { describe, expect, it } from 'vitest';
import { type WorldBox } from '@sandline/shared';
import { buildRoadSupportWorld, ROAD_SUPPORTS } from './qalatRoadSupports.ts';
import { TANK_INGRESS, tankIngressPath } from './qalatTankIngress.ts';

type Point = { x: number; z: number };
// Independent §11.1 transcription; changing authoring data cannot move the test.
const X = [[96, 444], [114, 432], [112, 386], [104, 350], [84, 338], [54, 334], [16, 332]]
  .map(([x, z], i) => ({ id: `X${i}`, x: x!, y: 8, z: z! }));
// U-162 connects the same X sockets round a local opaque forecourt fin.
const PATH = [...X.slice(0, 5),
  { id: 'J1', x: 70, y: 8, z: 336 }, { id: 'J2', x: 70, y: 8, z: 349 },
  { id: 'J3', x: 58, y: 8, z: 349 }, X[5]!, { id: 'J4', x: 40, y: 8, z: 320 }, X[6]!];
const world = buildRoadSupportWorld(), rock = world.boxes.filter((b) => b.id.startsWith('road-rock'));
const CELL = 2, grid = new Map<string, WorldBox[]>();
for (const b of world.boxes) for (let x = Math.floor(b.minX / CELL); x <= Math.floor(b.maxX / CELL); x++)
  for (let z = Math.floor(b.minZ / CELL); z <= Math.floor(b.maxZ / CELL); z++) {
    const key = `${x},${z}`, row = grid.get(key);
    if (row) row.push(b); else grid.set(key, [b]);
  }
const column = (p: Point) => (grid.get(`${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`) ?? [])
  .filter((b) => p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ);
const onRibbon = (p: Point, a: Point, b: Point, half: number, margin = 0) => {
  const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
  const along = ((p.x - a.x) * dx + (p.z - a.z) * dz) / l;
  return along >= -margin && along <= l + margin && Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / l <= half + margin;
};
const onIngress = (p: Point, margin = 0) =>
  (p.x >= 86 - margin && p.x <= 106 + margin && p.z >= 434 - margin && p.z <= 454 + margin)
  || X.slice(1, 5).some((a) => Math.hypot(p.x - a.x, p.z - a.z) <= 18 + margin)
  || PATH.slice(1).some((b, i) => onRibbon(p, PATH[i]!, b, 6, margin))
  || PATH.filter((node) => node.id.startsWith('J')).some((node) =>
    Math.abs(p.x - node.x) <= 6 + margin && Math.abs(p.z - node.z) <= 6 + margin)
  || (Math.abs(p.x - 54) <= 3.5 + margin && Math.abs(p.z - 334) <= 3.5 + margin)
  || onRibbon(p, { x: 34.16, z: 336.7 }, { x: 54, z: 334 }, 2, margin)
  || onRibbon(p, { x: 16, z: 332 }, { x: 54, z: 334 }, 2, margin)
  || (p.x >= 32.16 - margin && p.x <= 36.16 + margin && p.z >= 334.7 - margin && p.z <= 338.7 + margin);
const main = ROAD_SUPPORTS.spine;
const onMain = (p: Point) => main.slice(1).some((b, i) => onRibbon(p, main[i]!, b, 10, .25))
  || main.slice(1, 9).some((a) => Math.hypot(p.x - a.x, p.z - a.z) <= 18.25);
const floor = (p: Point) => {
  const boxes = column(p);
  expect(boxes.some((b) => b.minY <= 7.99 && b.maxY === 8), `unsupported ${JSON.stringify(p)}`).toBe(true);
  expect(boxes.some((b) => b.id.startsWith('road-rock') && b.maxY > 8), `rock on ingress ${JSON.stringify(p)}`).toBe(false);
};

describe('U-151 exact service-spur construction', () => {
  it('pins X0–X6, motor-pool floor, canopy and two offset six-metre returns', () => {
    expect(TANK_INGRESS.spine).toEqual(X);
    expect(tankIngressPath()).toEqual(PATH);
    expect(TANK_INGRESS).toMatchObject({ carriagewayWidth: 12, apronDiameter: 36,
      apronNodes: ['X1', 'X2', 'X3', 'X4'],
      motorPool: { minX: 86, maxX: 106, minZ: 434, maxZ: 454, undersideY: 14, thicknessM: 2 } });
    const canopy = world.boxes.find((b) => b.id === 'X0-rock-canopy')!;
    expect(canopy).toMatchObject({ minY: 14, maxY: 16 });
    expect(canopy.minX).toBeLessThanOrEqual(86); expect(canopy.maxX).toBeGreaterThanOrEqual(106);
    expect(canopy.minZ).toBeLessThanOrEqual(434); expect(canopy.maxZ).toBeGreaterThanOrEqual(454);
    const keys = world.boxes.filter((b) => b.id.startsWith('X0-') && b.minY === 14 && b.maxY === 16);
    expect(keys.every((b) => b.minX <= canopy.maxX && b.maxX >= canopy.minX && b.minZ <= canopy.maxZ && b.maxZ >= canopy.minZ)).toBe(true);
    expect(rock.some((b) => b.maxY >= 16 && b.minY <= 14 && keys.some((k) => b.minX <= k.maxX && b.maxX >= k.minX
      && b.minZ <= k.maxZ && b.maxZ >= k.minZ)), 'canopy must merge into T-N').toBe(true);
    const returns = world.boxes.filter((b) => b.id.startsWith('X-return-'));
    expect(returns).toHaveLength(2);
    for (const b of returns) expect(b).toMatchObject({ minY: 8, maxY: 14 });
    expect(returns[0]!.maxZ < returns[1]!.minZ || returns[1]!.maxZ < returns[0]!.minZ).toBe(true);
    for (let x = 86; x <= 106; x += .5) for (let z = 434; z <= 454; z += .5) floor({ x, z });
  });

  it('supports and clears the full perpendicular 12 m lane and every 36 m turning apron at y8', () => {
    const returns = world.boxes.filter((b) => b.id.startsWith('X-return-'));
    const clear = (p: Point) => { floor(p); expect(column(p).some((b) => b.maxY > 8 && b.minY < 14), `solid in 12 m lane/apron ${JSON.stringify(p)}`).toBe(false); };
    for (let i = 1; i < PATH.length; i++) {
      const a = PATH[i - 1]!, b = PATH[i]!, dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
      for (let s = 0; s <= l; s += .25) {
        const p = { x: a.x + dx / l * s, z: a.z + dz / l * s };
        for (let off = -6; off <= 6; off += .5) clear({ x: p.x - dz / l * off, z: p.z + dx / l * off });
        for (const r of returns) expect(Math.hypot(Math.max(r.minX - p.x, 0, p.x - r.maxX),
          Math.max(r.minZ - p.z, 0, p.z - r.maxZ)), `return crosses central sweep ${r.id}`).toBeGreaterThanOrEqual(6);
      }
    }
    for (const a of PATH.filter((p) => p.id.startsWith('J')))
      for (let x = -6; x <= 6; x += .5) for (let z = -6; z <= 6; z += .5) clear({ x: a.x + x, z: a.z + z });
    for (let x = 50.5; x <= 57.5; x += .5) for (let z = 330.5; z <= 337.5; z += .5) clear({ x, z });
    for (const a of [{ x: 34.16, z: 336.7 }, { x: 16, z: 332 }]) {
      const b = { x: 54, z: 334 }, dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
      for (let s = 0; s <= l; s += .25) for (let off = -2; off <= 2; off += .5)
        clear({ x: a.x + dx / l * s - dz / l * off, z: a.z + dz / l * s + dx / l * off });
    }
    for (const a of X.slice(1, 5)) for (let degrees = 0; degrees < 360; degrees += 2) for (let r = 0; r <= 18; r += 1)
      clear({ x: a.x + r * Math.cos(degrees * Math.PI / 180), z: a.z + r * Math.sin(degrees * Math.PI / 180) });
  });

  it('encloses the spur edges with head-height rock, leaving its A8 mouth as the only approach', () => {
    let probes = 0; const missing: Point[] = [];
    const edge = (p: Point) => {
      if (onIngress(p, .25) || onMain(p)) return;
      if (!column(p).some((b) => b.minY <= 7.99 && b.maxY >= 10.2)) missing.push(p);
      probes++;
    };
    for (let i = 1; i < PATH.length; i++) {
      const a = PATH[i - 1]!, b = PATH[i]!, dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
      for (let s = 0; s <= l; s += .25) for (const off of [-6.3, 6.3])
        edge({ x: a.x + dx / l * s - dz / l * off, z: a.z + dz / l * s + dx / l * off });
    }
    for (const a of X.slice(1, 5)) for (let degrees = 0; degrees < 360; degrees += .5)
      edge({ x: a.x + 18.3 * Math.cos(degrees * Math.PI / 180), z: a.z + 18.3 * Math.sin(degrees * Math.PI / 180) });
    for (let z = 434; z <= 454; z += .25) for (const x of [85.7, 106.3]) edge({ x, z });
    for (let x = 86; x <= 106; x += .25) edge({ x, z: 454.3 });
    expect(missing.slice(0, 8), `${missing.length} open service-spur edges`).toEqual([]);
    expect(probes).toBeGreaterThan(1500);
  });

  it('leaves basement rooms below y5.5 and the exact future bridge deck volume empty', () => {
    expect(ROAD_SUPPORTS.reservedBridge).toEqual({ minX: 66, maxX: 74, minZ: 330, maxZ: 342, undersideY: 14, deckY: 16 });
    for (const b of world.boxes.filter((b) => /^(road-support|road-rock|road-cap|X)/.test(b.id))) {
      expect(b.minY).toBeGreaterThanOrEqual(5.5);
      expect(b.maxX <= 66 || b.minX >= 74 || b.maxZ <= 330 || b.minZ >= 342 || b.maxY <= 14 || b.minY >= 16,
        `occupies future bridge deck: ${b.id}`).toBe(true);
    }
    expect(world.boxes.some((b) => b.id.includes('bridge'))).toBe(false);
  });
});
