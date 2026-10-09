/**
 * The order wheel (T-3.29): which direction is which order, who a number key
 * addresses, and that the order goes to the point the crosshair's ray found.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ORDER_KINDS, SQUAD, STANCE_KINDS, boxFrom, decodeMessage, encodeMessage, orderProblem } from '@sandline/shared';
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
  wheelLabel,
} from './OrderWheel.ts';
import { pickFeet } from './orderPick.ts';

const NOTHING: AimSubject = { point: { x: 3, y: 0, z: 17 }, feet: { x: 3, y: 0, z: 17 }, netId: null, enemy: false, downedMate: false };

/** A pointer `r` pixels out at `deg` clockwise from the top of the screen. */
function at(deg: number, r = 80): { dx: number; dy: number } {
  const rad = (deg * Math.PI) / 180;
  return { dx: Math.sin(rad) * r, dy: -Math.cos(rad) * r };
}

describe('the wheel’s direction-to-order mapping', () => {
  it('has every order once, then every stance once (U-153), clockwise from the top', () => {
    expect([...ORDER_WHEEL].sort()).toEqual([...ORDER_KINDS, ...STANCE_KINDS].sort());
    expect(ORDER_WHEEL).toEqual(['move', 'attack', 'hold', 'regroup', 'revive', 'auto', 'crouch', 'prone']);
    expect(ORDER_WHEEL.map(wheelLabel)).toEqual(['move', 'attack', 'hold', 'regroup', 'revive', 'auto stance', 'crouch', 'prone']);
  });

  it('picks the sector the mouse went towards, eight of them clockwise from up', () => {
    expect(wheelChoice({ dx: 0, dy: -60 })).toBe('move');
    expect(wheelChoice(at(45))).toBe('attack');
    expect(wheelChoice(at(90))).toBe('hold');
    expect(wheelChoice(at(135))).toBe('regroup');
    expect(wheelChoice(at(180))).toBe('revive');
    expect(wheelChoice(at(225))).toBe('auto');
    expect(wheelChoice(at(270))).toBe('crouch');
    expect(wheelChoice(at(315))).toBe('prone');
    // Each sector spans 22.5° either side of its centre.
    expect(wheelChoice(at(22))).toBe('move');
    expect(wheelChoice(at(23))).toBe('attack');
    expect(wheelChoice(at(-22))).toBe('move');
    expect(wheelChoice(at(-23))).toBe('prone');
    expect(wheelChoice(at(157))).toBe('regroup');
    expect(wheelChoice(at(158))).toBe('revive');
  });

  it('cancels inside the deadzone, whatever the direction', () => {
    expect(wheelChoice({ dx: 0, dy: 0 })).toBeNull();
    for (let deg = 0; deg < 360; deg += 30) expect(wheelChoice(at(deg, WHEEL_DEADZONE_PX - 1))).toBeNull();
  });

  it('holds the pointer inside the wheel, so turning back costs the same however far the mouse ran', () => {
    let p = { dx: 0, dy: 0 };
    p = moveWheelPointer(p, 4000, 0);
    expect(Math.hypot(p.dx, p.dy)).toBeCloseTo(WHEEL_RADIUS_PX, 6);
    expect(wheelChoice(p)).toBe('hold');
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
  it('goes to the floor at the aim convergence point: the foot of the wall the crosshair’s ray met (U-123)', () => {
    // The page's convergence, in miniature: the camera's ray against what is shootable.
    const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 0.4));
    wall.position.set(1, 1.5, 12);
    wall.updateMatrixWorld();
    const boxes = [boxFrom({ id: 'wall', x: 1, y: 0, z: 12, w: 4, h: 3, d: 0.4 }, 'cover')];
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(0.05, -0.02, 1).normalize());
    const [hit] = ray.intersectObjects([wall], false);
    expect(hit).toBeDefined();
    expect(hit!.point.y).toBeGreaterThan(1);
    const aim: AimSubject = {
      point: { x: hit!.point.x, y: hit!.point.y, z: hit!.point.z },
      feet: pickFeet(hit!.point, ray.ray.origin, ray.ray.direction, { boxes, groundY: 0 }),
      netId: null, enemy: false, downedMate: false,
    };
    for (const kind of ['move', 'hold'] as const) {
      const order = buildOrder(kind, { to: 'all' }, aim)!;
      expect(order.point).toEqual(aim.feet);
      expect(order.point!.y).toBe(0);
      expect(order.point!.z).toBeLessThan(11.8);
      expect(Math.hypot(order.point!.x - hit!.point.x, order.point!.z - hit!.point.z)).toBeLessThan(0.06);
      expect(orderProblem(order, SQUAD.fireteams.length)).toBeNull();
    }
    // A mark still stands where the ray met the wall.
    expect(buildMark(aim).point).toEqual(aim.point);
    // A copy, not the page's live vector: the next frame's aim must not move a sent order.
    const order = buildOrder('move', { to: 'all' }, aim)!;
    const x = aim.feet.x;
    aim.feet.x = 99;
    expect(order.point!.x).toBe(x);
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
    expect(orderFromRelease({ pointer: at(90), address: { to: 'slot', index: 3 } }, NOTHING)).toMatchObject({ order: 'hold', address: { to: 'slot', index: 3 } });
    expect(orderFromRelease({ pointer: { dx: 3, dy: 2 }, address: { to: 'all' } }, NOTHING)).toBeNull();
  });

  it('a stance (U-153) goes to the same addressee with nothing under the crosshair, and survives the wire', () => {
    const cases = [[225, 'auto', { to: 'all' }], [270, 'crouch', { to: 'fireteam', index: 1 }], [315, 'prone', { to: 'slot', index: 4 }]] as const;
    for (const [deg, stance, address] of cases) {
      const sent = orderFromRelease({ pointer: at(deg), address }, NOTHING);
      expect(sent).toEqual({ kind: 'Stance', address, stance });
      expect(decodeMessage(encodeMessage(sent!))).toEqual(sent);
    }
  });

  it('marks the enemy under the crosshair, else the point', () => {
    expect(buildMark({ ...NOTHING, netId: 2001, enemy: true })).toEqual({ kind: 'Mark', point: NOTHING.point, target: 2001 });
    expect(buildMark({ ...NOTHING, netId: 3 })).toEqual({ kind: 'Mark', point: NOTHING.point, target: null });
  });
});
