/**
 * U-083: the box index is culling only. A big list of boxes, indexed, answers every ray exactly as the same list
 * scanned does: the same box, distance, point and face, including rays that start inside a box, run along a face or
 * have a zero component, are inflated, or are longer than the map. A list changed in place and not re-indexed falls
 * back to the scan rather than to a stale answer.
 */
import { describe, expect, it } from 'vitest';
import { Sfc32, seedFrom } from '../math/prng.ts';
import { GRID_MIN_BOXES, type WorldBox, boxFrom, indexBoxes, rayWorld } from './world.ts';

function randomBoxes(rng: Sfc32, count: number, spread: number): WorldBox[] {
  return Array.from({ length: count }, (_, i) =>
    boxFrom(
      {
        id: `b${i}`,
        x: (rng.next() - 0.5) * spread,
        y: rng.next() * 2,
        z: (rng.next() - 0.5) * spread,
        w: 0.3 + rng.next() * 8,
        h: 0.3 + rng.next() * 3,
        d: 0.3 + rng.next() * 8,
      },
      'cover',
    ),
  );
}

/** A direction: usually random, sometimes along an axis or in the ground plane, so zero components are common. */
function direction(rng: Sfc32): { x: number; y: number; z: number } {
  const pick = Math.floor(rng.next() * 8);
  if (pick === 0) return { x: 1, y: 0, z: 0 };
  if (pick === 1) return { x: 0, y: 0, z: -1 };
  if (pick === 2) return { x: 0, y: 1, z: 0 };
  let v = { x: rng.next() - 0.5, y: pick === 3 ? 0 : (rng.next() - 0.5) * 0.4, z: rng.next() - 0.5 };
  if (pick === 4) v = { ...v, z: 0 };
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

describe('the box index answers as the scan does (U-083)', () => {
  it('for thousands of random rays, short and long, plain and inflated, over a big list', () => {
    const rng = new Sfc32(seedFrom(83, 1));
    const boxes = randomBoxes(rng, 400, 600);
    const scanned = [...boxes];
    indexBoxes(boxes);
    expect(boxes.length).toBeGreaterThanOrEqual(GRID_MIN_BOXES);
    let hits = 0;
    for (let i = 0; i < 6000; i++) {
      // Half start in the open, a few inside a box.
      const inside = i % 7 === 0 ? boxes[Math.floor(rng.next() * boxes.length)]! : null;
      const origin = inside
        ? { x: (inside.minX + inside.maxX) / 2, y: (inside.minY + inside.maxY) / 2, z: (inside.minZ + inside.maxZ) / 2 }
        : { x: (rng.next() - 0.5) * 640, y: rng.next() * 2.5, z: (rng.next() - 0.5) * 640 };
      const ray = { origin, direction: direction(rng), maxDistance: [2, 15, 60, 150, 900][i % 5]! };
      const inflate = [0, 0, 0.1, 0.3, 1, 1.5][i % 6]!;
      const a = rayWorld(ray, boxes, inflate);
      const b = rayWorld(ray, scanned, inflate);
      expect(a).toEqual(b);
      if (a) {
        hits++;
        expect(a.box).toBe(b!.box);
      }
    }
    expect(hits).toBeGreaterThan(500);
  });

  it('gives a tie between two boxes to the one earlier in the list, as the scan does', () => {
    // Two boxes sharing a face, one entered through each at the same distance only at the shared plane.
    const filler = randomBoxes(new Sfc32(seedFrom(83, 2)), 100, 400);
    const left = boxFrom({ id: 'left', x: -1, y: 1, z: 0, w: 2, h: 2, d: 2 }, 'cover');
    const right = boxFrom({ id: 'right', x: 1, y: 1, z: 0, w: 2, h: 2, d: 2 }, 'cover');
    for (const order of [[left, right], [right, left]]) {
      const boxes = [...filler, ...order];
      const scanned = [...boxes];
      indexBoxes(boxes);
      const ray = { origin: { x: -5, y: 1, z: 0 }, direction: { x: 1, y: 0, z: 0 }, maxDistance: 20 };
      expect(rayWorld(ray, boxes)?.box).toBe(rayWorld(ray, scanned)?.box);
    }
  });

  it('leaves a short list to the scan, and drops an index when the list shrinks below the threshold', () => {
    const rng = new Sfc32(seedFrom(83, 3));
    const small = randomBoxes(rng, GRID_MIN_BOXES - 1, 200);
    indexBoxes(small);
    const ray = { origin: { x: -300, y: 1, z: 0 }, direction: { x: 1, y: 0, z: 0 }, maxDistance: 600 };
    expect(rayWorld(ray, small)).toEqual(rayWorld(ray, [...small]));
    const big = randomBoxes(rng, GRID_MIN_BOXES + 20, 200);
    indexBoxes(big);
    big.length = GRID_MIN_BOXES - 1;
    indexBoxes(big);
    expect(rayWorld(ray, big)).toEqual(rayWorld(ray, [...big]));
  });

  it('never answers from a stale index: a list changed in place and not re-indexed is scanned', () => {
    const rng = new Sfc32(seedFrom(83, 4));
    const boxes = randomBoxes(rng, 120, 300);
    indexBoxes(boxes);
    const wall = boxFrom({ id: 'wall', x: 0, y: 1, z: 0, w: 1, h: 4, d: 60 }, 'blocker');
    boxes.push(wall);
    const ray = { origin: { x: -10, y: 1, z: 0 }, direction: { x: 1, y: 0, z: 0 }, maxDistance: 20 };
    // Whatever else is near, the wall just added is seen even though the index never heard of it.
    const hit = rayWorld(ray, boxes);
    expect(hit).toEqual(rayWorld(ray, [...boxes]));
    expect(hit).not.toBeNull();
    // Re-indexed, the same answer.
    indexBoxes(boxes);
    expect(rayWorld(ray, boxes)).toEqual(hit);
  });

  it('sees a box that replaced another at the same length only once the list is re-indexed (why the session re-indexes on every blocker change)', () => {
    const rng = new Sfc32(seedFrom(83, 5));
    // Filler well clear of the ray's lane (|z| > 15), so the gate is the only thing it can meet.
    const boxes = randomBoxes(rng, 400, 600).filter((b) => b.minZ > 15 || b.maxZ < -15);
    expect(boxes.length).toBeGreaterThan(GRID_MIN_BOXES);
    indexBoxes(boxes);
    const gate = boxFrom({ id: 'gate', x: 0, y: 1, z: 0, w: 1, h: 4, d: 8 }, 'blocker');
    const ray = { origin: { x: -10, y: 1, z: 0 }, direction: { x: 1, y: 0, z: 0 }, maxDistance: 20 };
    // The gate replaces the first box: same length, different contents, as two blocker toggles in one tick can leave it.
    boxes.splice(0, 1, gate);
    expect(rayWorld(ray, [...boxes])?.box.id).toBe('gate');
    // The length check cannot catch this; the index is stale and misses it. That is the hazard, and the reason the
    // session re-indexes at the one place it changes its list.
    expect(rayWorld(ray, boxes)?.box.id).not.toBe('gate');
    indexBoxes(boxes);
    expect(rayWorld(ray, boxes)?.box.id).toBe('gate');
  });
});
