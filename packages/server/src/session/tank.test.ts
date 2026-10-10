/**
 * U-066: the tank as an enemy entity — its body is a hull and a turret (shots name the part they hit, from the front,
 * the side and above), its armour turns bullets and most blasts away but not rockets, C4 or claymores, a dead one is
 * a wreck that stays, and its turret yaw rides the wire apart from its hull's.
 */
import { describe, expect, it } from 'vitest';
import { BitReader, BitWriter, COMPONENT_IDS, ENEMY_IDS, PROJECTILE_IDS, type WorldSnapshot, createWeaponState, getEnemy, getWeapon, readDelta, readSnapshot, tryFire, writeDelta, writeSnapshot } from '@sandline/shared';
import { HitboxHistory, resolveShot, vehicleHitbox } from '../net/lagComp.ts';
import { Session } from './Session.ts';

const TANK = getEnemy('tank');
const VEHICLE = TANK.vehicle!;
const TANK_INDEX = ENEMY_IDS.indexOf('tank');

const decodeFull = (w: WorldSnapshot): WorldSnapshot => {
  const out = new BitWriter();
  writeSnapshot(out, w);
  return readSnapshot(new BitReader(out.toUint8Array()));
};
const decodeDelta = (cur: WorldSnapshot, base: WorldSnapshot): WorldSnapshot => {
  const out = new BitWriter();
  writeDelta(out, cur, base);
  return readDelta(new BitReader(out.toUint8Array()), base);
};

interface Internals {
  detonate(projectile: unknown, at: { x: number; y: number; z: number }): void;
  traceShot(shooter: number, weapon: unknown, shot: unknown, tick: number, origin: { x: number; y: number; z: number }, yaw: number, pitch: number, renderTimeMs: number): void;
  hitboxes: HitboxHistory;
  nowMs: number;
}

function place() {
  const session = new Session(undefined, '', 'range', { roomLobby: true });
  const x = session as unknown as Internals;
  const id = session.spawnEnemy('tank', { x: 0, y: 0, z: 30, yaw: 0 }) as number;
  const enemy = session.enemies.find((e) => e.netId === id)!;
  return { session, x, id, enemy };
}

const rocket = (session: Session) => {
  const kind = PROJECTILE_IDS.indexOf('rocket');
  return { kind, def: session.projectileDef(kind)!, ownerNetId: session.slots[0]!.netId, ownerSlot: 0, xpPlayerId: null, netId: 1, state: { x: 0, y: 1, z: 30, vx: 0, vy: 0, vz: 0, age: 0, bounces: 0, resting: false } };
};
const projectile = (session: Session, id: string) => {
  const kind = PROJECTILE_IDS.indexOf(id as (typeof PROJECTILE_IDS)[number]);
  return { ...rocket(session), kind, def: session.projectileDef(kind)! };
};

describe('the tank row (U-066)', () => {
  it('is 1000 health, never downed, a wreck that stays, and armoured as the owner said', () => {
    expect(TANK).toMatchObject({ health: 1000, downable: false });
    expect(TANK.corpseSeconds).toBeGreaterThanOrEqual(300);
    expect(VEHICLE.armour.bullet).toBeCloseTo(0.1);
    for (const id of ['rocket', 'c4', 'claymore']) expect(VEHICLE.armour.blast[id]).toBe(1);
    expect(VEHICLE.armour.blast['frag']).toBeCloseTo(0.1);
  });
});

describe('the tank\'s body (U-066)', () => {
  const history = () => {
    const h = new HitboxHistory();
    h.record(9, 0, 0, 0, 30, false, false, { yaw: 0 });
    h.setShape(9, vehicleHitbox(VEHICLE));
    return h;
  };
  const shoot = (h: HitboxHistory, origin: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }) =>
    resolveShot(h, { shooterNetId: 1, ray: { origin, direction, maxDistance: 100 }, nowMs: 0, clientRenderTimeMs: 0 }, undefined, []);

  it('is hit on the hull from the front, from the side, and on the turret from above', () => {
    const h = history();
    // Front: level with the hull, straight down the road.
    expect(shoot(h, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 })).toMatchObject({ netId: 9, part: 'hull' });
    // Side: the hull is 2.6 m wide and 5.8 m long; a shot from the right at its middle hits it.
    expect(shoot(h, { x: -20, y: 1, z: 30 }, { x: 1, y: 0, z: 0 })).toMatchObject({ netId: 9, part: 'hull' });
    // The turret sits above the hull: a shot at its height hits it and not the hull.
    expect(shoot(h, { x: -20, y: 2.6, z: 30 }, { x: 1, y: 0, z: 0 })).toMatchObject({ netId: 9, part: 'turret' });
    // Over the top, and wide of it, miss.
    expect(shoot(h, { x: -20, y: 5, z: 30 }, { x: 1, y: 0, z: 0 })).toBeNull();
    expect(shoot(h, { x: -20, y: 1, z: 36 }, { x: 1, y: 0, z: 0 })).toBeNull();
  });

  it('turns with the hull: a tank facing east is long on the x axis', () => {
    const h = new HitboxHistory();
    h.record(9, 0, 0, 0, 30, false, false, { yaw: 256 });
    h.setShape(9, vehicleHitbox(VEHICLE));
    // Its hull now runs east-west: a shot 2.5 m to the north along z at x=2.5 would hit only if it were long on x.
    expect(shoot(h, { x: 2.8, y: 1, z: 20 }, { x: 0, y: 0, z: 1 })).toMatchObject({ netId: 9, part: 'hull' });
    expect(shoot(h, { x: 0, y: 1, z: 20 }, { x: 0, y: 0, z: 1 })).toMatchObject({ netId: 9, part: 'hull' });
    expect(shoot(h, { x: 2.8, y: 1, z: 20 }, { x: 0, y: 0, z: 1 })).not.toBeNull();
  });

  it('a soldier has no part and is shot as before', () => {
    const h = new HitboxHistory();
    h.record(3, 0, 0, 0, 30);
    const hit = shoot(h, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(hit?.netId).toBe(3);
    expect(hit).not.toHaveProperty('part');
  });
});

