/** U-222: real Session prisoners, freed squad captives and the escorted POW
 * under ordinary tank shells in the furnished outpost. Shells fly through
 * Session.fireShell/stepProjectiles and go off through Session.detonate with
 * the tank's own cannon numbers; actors keep their ordinary health, with no
 * immunity flag, scripted miss or special volume. The below-stair route is
 * walked on the standing nav in qalatOutpostTraversal. */
import { describe, expect, it } from 'vitest';
import { DAMAGE, PROJECTILE_IDS, TICK_SECONDS, blastDamageOn, blastExposure, getEnemy, type ProjectileDef, type WorldBox } from '@sandline/shared';
import { DEFAULT_HITBOX } from '../../../server/src/net/lagComp.ts';
import { Session } from '../../../server/src/session/Session.ts';
import { buildOutpostWorld } from './qalatOutpost.ts';

type Point = { x: number; y: number; z: number };
type Actor = { state: Point & { crouched: boolean; prone: boolean }; health: { current: number; max: number; downedAt: number | null; diedAt: number | null; immuneUntil?: number } };
const p = (x: number, y: number, z: number): Point => ({ x, y, z });
const STANDING = 2 * (DEFAULT_HITBOX.halfHeight + DEFAULT_HITBOX.radius);
const full = buildOutpostWorld();
// Every solid between the tank road (X1..A7), the three gate approaches and
// the shelters, at every elevation. Nothing on a tested flight is dropped.
const inRegion = (b: WorldBox) => b.maxX >= -30 && b.minX <= 125 && b.maxZ >= 290 && b.minZ <= 460;
const region = full.boxes.filter(inRegion);

// Independent §8.1/§9/§10.3/§11.2 transcription.
const POW_CELL = p(16, 8, 402), REFUGE_HOLD = p(16, 8, 380), STAIR_HOLD = p(-8, 0, 370);
const HOLDINGS = [p(12, 8, 400), p(20, 8, 400), p(12, 8, 404), p(20, 8, 404), p(12, 8, 408)];
const COURT_LEG = p(26, 8, 388); // §10.3's escort leg crosses the open court here.
const ROUTE: [string, Point][] = [['X1', p(114, 8, 432)], ['X2', p(112, 8, 386)], ['X3', p(104, 8, 350)], ['X4', p(84, 8, 338)],
  ['X4-X5', p(70, 8, 336)], ['X5', p(54, 8, 334)], ['X5-X6', p(35, 8, 333)], ['X6/A8', p(16, 8, 332)], ['A7', p(-18, 8, 302)]];
// The three infantry gate approaches. The tank never drives there; a fixture
// turret there tests the shelters against shells from those lanes too.
const APPROACHES: [string, Point][] = [['forecourt', p(32, 8, 346)], ['east pad', p(60, 8, 374)], ['west pad', p(3, 8, 375)]];
const cannonOf = (session: Session) => {
  const cannon = getEnemy('tank').vehicle!.cannon, base = session.projectileDef(PROJECTILE_IDS.indexOf('rocket'))!;
  expect(cannon.projectile).toBe('rocket');
  return { ...base, speedMPerSec: cannon.speedMPerSec, blastDamage: cannon.blastDamage, blastRadiusM: cannon.blastRadiusM } as ProjectileDef;
};

interface Internals {
  fireShell(enemy: unknown, vehicle: unknown, at: Point): void;
  detonate(projectile: unknown, at: Point): void;
  projectiles: unknown[];
}

/** One Session: five squad characters taken prisoner at the cell holdings and
 * freed there by the ordinary rescue path, the POW, slot 0 as an open-court
 * control and an inactive tank whose turret is laid by the test. */
