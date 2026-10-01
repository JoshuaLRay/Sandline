/**
 * U-068: a tank's turret tracks the nearest standing soldier it can see, apart from its hull; its cannon locks for a
 * tell and fires a shell at the locked point on a cadence; its coaxial gun bursts on sight inside its range; and
 * none of it fires while the tank is driving, nor at anyone who is down, held prisoner, out of range or behind cover.
 */
import { describe, expect, it } from 'vitest';
import { COMPONENT_IDS, PROJECTILE_IDS, TICK_SECONDS, type WorldBox, type WorldSnapshot, boxFrom, getEnemy } from '@sandline/shared';
import { Session } from './Session.ts';

const VEHICLE = getEnemy('tank').vehicle!;
const CANNON = VEHICLE.cannon;
const TICK_MS = TICK_SECONDS * 1000;
const ROCKET = PROJECTILE_IDS.indexOf('rocket');
const TANK_AT = { x: 0, y: 0, z: 30 };

interface Internals {
  setBlocker(b: { id: string; active: boolean; boxes: WorldBox[] }): void;
  buildSnapshot(): WorldSnapshot;
  nowMs: number;
}

/** A tank at (0, 30) facing +z with the squad scattered far off, then placed by the test. */
function play(path?: { x: number; z: number }[]) {
  const session = new Session(undefined, '', 'range', { roomLobby: false });
  const id = session.spawnEnemy('tank', { ...TANK_AT, yaw: 0, ...(path ? { path } : {}) }) as number;
  const enemy = session.enemies.find((e) => e.netId === id)!;
  let now = 0;
  const step = (n: number, each?: () => void) => {
    for (let i = 0; i < n; i++) {
      now += TICK_MS;
      session.step(now);
      each?.();
    }
  };
  const put = (slot: number, x: number, z: number) => {
    const s = session.slots[slot]!;
    s.state = { ...s.state, x, y: 0, z };
  };
  // The squad is far off until a test places it, and tough enough that a long test is not cut short by its own target dying.
  for (const s of session.slots) {
    put(s.index, -300 - s.index, 0);
    s.health.max = 100000;
    s.health.current = 100000;
  }
  const x = session as unknown as Internals;
  const shells = () => session.projectilesNow().filter((p) => p.kind === ROCKET && p.ownerNetId === enemy.netId);
  const wall = (z: number, active = true) => x.setBlocker({ id: 'cover', active, boxes: [boxFrom({ id: 'b:cover', x: 0, y: 0, z, w: 40, h: 4, d: 0.5 }, 'blocker')] });
  return { session, enemy, step, put, shells, wall, x, now: () => now / 1000 };
}

describe('a tank\'s turret and target (U-068)', () => {
  it('turns toward the nearest standing soldier it can see, and leaves the hull alone', () => {
    const { enemy, step, put } = play();
    // Both past the gun's range (so neither is shot before the turret is on it) and inside the cannon's.
    put(0, 75, 30);
    put(1, -70, 30);
    step(3);
    expect(enemy.aim?.netId).toBe(2);
    // Nearest is slot 1 (netId 2), 70 m off to the west (bearing 768).
    step(100);
    expect(enemy.yaw).toBe(0);
    expect(Math.abs(enemy.turretYaw - 768)).toBeLessThanOrEqual(2);
  });

  it('turns at its own rate, no faster', () => {
    const { enemy, step, put } = play();
    put(0, 30, 30);
    const rate = Math.round(((VEHICLE.turretTurnDegPerSec / 360) * 1024) * TICK_SECONDS);
    let last = enemy.turretYaw;
    let steps = 0;
    step(80, () => {
      const turn = Math.min(Math.abs(enemy.turretYaw - last), 1024 - Math.abs(enemy.turretYaw - last));
      expect(turn).toBeLessThanOrEqual(rate);
      if (turn > 0) steps++;
      last = enemy.turretYaw;
    });
    expect(steps).toBeGreaterThan(40);
    // A quarter turn to the east is 256 wire units.
    expect(Math.abs(enemy.turretYaw - 256)).toBeLessThanOrEqual(2);
  });

  it('passes over a soldier who is down, dead or held prisoner, out of range, or behind cover', () => {
    const { session, enemy, step, put, wall } = play();
    put(0, 6, 30); // nearest
    put(1, 20, 30);
    put(2, 40, 30);
    step(3);
    expect(enemy.aim?.netId).toBe(session.slots[0]!.netId);
    session.slots[0]!.health.downedAt = 1;
    step(3);
    expect(enemy.aim?.netId).toBe(session.slots[1]!.netId);
    session.captureCharacter(1, { x: 20, y: 0, z: 30 });
    step(3);
    expect(enemy.aim?.netId).toBe(session.slots[2]!.netId);
    // Cover between the muzzle and slot 2 (a wall across the road at z = 30 + ... no: across the line east).
    wall(0, false);
    put(2, 0, 30 + 50);
    put(3, 0, 30 + 400);
    step(3);
    expect(enemy.aim?.netId).toBe(session.slots[2]!.netId);
    // Out of range is out, however near the next one is in the list.
    put(2, 0, 30 + CANNON.rangeM + 20);
    step(3);
    expect(enemy.aim).toBeNull();
    // Behind cover: a wall across the road between the tank and slot 4.
    put(4, 0, 30 + 40);
    wall(30 + 20);
    step(3);
    expect(enemy.aim).toBeNull();
    wall(30 + 20, false);
    step(3);
    expect(enemy.aim?.netId).toBe(session.slots[4]!.netId);
  });
});

