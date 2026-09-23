/**
 * The order wheel (T-3.29): which direction is which order, who a number key
 * addresses, and that the order goes to the point the crosshair's ray found.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ORDER_KINDS, SQUAD, orderProblem } from '@sandline/shared';
import {
  ORDER_WHEEL,
  WHEEL_DEADZONE_PX,
  WHEEL_RADIUS_PX,
  type AimSubject,
  addressForDigit,
  buildMark,
  buildOrder,
  moveWheelPointer,
  orderFromRelease,
  wheelChoice,
} from './OrderWheel.ts';

const NOTHING: AimSubject = { point: { x: 3, y: 0, z: 17 }, netId: null, enemy: false, downedMate: false };

/** A pointer `r` pixels out at `deg` clockwise from the top of the screen. */
function at(deg: number, r = 80): { dx: number; dy: number } {
  const rad = (deg * Math.PI) / 180;
  return { dx: Math.sin(rad) * r, dy: -Math.cos(rad) * r };
}

describe('the wheel’s direction-to-order mapping', () => {
  it('has every order once, clockwise from the top', () => {
    expect([...ORDER_WHEEL].sort()).toEqual([...ORDER_KINDS].sort());
    expect(ORDER_WHEEL).toEqual(['move', 'attack', 'hold', 'regroup', 'revive']);
  });

  it('picks the sector the mouse went towards: up, upper right, lower right, lower left, upper left', () => {
    expect(wheelChoice({ dx: 0, dy: -60 })).toBe('move');
    expect(wheelChoice(at(72))).toBe('attack');
    expect(wheelChoice(at(144))).toBe('hold');
    expect(wheelChoice(at(216))).toBe('regroup');
    expect(wheelChoice(at(288))).toBe('revive');
    // Each sector spans 36° either side of its centre.
    expect(wheelChoice(at(35))).toBe('move');
    expect(wheelChoice(at(37))).toBe('attack');
    expect(wheelChoice(at(-35))).toBe('move');
    expect(wheelChoice(at(-37))).toBe('revive');
    expect(wheelChoice(at(179))).toBe('hold');
    expect(wheelChoice(at(181))).toBe('regroup');
  });

  it('cancels inside the deadzone, whatever the direction', () => {
    expect(wheelChoice({ dx: 0, dy: 0 })).toBeNull();
    for (let deg = 0; deg < 360; deg += 30) expect(wheelChoice(at(deg, WHEEL_DEADZONE_PX - 1))).toBeNull();
  });

  it('holds the pointer inside the wheel, so turning back costs the same however far the mouse ran', () => {
    let p = { dx: 0, dy: 0 };
    p = moveWheelPointer(p, 4000, 0);
    expect(Math.hypot(p.dx, p.dy)).toBeCloseTo(WHEEL_RADIUS_PX, 6);
    expect(wheelChoice(p)).toBe('attack');
    // Straight up from there: the full radius back across, and the top wins.
    p = moveWheelPointer(p, -WHEEL_RADIUS_PX, -WHEEL_RADIUS_PX * 2);
    expect(wheelChoice(p)).toBe('move');
  });
});

describe('who hears it', () => {
  it('1–6 a slot, 7–8 a fireteam, 0 everyone, 9 nobody', () => {
    for (let d = 1; d <= 6; d++) expect(addressForDigit(d)).toEqual({ to: 'slot', index: d - 1 });
    expect(SQUAD.fireteams).toHaveLength(2);
    expect(addressForDigit(7)).toEqual({ to: 'fireteam', index: 0 });
    expect(addressForDigit(8)).toEqual({ to: 'fireteam', index: 1 });
    expect(addressForDigit(0)).toEqual({ to: 'all' });
    expect(addressForDigit(9)).toBeNull();
  });
});

describe('the order it builds', () => {
  it('goes to the aim convergence point: where the crosshair’s ray met the world', () => {
    // The page's convergence, in miniature: the camera's ray against what is shootable.
    const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 0.4));
    wall.position.set(1, 1.5, 12);
    wall.updateMatrixWorld();
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(0.05, -0.02, 1).normalize());
    const [hit] = ray.intersectObjects([wall], false);
    expect(hit).toBeDefined();
    const aim: AimSubject = { point: { x: hit!.point.x, y: hit!.point.y, z: hit!.point.z }, netId: null, enemy: false, downedMate: false };
    for (const kind of ['move', 'hold'] as const) {
      const order = buildOrder(kind, { to: 'all' }, aim)!;
      expect(order.point).toEqual({ x: hit!.point.x, y: hit!.point.y, z: hit!.point.z });
      expect(orderProblem(order, SQUAD.fireteams.length)).toBeNull();
    }
    // A copy, not the page's live vector: the next frame's aim must not move a sent order.
    const order = buildOrder('move', { to: 'all' }, aim)!;
    aim.point.x = 99;
    expect(order.point!.x).toBe(hit!.point.x);
  });

  it('attacks only an enemy under the crosshair, revives only a downed squadmate, regroups on nothing', () => {
    expect(buildOrder('attack', { to: 'all' }, NOTHING)).toBeNull();
    expect(buildOrder('attack', { to: 'all' }, { ...NOTHING, netId: 2003, enemy: true })).toEqual({
      kind: 'Order',
      order: 'attack',
      address: { to: 'all' },
      point: null,
      target: 2003,
    });
    expect(buildOrder('revive', { to: 'slot', index: 2 }, { ...NOTHING, netId: 4 })).toBeNull();
    expect(buildOrder('revive', { to: 'slot', index: 2 }, { ...NOTHING, netId: 4, downedMate: true })?.target).toBe(4);
    expect(buildOrder('regroup', { to: 'fireteam', index: 1 }, NOTHING)).toEqual({
      kind: 'Order',
      order: 'regroup',
      address: { to: 'fireteam', index: 1 },
      point: null,
      target: null,
    });
    // Everything it builds is well formed.
    const any = { ...NOTHING, netId: 5, enemy: true, downedMate: true };
    for (const kind of ORDER_KINDS) expect(orderProblem(buildOrder(kind, { to: 'all' }, any)!, SQUAD.fireteams.length)).toBeNull();
  });

  it('from a release: the sector it was left on, to whom the digits said; none inside the deadzone', () => {
    expect(orderFromRelease({ pointer: at(144), address: { to: 'slot', index: 3 } }, NOTHING)).toMatchObject({ order: 'hold', address: { to: 'slot', index: 3 } });
    expect(orderFromRelease({ pointer: { dx: 3, dy: 2 }, address: { to: 'all' } }, NOTHING)).toBeNull();
  });

  it('marks the enemy under the crosshair, else the point', () => {
    expect(buildMark({ ...NOTHING, netId: 2001, enemy: true })).toEqual({ kind: 'Mark', point: NOTHING.point, target: 2001 });
    expect(buildMark({ ...NOTHING, netId: 3 })).toEqual({ kind: 'Mark', point: NOTHING.point, target: null });
  });
});