function fixture(boxes: readonly WorldBox[], pow: Point, captive: boolean, control: Point = COURT_LEG) {
  const session = new Session(undefined, '', { ...full, boxes: [...boxes],
    squadStarts: [control, ...HOLDINGS].map((h) => ({ ...h })) }, { testHumanCount: 0 });
  const x = session as unknown as Internals;
  const blasts: Point[] = [];
  const detonate = x.detonate.bind(x);
  x.detonate = (projectile, at) => { blasts.push({ ...at }); detonate(projectile, at); };
  HOLDINGS.forEach((h, i) => {
    expect(session.captureCharacter(i + 1, h)).toBe(true);
    // A held prisoner is out of play (U-061), not sheltered: rescue makes
    // them an ordinary damageable soldier standing at the holding.
    expect(session.slots[i + 1]!.captured).toBe(true);
    expect(session.freeCharacter(i + 1)).toBe(true);
    expect(session.slots[i + 1]!.state).toMatchObject(h);
  });
  expect(session.spawnEnemy('pow', { ...pow, captive, inactive: true, authoredHeight: true })).not.toBeNull();
  const tankId = session.spawnEnemy('tank', { ...ROUTE[0]![1], inactive: true, authoredHeight: true })!;
  const tank = session.enemies.find((e) => e.netId === tankId)!, powEntity = session.enemies.find((e) => e.def.friendly)!;
  const actors: [string, Actor, Point][] = [['control', session.slots[0]!, { ...control }],
    ...HOLDINGS.map((h, i) => [`carry-${i + 1}`, session.slots[i + 1]!, { ...h }] as [string, Actor, Point]), ['pow', powEntity, { ...pow }]];
  // Rescue grants the ordinary respawn protection; let it run out so no
  // shot below can pass because a freed captive was briefly immune.
  for (let tick = 0; tick * TICK_SECONDS < DAMAGE.respawnImmunitySeconds + .5; tick++) session.step((session.tick + 1) * TICK_SECONDS * 1000);
  const reset = () => {
    for (const [id, actor, at] of actors) {
      expect(actor.health.immuneUntil ?? -Infinity, `${id} protected`).toBeLessThan(session.tick * TICK_SECONDS);
      Object.assign(actor.state, at, { crouched: false, prone: false });
      Object.assign(actor.health, { current: actor.health.max, downedAt: null, diedAt: null });
    }
  };
  /** Lay the turret on `aim` from `origin` and let the ordinary shell fly to its end. */
  const shoot = (origin: Point, aim: Point) => {
    reset();
    Object.assign(tank.state, origin);
    tank.turretYaw = Math.round(Math.atan2(aim.x - origin.x, aim.z - origin.z) / (2 * Math.PI) * 1024 + 1024) % 1024;
    blasts.length = 0;
    x.fireShell(tank, tank.def.vehicle!, aim);
    expect(x.projectiles).toHaveLength(1);
    for (let tick = 0; tick < 400 && x.projectiles.length > 0; tick++) session.step((session.tick + 1) * TICK_SECONDS * 1000);
    expect(x.projectiles, 'shell still in flight').toHaveLength(0);
    expect(blasts, 'one shell, one blast').toHaveLength(1);
    const damage = new Map(actors.map(([id, actor]) => [id, actor.health.max - actor.health.current]));
    return { blast: blasts[0]!, damage };
  };
  const cannon = cannonOf(session);
  /** The tank's own shell going off at `at` through Session.detonate. */
  const burst = (at: Point) => {
    reset();
    x.detonate({ netId: 65000, kind: PROJECTILE_IDS.indexOf('rocket'), def: cannon, ownerSlot: 7, ownerNetId: tank.netId, xpPlayerId: null,
      state: { ...at, vx: 0, vy: 0, vz: 0, age: 0, bounces: 0, resting: false } }, at);
    return new Map(actors.map(([id, actor]) => [id, actor.health.max - actor.health.current]));
  };
  return { session, actors, shoot, burst, cannon, pow: powEntity };
}