describe('the tank\'s armour (U-066)', () => {
  it('takes a tenth of a bullet', () => {
    const { session, x, id, enemy } = place();
    x.hitboxes.record(id, x.nowMs, 0, 0, 30, false, false, { yaw: 0 });
    const weapon = getWeapon('carbine');
    const state = createWeaponState(weapon);
    const shot = tryFire(weapon, state, 100, false, false, 0)!;
    const before = enemy.health.current;
    // From 10 m down the road, level with the hull, straight at it.
    x.traceShot(session.slots[0]!.netId, weapon, shot, 1, { x: 0, y: 1, z: 20 }, 0, 0, x.nowMs);
    const lost = before - enemy.health.current;
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThan(weapon.damage * 0.2);
  });

  it('takes a rocket, C4 and a claymore in full, and a frag at a tenth; a concussion does nothing', () => {
    const cases: [string, number][] = [['rocket', 170], ['c4', 250], ['claymore', 150], ['frag', 13], ['concussion', 0]];
    for (const [name, expected] of cases) {
      const { session, x, enemy } = place();
      // Against the hull, a metre and a half from its middle.
      x.detonate(projectile(session, name), { x: 1.5, y: 1, z: 30 });
      expect(enemy.health.max - enemy.health.current, name).toBeCloseTo(expected, 0);
    }
  });

  it('six rockets kill it, and four C4 (the owner\'s numbers)', () => {
    for (const [name, expected] of [['rocket', 6], ['c4', 4]] as const) {
      const { session, x, enemy } = place();
      let n = 0;
      while (enemy.health.current > 0 && n < 30) {
        x.detonate(projectile(session, name), { x: 1.5, y: 1, z: 30 });
        n++;
      }
      expect(n, name).toBe(expected);
    }
  });
});

describe('the tank is an enemy entity (U-066)', () => {
  it('dies into a wreck that stays for minutes, not seconds', () => {
    const { session, x, enemy } = place();
    for (let i = 0; i < 30 && enemy.health.current > 0; i++) x.detonate(projectile(session, 'c4'), { x: 1.5, y: 1, z: 30 });
    expect(enemy.health.current).toBe(0);
    expect(enemy.health.diedAt).not.toBeNull();
    expect(session.enemies).toContain(enemy);
    expect(enemy.def.corpseSeconds).toBeGreaterThanOrEqual(300);
  });

  it('puts its turret yaw on the wire apart from its hull yaw, and changes only it when the turret turns', () => {
    const { session, id, enemy } = place();
    enemy.yaw = 100;
    enemy.turretYaw = 700;
    const snap = () => (session as unknown as { buildSnapshot(): WorldSnapshot }).buildSnapshot();
    const tank = (w: WorldSnapshot) => w.entities.find((e) => e.netId === id)!;
    const first = decodeFull(snap());
    expect(tank(first).components[COMPONENT_IDS.Enemy]).toEqual([TANK_INDEX, 0, 700, 0, 0]);
    expect(tank(first).components[COMPONENT_IDS.Transform]?.[3]).toBe(100);
    // A soldier's third field is 0, whatever its facing.
    const rifleman = session.spawnEnemy('rifleman', { x: 4, y: 0, z: 30, yaw: 300 }) as number;
    expect(snap().entities.find((e) => e.netId === rifleman)!.components[COMPONENT_IDS.Enemy]).toEqual([0, 0, 0, 0, 0]);
    // Turning the turret changes the Enemy component only, and a delta carries it.
    enemy.turretYaw = 123;
    const next = snap();
    const delta = decodeDelta(next, first);
    expect(tank(delta).components[COMPONENT_IDS.Enemy]).toEqual([TANK_INDEX, 0, 123, 0, 0]);
    expect(tank(delta).components[COMPONENT_IDS.Transform]?.[3]).toBe(100);
  });
});
