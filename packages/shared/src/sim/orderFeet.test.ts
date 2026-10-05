import { describe, expect, it } from 'vitest';
import { loadWorld } from './world.ts';
import { ORDER_PICK_BACKOFF_M, orderFeet } from './orderFeet.ts';

/** Ground y0; a slab y5.5..8 over x/z ±8; a bridge y14..16 over x/z ±5; a wall standing on the slab. */
const world = loadWorld({ id: 'order-feet', floor: { halfExtent: 30 }, cover: [
  { id: 'surface', x: 0, y: 5.5, z: 0, w: 16, d: 16, h: 2.5 },
  { id: 'bridge', x: 0, y: 14, z: 0, w: 10, d: 10, h: 2 },
  { id: 'wall', x: 6, y: 8, z: 0, w: .3, d: 4, h: 3 },
] });
const down = (x: number, z: number) => ({ x: x * 0.1, y: -1, z: z * 0.1 });

describe('order picks become feet on the floor pointed at (U-123)', () => {
  it('keeps each storey’s top at identical x/z: y0, y8 and y16', () => {
    expect(orderFeet({ x: 9, y: 0, z: 0 }, down(1, 0), world.boxes, 0).y).toBe(0);
    expect(orderFeet({ x: 6.5, y: 8, z: 7 }, down(0, 1), world.boxes, 0).y).toBe(8);
    expect(orderFeet({ x: 0, y: 16, z: 0 }, down(0, 0), world.boxes, 0).y).toBe(16);
    // Seen from under the bridge, the y8 top is still y8; from under the slab, the ground is still y0.
    expect(orderFeet({ x: 0, y: 8, z: 0 }, { x: 1, y: -0.2, z: 0 }, world.boxes, 0).y).toBe(8);
    expect(orderFeet({ x: 0, y: 0, z: 0 }, { x: 1, y: -0.2, z: 0 }, world.boxes, 0).y).toBe(0);
  });

  it('takes a wall’s face to the floor at its foot, not the floor below that floor', () => {
    const feet = orderFeet({ x: 5.85, y: 9.7, z: 0 }, { x: 1, y: 0, z: 0 }, world.boxes, 0);
    expect(feet.y).toBe(8);
    expect(feet.x).toBeCloseTo(5.85 - ORDER_PICK_BACKOFF_M, 9);
  });

  it('takes a ceiling’s underside to the floor beneath it, never the storey above', () => {
    // Looking up from the basement at the slab's underside, and from the y8 deck at the bridge's.
    expect(orderFeet({ x: 1, y: 5.5, z: 1 }, { x: 0.3, y: 1, z: 0 }, world.boxes, 0).y).toBe(0);
    expect(orderFeet({ x: 1, y: 14, z: 1 }, { x: 0.3, y: 1, z: 0 }, world.boxes, 0).y).toBe(8);
  });

  it('puts a pick on a soldier at the floor they stand on', () => {
    expect(orderFeet({ x: 2, y: 9.2, z: 2 }, { x: 0, y: -0.1, z: 1 }, world.boxes, 0).y).toBe(8);
    expect(orderFeet({ x: 2, y: 1.2, z: 2 }, { x: 0, y: -0.1, z: 1 }, world.boxes, 0).y).toBe(0);
  });
});
