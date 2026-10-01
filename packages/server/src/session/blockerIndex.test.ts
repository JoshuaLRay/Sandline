/**
 * U-083: the session's collision list is indexed for rays, and re-indexed whenever a script blocker changes it, so a
 * gate that opens or shuts is seen by the very next line-of-sight ray, even when one toggle undoes another's change
 * of length.
 */
import { describe, expect, it } from 'vitest';
import { boxFrom, loadWorld, rayWorld, type WorldBox } from '@sandline/shared';
import { Session } from './Session.ts';

// 100 crates far from the lane the gates stand in, so the list is big enough to be indexed.
const crates = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, x: -200 + (i % 10) * 40, y: 0, z: 100 + Math.floor(i / 10) * 20, w: 2, h: 1.2, d: 2 }));
const world = loadWorld({ id: 'gate-world', floor: { halfExtent: 300 }, cover: crates });

const gate = (id: string, z: number): WorldBox[] => [boxFrom({ id, x: 0, y: 1, z, w: 1, h: 4, d: 8 }, 'blocker')];
const ray = (z: number) => ({ origin: { x: -10, y: 1, z }, direction: { x: 1, y: 0, z: 0 }, maxDistance: 20 });

interface Internals {
  collisionBoxes: WorldBox[];
  setBlocker(b: { id: string; active: boolean; boxes: readonly WorldBox[] }): void;
}

describe('script blockers and the ray index (U-083)', () => {
  it('a gate shut is seen by the next ray, and open is not; swapping two at the same length is seen', () => {
    const session = new Session(undefined, '', world, {}) as unknown as Internals;
    expect(session.collisionBoxes.length).toBe(100);
    const a = gate('a', 0);
    const b = gate('b', 30);
    expect(rayWorld(ray(0), session.collisionBoxes)).toBeNull();

    session.setBlocker({ id: 'a', active: true, boxes: a });
    expect(rayWorld(ray(0), session.collisionBoxes)?.box.id).toBe('a');

    // One toggle undoing the other's change of length: a off, b on. The list is as long as before, and different.
    session.setBlocker({ id: 'b', active: true, boxes: b });
    session.setBlocker({ id: 'a', active: false, boxes: a });
    expect(session.collisionBoxes.length).toBe(101);
    expect(rayWorld(ray(0), session.collisionBoxes)).toBeNull();
    expect(rayWorld(ray(30), session.collisionBoxes)?.box.id).toBe('b');
  });
});