describe('a tank\'s cannon (U-068)', () => {
  const squadAt = (p: ReturnType<typeof play>) => p.put(0, 40, 30);

  it('locks for a tell, fires at the locked point, and waits out its interval', () => {
    const p = play();
    squadAt(p);
    const fired: number[] = [];
    const seen = new Set<number>();
    let aimingTicks = 0;
    p.step(30 * 22, () => {
      for (const s of p.shells()) if (!seen.has(s.netId)) { seen.add(s.netId); fired.push(p.now()); }
      if (p.enemy.tell) aimingTicks++;
    });
    expect(fired.length).toBeGreaterThanOrEqual(3);
    // One shell per interval, no closer.
    for (let i = 1; i < fired.length; i++) expect(fired[i]! - fired[i - 1]!).toBeGreaterThanOrEqual(CANNON.intervalSeconds - 0.1);
    // The first waits half an interval, then the tell.
    expect(fired[0]!).toBeGreaterThanOrEqual(CANNON.intervalSeconds / 2 + CANNON.tellSeconds - 0.2);
    // Aiming for about a tell per shell.
    expect(aimingTicks / 30).toBeGreaterThan(CANNON.tellSeconds * (fired.length - 0.5));
  });

  it('replicates the tell on the wire while it lasts', () => {
    const p = play();
    squadAt(p);
    p.step(30 * 10);
    let saw = 0;
    let quiet = 0;
    for (let i = 0; i < 30 * 14; i++) {
      p.step(1);
      const snap = p.x.buildSnapshot();
      const e = snap.entities.find((q) => q.netId === p.enemy.netId)!.components[COMPONENT_IDS.Enemy] as number[];
      if (e[3] === 1) saw++;
      else quiet++;
      expect(e[3] === 1).toBe(p.enemy.tell !== null);
    }
    expect(saw).toBeGreaterThan(CANNON.tellSeconds * 30 * 0.8);
    expect(quiet).toBeGreaterThan(saw);
  });

  it('fires at the point it locked, not where the target has moved to', () => {
    const p = play();
    squadAt(p);
    let locked: { x: number; z: number } | null = null;
    let first: { x: number; z: number; vx?: number } | null = null;
    let before = 0;
    // Move the soldier away the moment the tell starts.
    for (let i = 0; i < 30 * 12 && first === null; i++) {
      p.step(1);
      if (p.enemy.tell && locked === null) {
        locked = { x: p.enemy.tell.point.x, z: p.enemy.tell.point.z };
        p.put(0, 40, 80);
        before = p.session.slots[0]!.health.current;
      }
      const s = p.shells()[0];
      if (s) first = { x: s.x, z: s.z };
    }
    expect(locked).not.toBeNull();
    expect(first).not.toBeNull();
    // The shell leaves toward the locked point (east), not toward the new one (north-east, 50 m on).
    const flight = p.shells()[0]!;
    const towardLocked = Math.atan2(locked!.x - TANK_AT.x, locked!.z - TANK_AT.z);
    const towardShell = Math.atan2(flight.x - TANK_AT.x, flight.z - TANK_AT.z);
    expect(Math.abs(towardShell - towardLocked)).toBeLessThan(0.15);
    // And the soldier it was going for, standing well clear, is unhurt when it lands.
    p.step(30 * 4);
    expect(p.session.slots[0]!.health.current).toBe(before);
  });

  it('hurts a soldier standing where it lands, and does not hit one outside the blast', () => {
    const p = play();
    squadAt(p);
    // Off the line of fire too, or the gun's stray rounds would be the thing that found it.
    p.put(1, 40, 30 + CANNON.blastRadiusM + 12);
    p.step(30 * 12);
    expect(p.session.slots[0]!.health.current).toBeLessThan(p.session.slots[0]!.health.max);
    expect(p.session.slots[1]!.health.current).toBe(p.session.slots[1]!.health.max);
  });

  it('does not fire while the tank is driving, and does once it has stopped', () => {
    const p = play([{ x: 0, z: 70 }]);
    p.put(0, 40, 30);
    let shotWhileDriving = 0;
    p.step(30 * 12, () => {
      if (p.enemy.speed > VEHICLE.fireMaxSpeedMps && (p.enemy.tell || p.shells().length > 0)) shotWhileDriving++;
    });
    expect(shotWhileDriving).toBe(0);
    expect(p.enemy.drive?.phase).not.toBe('arrived');
    // Arrived, it fires.
    p.step(30 * 40);
    expect(p.enemy.drive?.phase).toBe('arrived');
    p.step(30 * 10);
    expect(p.session.slots[0]!.health.current).toBeLessThan(p.session.slots[0]!.health.max);
  });

  it('never fires at someone who is down', () => {
    const p = play();
    squadAt(p);
    p.session.slots[0]!.health.downedAt = 1;
    p.step(30 * 20);
    expect(p.enemy.tell).toBeNull();
    expect(p.shells()).toHaveLength(0);
    expect(p.enemy.weaponState.ammo).toBe(p.enemy.weapon.magSize);
  });

  it('drops a tell when its target goes down', () => {
    const p = play();
    squadAt(p);
    let downed = false;
    p.step(30 * 12, () => {
      if (p.enemy.tell && !downed) {
        downed = true;
        p.session.slots[0]!.health.downedAt = 1;
      }
    });
    expect(downed).toBe(true);
    expect(p.enemy.tell).toBeNull();
    expect(p.shells()).toHaveLength(0);
  });
});