describe('U-222 actual captive and escort shelters under ordinary tank shells', () => {
  it('lets no shell from the tank road or a gate approach reach a sheltered actor unattenuated', () => {
    const outcomes: Record<string, number> = { obstructed: 0, attenuated: 0 };
    let shots = 0;
    for (const [hold, pow, captive, sheltered] of [['cell', POW_CELL, true, ['pow', ...HOLDINGS.map((_, i) => `carry-${i + 1}`)]],
      ['refuge', REFUGE_HOLD, false, ['pow']], ['below west stair', STAIR_HOLD, false, ['pow']]] as const) {
      const f = fixture(region, pow, captive);
      for (const [label, origin] of [...ROUTE, ...APPROACHES]) for (const [id, actor] of f.actors.filter(([id]) => (sheltered as readonly string[]).includes(id))) {
        const aim = { x: actor.state.x, y: actor.state.y + STANDING / 2, z: actor.state.z };
        const { blast, damage } = f.shoot(origin, aim);
        shots++;
        for (const target of sheltered) {
          const [, body, feet] = f.actors.find(([other]) => other === target)!;
          const taken = damage.get(target)!;
          expect(body.health.current, `${hold}: ${label} killed ${target}`).toBeGreaterThan(0);
          if (taken === 0) continue;
          // Any harm must come through the shelter: none of the actor is
          // visible from the blast, and it takes exactly the cover fraction.
          expect(blastExposure(blast, feet, STANDING, region), `${hold}: ${label}→${id} exposes ${target}`).toBe(0);
          expect(taken).toBeCloseTo(blastDamageOn(f.cannon, blast, feet, STANDING, region), 6);
          outcomes.attenuated!++;
        }
        if ([...damage.entries()].every(([target, d]) => !(sheltered as readonly string[]).includes(target) || d === 0)) outcomes.obstructed!++;
      }
    }
    expect(shots).toBe(12 * (6 + 1 + 1));
    console.log('U-222 sheltered shell matrix', JSON.stringify({ shots, origins: ROUTE.length + APPROACHES.length, ...outcomes }));
  }, 600_000);

  it('cuts real shells on the cell and refuge walls to the cover fraction; the same blast without that wall, and in the open court, hurts fully', () => {
    // X5–X6 is on the tank's own road: its shell enters the court through the
    // south arch to the cell wall beside carry-2. The forecourt lane reaches
    // the wall beside carry-4; the east-pad lane the refuge's south wall
    // beside an escort waiting inside it.
    const cell = (b: WorldBox) => b.id.startsWith('outpost-cell-walls') && b.minX >= 22 - 1e-6;
    const refuge = (b: WorldBox) => b.id.startsWith('outpost-refuge-walls') && b.maxZ <= 376 + 1e-6;
    const ESCORT = p(17, 8, 377.4);
    const cases = [
      { from: 'X5-X6', origin: ROUTE.find(([id]) => id === 'X5-X6')![1], aim: p(22.7, 9.5, 400), wall: cell, axis: 'x', face: 22.6, out: 1, id: 'carry-2', feet: HOLDINGS[1]!, pow: POW_CELL, captive: true },
      { from: 'forecourt', origin: APPROACHES[0]![1], aim: p(22.7, 9.5, 404), wall: cell, axis: 'x', face: 22.6, out: 1, id: 'carry-4', feet: HOLDINGS[3]!, pow: POW_CELL, captive: true },
      { from: 'east pad', origin: APPROACHES[1]![1], aim: p(17, 9.5, 375.3), wall: refuge, axis: 'z', face: 375.4, out: -1, id: 'pow', feet: ESCORT, pow: ESCORT, captive: false },
    ] as const;
    for (const c of cases) {
      const withoutWall = region.filter((b) => !c.wall(b));
      expect(region.length - withoutWall.length, `${c.from}: named wall`).toBeGreaterThan(0);
      const sheltered = fixture(region, c.pow, c.captive);
      const shot = sheltered.shoot(c.origin, c.aim);
      expect(shot.blast[c.axis], `${c.from}: the shell must strike the wall's outer face`).toBeCloseTo(c.face, 6);
      const taken = shot.damage.get(c.id)!;
      expect(taken, `${c.id} beyond the blast`).toBeGreaterThan(0);
      expect(blastExposure(shot.blast, c.feet, STANDING, region)).toBe(0);
      // Same blast point and body, only the named wall removed.
      expect(blastExposure(shot.blast, c.feet, STANDING, withoutWall)).toBe(1);
      const open = blastDamageOn(sheltered.cannon, shot.blast, c.feet, STANDING, withoutWall);
      expect(taken).toBeCloseTo(open * sheltered.cannon.blastCoverFraction, 6);
      // An open-court soldier mirrored across the wall plane: the same range,
      // on the side the blast can see. A flown shell goes off exactly on the
      // wall face, where U-166's open boundary counts every probe as covered,
      // so the court control takes the same tank shell 1 mm off that face.
      const control = { ...c.feet, [c.axis]: 2 * shot.blast[c.axis] - c.feet[c.axis] } as Point;
      const off = { ...shot.blast, [c.axis]: shot.blast[c.axis] + c.out * .001 } as Point;
      const court = fixture(region, c.pow, c.captive, control).burst(off);
      expect(blastExposure(off, control, STANDING, region)).toBe(1);
      expect(blastExposure(off, c.feet, STANDING, region)).toBe(0);
      expect(court.get(c.id)!).toBeCloseTo(taken, 1);
      expect(court.get('control')!).toBeGreaterThan(taken * 3);
      console.log('U-222 wall blast', JSON.stringify({ from: c.from, blast: shot.blast, sheltered: c.id, damage: taken,
        sameBlastWithoutWall: open, openCourtSameRange: court.get('control') }));
    }
  }, 120_000);

  it('hurts the same escorted POW ordinarily once it stands in the open court on its escort leg', () => {
    const f = fixture(region, COURT_LEG, false, STAIR_HOLD);
    let worst = 0, from = '';
    for (const [label, origin] of [...ROUTE, ...APPROACHES]) {
      const { damage } = f.shoot(origin, { ...COURT_LEG, y: COURT_LEG.y + STANDING / 2 });
      if (damage.get('pow')! > worst) { worst = damage.get('pow')!; from = label; }
    }
    expect(worst, 'no ordinary shell reached the POW in the open court').toBeGreaterThan(50);
    console.log('U-222 open-court escort control', JSON.stringify({ from, damage: worst }));
  }, 300_000);
});
