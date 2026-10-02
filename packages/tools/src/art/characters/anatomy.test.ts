import { describe, expect, it } from 'vitest';
import { HUMANOID_BONES } from '../../../../client/src/character/humanoidRig.ts';
import { anatomicalHead, anatomicalSleeve, buildTrouserFork } from './anatomy.ts';
import { region } from './soldierAtlas.ts';
import { SkinBuilder } from './skin.ts';

// These checks protect the defects that prompted the rework: independently
// capped pelvis/legs, shoulder end-caps and facial features only in paint.
describe('procedural anatomical surfaces', () => {
  it('joins waist and both thighs into one connected shell with shared vertical UV registration', () => {
    const b = new SkinBuilder();
    buildTrouserFork(b, region('trousers'));
    const skin = b.build();
    const keys = Array.from({ length: skin.positions.length / 3 }, (_, i) => skin.positions.slice(i * 3, i * 3 + 3).join(','));
    const edges = new Map<string, Set<string>>();
    for (let i = 0; i < skin.indices[0].length; i += 3) {
      const tri = skin.indices[0].slice(i, i + 3).map((v) => keys[v]!);
      for (const a of tri) for (const c of tri) {
        const neighbours = edges.get(a) ?? new Set<string>();
        neighbours.add(c);
        edges.set(a, neighbours);
      }
    }
    const visited = new Set<string>();
    const pending = [keys[0]!];
    while (pending.length) {
      const key = pending.pop()!;
      if (visited.has(key)) continue;
      visited.add(key);
      pending.push(...edges.get(key)!);
    }
    expect(visited.size).toBe(new Set(keys).size);
    const r = region('trousers');
    for (let v = 0; v < keys.length; v++) {
      // Mapping uses the undeformed section's height: wrinkles move vertices
      // by at most 2 mm, and keep their texture attached to the same cloth.
      const y = skin.positions[v * 3 + 1]!;
      if (y > .90) expect(skin.uvs[v * 2 + 1]).toBeCloseTo(r.v0 + (r.v1 - r.v0) * ((.985 - y) / .775), 5);
    }
    const left = HUMANOID_BONES.indexOf('upper-leg-left');
    const right = HUMANOID_BONES.indexOf('upper-leg-right');
    expect(skin.joints.includes(left)).toBe(true);
    expect(skin.joints.includes(right)).toBe(true);
  });

  it('starts each shoulder inside the torso and slopes into a rounded deltoid instead of a wide flat cap', () => {
    for (const s of [-1, 1] as const) {
      const rings = anatomicalSleeve(s);
      expect(Math.abs(rings[0]!.cx!) + rings[0]!.rx).toBeLessThan(.13);
      expect(rings[0]!.rx).toBeLessThan(rings[6]!.rx / 3);
      const edges = rings.slice(0, 7).map((r) => Math.abs(r.cx!) + r.rx);
      for (let i = 1; i < edges.length; i++) expect(edges[i]! - edges[i - 1]!).toBeGreaterThan(0);
    }
  });

  it('models eye sockets below the brow and a projecting nose in the mesh', () => {
    const head = anatomicalHead();
    const brow = head.find((r) => r.y === 1.69)!;
    const eye = head.find((r) => r.y === 1.676)!;
    const nose = head.find((r) => r.y === 1.66)!;
    const socketZ = eye.surface!(.445, [0, eye.y, eye.rzF])[2];
    expect(socketZ).toBeLessThan(eye.rzF);
    expect(brow.surface!(.445, [0, brow.y, brow.rzF])[2]).toBeGreaterThan(brow.rzF);
    expect(nose.surface!(.5, [0, nose.y, nose.rzF])[2]).toBeGreaterThan(nose.rzF + .02);
  });
});