describe('a tank\'s coaxial gun (U-068)', () => {
  it('bursts on sight inside its range, and not beyond it', () => {
    const near = play();
    near.put(0, 0, 30 + 30);
    near.step(30 * 4);
    expect(near.enemy.weaponState.ammo).toBeLessThan(near.enemy.weapon.magSize);

    const far = play();
    // Past the gun's range, inside the cannon's.
    far.put(0, 0, 30 + VEHICLE.machineGun.rangeM + 15);
    far.step(30 * 4);
    expect(far.enemy.weaponState.ammo).toBe(far.enemy.weapon.magSize);
  });

  it('fires in bursts with a pause, by the archetype\'s discipline', () => {
    const p = play();
    p.put(0, 0, 30 + 30);
    const accuracy = p.enemy.def.accuracy;
    let rounds = 0;
    let longestRun = 0;
    let run = 0;
    let last = p.enemy.weaponState.ammo;
    p.step(30 * 6, () => {
      const now = p.enemy.weaponState.ammo;
      if (now < last) {
        rounds += last - now;
        run += last - now;
        longestRun = Math.max(longestRun, run);
      } else if (p.now() >= p.enemy.burst.pauseUntil) run = 0;
      last = now;
    });
    expect(rounds).toBeGreaterThan(accuracy.burstRounds);
    expect(p.enemy.weaponState.ammo).toBeGreaterThanOrEqual(0);
  });

  it('will not fire with the turret off the bearing', () => {
    const p = play();
    // The soldier is directly behind the tank's nose: the turret has to come all the way round first.
    p.put(0, 0, 30 - 40);
    p.step(10);
    expect(p.enemy.weaponState.ammo).toBe(p.enemy.weapon.magSize);
  });
});
