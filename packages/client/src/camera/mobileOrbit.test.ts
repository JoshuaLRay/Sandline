import { describe, expect, it } from 'vitest';
import { mobileOrbit, MOBILE_ORBIT_PITCH } from './mobileOrbit.ts';

describe('mobile orbit camera', () => {
  const target = { x: 10, y: 0, z: 20 };
  it('keeps the chest as its pivot while orbiting and zooming', () => {
    for (const yaw of [0, 1, 3]) for (const pitch of [-1, MOBILE_ORBIT_PITCH, 0]) for (const distance of [3, 9, 18]) {
      const { focus, position } = mobileOrbit(target, yaw, pitch, distance, 0);
      expect(focus).toEqual({ x: 10, y: 1.2, z: 20 });
      expect(Math.hypot(position.x - focus.x, position.y - focus.y, position.z - focus.z)).toBeCloseTo(distance);
    }
  });
  it('shortens the arm at walls and holds it above the ground', () => {
    const blocked = mobileOrbit(target, 0, 0, 18, 0, { cast: () => 2 });
    expect(blocked.position.z).toBeCloseTo(18.2);
    const low = mobileOrbit(target, 0, 1, 18, 0);
    expect(low.position.y).toBeCloseTo(0.25);
  });
});
