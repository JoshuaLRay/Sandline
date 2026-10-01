/**
 * U-070: a tank's look as numbers — the turret eased at its own rate, the flash when the lock ends on a living
 * tank, a wreck once it is dead, and the HUD's words for a tank under the crosshair.
 */
import { describe, expect, it } from 'vitest';
import { TANK_FLASH_SECONDS, TankFx, easeYaw, shortestTurn, tankTargetView, wireRadians } from './tankLook.ts';

const DT = 1 / 30;
const RATE = (45 * Math.PI) / 180;
const base = { hullYaw: 0, turretWire: 0, aiming: false, vitality: 'alive' as const, turnRadPerSec: RATE };

describe('turning the short way', () => {
  it('takes the near side across the seam and never overshoots', () => {
    expect(shortestTurn(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(-0.2, 9);
    expect(easeYaw(0, Math.PI * 2 - 0.5, 0.2)).toBeCloseTo(-0.2, 9);
    expect(easeYaw(0, 0.1, 0.5)).toBe(0.1);
  });
});

describe('the turret (U-070)', () => {
  it('is placed where it points on first sight, then follows a new yaw at its own rate, not at once', () => {
    const fx = new TankFx();
    expect(fx.update({ ...base, turretWire: 256 }, DT).turretYaw).toBeCloseTo(wireRadians(256), 9);
    // The server turns it a quarter round; the picture takes time.
    const next = fx.update({ ...base, turretWire: 512 }, DT);
    expect(next.turretYaw).toBeGreaterThan(wireRadians(256));
    expect(next.turretYaw).toBeLessThan(wireRadians(512));
    expect(next.turretYaw - wireRadians(256)).toBeLessThanOrEqual(RATE * 1.25 * DT + 1e-9);
    for (let i = 0; i < 120; i++) fx.update({ ...base, turretWire: 512 }, DT);
    expect(fx.update({ ...base, turretWire: 512 }, DT).turretYaw).toBeCloseTo(wireRadians(512), 9);
  });

  it('is drawn relative to the hull, so turning the hull alone does not turn the gun', () => {
    const fx = new TankFx();
    fx.update({ ...base, hullYaw: 0, turretWire: 256 }, DT);
    const frame = fx.update({ ...base, hullYaw: Math.PI / 2, turretWire: 256 }, DT);
    expect(frame.turretRelative).toBeCloseTo(0, 9);
  });
});

describe('the tell and the flash (U-070)', () => {
  it('glows while the cannon is locked, and flashes briefly when the lock ends on a living tank', () => {
    const fx = new TankFx();
    expect(fx.update(base, DT)).toMatchObject({ tell: 0, flash: false });
    expect(fx.update({ ...base, aiming: true }, DT).tell).toBeGreaterThan(0.5);
    const fired = fx.update(base, DT);
    expect(fired).toMatchObject({ tell: 0, flash: true });
    for (let i = 0; i < Math.ceil(TANK_FLASH_SECONDS / DT) + 1; i++) fx.update(base, DT);
    expect(fx.update(base, DT).flash).toBe(false);
  });

  it('does not flash for a tank killed in its tell, and shows a wreck with no glow', () => {
    const fx = new TankFx();
    fx.update({ ...base, aiming: true }, DT);
    const dead = fx.update({ ...base, aiming: true, vitality: 'dead' }, DT);
    expect(dead).toMatchObject({ wreck: true, tell: 0, flash: false });
    const after = fx.update({ ...base, aiming: false, vitality: 'dead' }, DT);
    expect(after).toMatchObject({ wreck: true, flash: false });
  });

  it('keeps a wreck\'s turret where it stopped', () => {
    const fx = new TankFx();
    fx.update({ ...base, turretWire: 100 }, DT);
    const dead = fx.update({ ...base, turretWire: 400, vitality: 'dead' }, DT);
    expect(dead.turretYaw).toBeCloseTo(wireRadians(100), 9);
  });
});

describe('the HUD words for a tank (U-070)', () => {
  it('shows health, a bar and what hurts it', () => {
    expect(tankTargetView({ name: 'Tank', current: 640, max: 1000, vitality: 'alive' })).toEqual({
      label: 'TANK  640 / 1000',
      fraction: 0.64,
      armour: 'ARMOURED — rockets, C4 and claymores',
    });
  });

  it('clamps the bar, calls a dead one a wreck, and says nothing with no tank', () => {
    expect(tankTargetView({ name: 'Tank', current: 1200, max: 1000, vitality: 'alive' })!.fraction).toBe(1);
    expect(tankTargetView({ name: 'Tank', current: 5, max: 0, vitality: 'alive' })!.fraction).toBe(0);
    expect(tankTargetView({ name: 'Tank', current: 0, max: 1000, vitality: 'dead' })).toEqual({ label: 'TANK  WRECK', fraction: 0, armour: '' });
    expect(tankTargetView(null)).toBeNull();
  });
});
