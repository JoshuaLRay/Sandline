import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, ENEMIES, TICK_SECONDS, applyDamage, blastDamageOn, blastExposure, blockedAt,
  createHealth, createMoveState, createProjectileState, getProjectile, stepCharacter, stepProjectile, supportUnder,
  type ProjectileDef, type WorldBox,
} from '@sandline/shared';
import { LAUNCH_AHEAD_M, throwEye, throwLaunch } from '../../../server/src/ai/throw.ts';
import { DEFAULT_HITBOX, bodyParts, rayBody, vehicleHitbox } from '../../../server/src/net/lagComp.ts';
import { buildRoadSupportWorld, tankReturnRoute } from './qalatRoadSupports.ts';
import { certifyTankRoute } from './qalatTankSweep.ts';

type Point = { x: number; y: number; z: number };
const world = buildRoadSupportWorld();
const projectileWorld = { boxes: world.boxes, groundY: DEFAULT_MOVE_CONFIG.groundY };
const rocket = getProjectile('rocket'), tank = ENEMIES['tank']!.vehicle!;
const cannon: ProjectileDef = { ...rocket, speedMPerSec: tank.cannon.speedMPerSec,
  blastDamage: tank.cannon.blastDamage, blastRadiusM: tank.cannon.blastRadiusM };
const standingHeight = 2 * (DEFAULT_HITBOX.halfHeight + DEFAULT_HITBOX.radius);

// Independent §6.2/§6.3/§11.2 positions. The C12-U choice is its U1 four-by-
// four waypoint pad, not R5: the higher pads' side rock blocks a direct A5 shot.
// A8 shares X6's exact tank-route socket. V3 certifies the valid A8 firing
// choice; X5 retains its inherited standing-eye silhouette proof. A finite
// stance/aim search did not certify a V3→X5 rocket, and proves no impossibility.
const shots = [
  { choice: 'V3→A8', feet: { x: 66, y: 26, z: 286 }, targetId: 'X6', target: { x: 16, y: 8, z: 332 },
    tankYaw: 759, yaw: 3557, pitch: 3961 },
  { choice: 'C12-U/U1→A5', feet: { x: 40, y: 8, z: 218 }, targetId: 'A5', target: { x: 26, y: 8, z: 232 },
    tankYaw: 529, yaw: 3584, pitch: 28 },
];

function supportedStandingActor(feet: Point) {
  expect(standingHeight).toBe(DEFAULT_MOVE_CONFIG.height);
  expect(supportUnder(feet.x, feet.z, DEFAULT_MOVE_CONFIG.radius, feet.y + .45, world.boxes, 0)).toBe(feet.y);
  expect(blockedAt(feet.x, feet.z, DEFAULT_MOVE_CONFIG.radius, feet.y, 0, standingHeight, world.boxes)).toBe(false);
  let actor = { ...createMoveState(feet.x, feet.y, feet.z), grounded: true };
  for (let tick = 0; tick < 3; tick++) actor = stepCharacter(actor,
    { moveX: 0, moveY: 0, yaw: 0, sprint: false, jump: false, crouch: false, prone: false },
    TICK_SECONDS, DEFAULT_MOVE_CONFIG, world.boxes);
  expect(actor).toMatchObject({ ...feet, grounded: true, crouched: false, prone: false, vault: null });
  expect(bodyParts(DEFAULT_HITBOX, 'standing', actor, 0).length).toBeGreaterThan(0);
  return actor;
}

function damageActor(def: ProjectileDef, centre: Point, feet: Point, boxes: readonly WorldBox[]) {
  const health = createHealth(), before = health.current;
  const raw = blastDamageOn(def, centre, feet, standingHeight, boxes);
  const result = applyDamage(health, raw, 1);
  expect(health.immuneUntil).toBeUndefined();
  expect(health.current).toBeCloseTo(before - result.applied, 8);
  return { health, raw, applied: result.applied };
}

/** Session.detonate measures a tank blast from the nearest hull skin, then
 * applies the ordinary projectile armour row and enemy health rules. */
function damageTank(centre: Point, target: Point) {
  const height = 2 * tank.hull.radius + .6;
  const hullCentre = { ...target, y: target.y + tank.hull.from[1] };
  const delta = { x: centre.x - hullCentre.x, y: centre.y - hullCentre.y, z: centre.z - hullCentre.z };
  const distance = Math.hypot(delta.x, delta.y, delta.z);
  const scale = distance <= 1e-6 ? 0 : Math.min(distance, tank.radiusM) / distance;
  const feet = { x: hullCentre.x + delta.x * scale,
    y: hullCentre.y + delta.y * scale - height / 2, z: hullCentre.z + delta.z * scale };
  const raw = blastDamageOn(rocket, centre, feet, height, world.boxes);
  const armourDamage = raw * (tank.armour.blast['rocket'] ?? tank.armour.blastDefault);
  const health = { ...createHealth(), current: ENEMIES['tank']!.health, max: ENEMIES['tank']!.health };
  const result = applyDamage(health, armourDamage, 1, undefined, ENEMIES['tank']!.downable);
  expect(health.immuneUntil).toBeUndefined();
  expect(result.applied).toBeGreaterThan(0);
  expect(health.current).toBeCloseTo(health.max - armourDamage, 8);
  return result.applied;
}

describe('U-169 integrated ridge return rocket and actor blast rules', () => {
  it('places every target on the complete certified tank return route with real hull/turret support', () => {
    const route = tankReturnRoute(), proof = certifyTankRoute(world.boxes, route);
    expect(proof).toMatchObject({ allHullAndTurretYaws: true, endpointsAndStops: true, floorY: 8 });
    for (const shot of shots) expect(route.find((point) => point.id === shot.targetId), shot.choice)
      .toMatchObject({ id: shot.targetId, ...shot.target });
  }, 60_000);

  it('launches ordinary rockets from supported V3 and C12-U actors into the actual tank capsules', () => {
    const report: Record<string, unknown>[] = [];
    for (const shot of shots) {
      const actor = supportedStandingActor(shot.feet), eye = throwEye(actor);
      const launch = throwLaunch(rocket, eye, shot.yaw, shot.pitch, projectileWorld);
      expect(Math.hypot(launch.origin.x - eye.x, launch.origin.y - eye.y, launch.origin.z - eye.z),
        `${shot.choice} muzzle was clamped by scenery`).toBeCloseTo(LAUNCH_AHEAD_M, 8);
      expect(blockedAt(launch.origin.x, launch.origin.z, rocket.radiusM, launch.origin.y - rocket.radiusM,
        0, 2 * rocket.radiusM, world.boxes), `${shot.choice} occupied launch sphere`).toBe(false);
      const parts = bodyParts(vehicleHitbox(tank), 'standing', shot.target, shot.tankYaw);
      let state = createProjectileState(launch.origin, launch.velocity), hitPart: string | null = null;
      let hitTick = -1, frameCrossings = 0, tankDamage = 0;
      for (let tick = 0; tick < Math.ceil(rocket.maxLifeSeconds / TICK_SECONDS); tick++) {
        const step = stepProjectile(rocket, state, TICK_SECONDS, projectileWorld);
        state = step.state;
        const delta = { x: step.to.x - step.from.x, y: step.to.y - step.from.y, z: step.to.z - step.from.z };
        const length = Math.hypot(delta.x, delta.y, delta.z);
        if (shot.choice === 'V3→A8') for (const planeX of [65.45, 65.2]) {
          if (step.from.x <= planeX || step.to.x > planeX) continue;
          const fraction = (planeX - step.from.x) / delta.x;
          const y = step.from.y + delta.y * fraction, z = step.from.z + delta.z * fraction;
          // Independent §6.2 front-strip bounds at this trajectory's stratum:
          // y27 lip / y27.7 canopy, 0.25 m depth, z282..287. The actual
          // swept-world check additionally includes the inflated edge corners.
          expect(z, shot.choice).toBeGreaterThan(282 + rocket.radiusM);
          expect(z, shot.choice).toBeLessThan(287 - rocket.radiusM);
          expect(y, shot.choice).toBeGreaterThan(27 + rocket.radiusM);
          expect(y, shot.choice).toBeLessThan(27.7 - rocket.radiusM);
          frameCrossings++;
        }
        // Session.bodyAlong uses these present-day capsules on the chord
        // already truncated by swept radius against every real solid.
        const hit = length > 0 ? rayBody({ origin: step.from, direction: {
          x: delta.x / length, y: delta.y / length, z: delta.z / length,
        }, maxDistance: length }, parts) : null;
        if (hit) {
          hitPart = hit.part.part!; hitTick = tick;
          tankDamage = damageTank({ x: step.from.x + delta.x / length * hit.distance,
            y: step.from.y + delta.y / length * hit.distance, z: step.from.z + delta.z / length * hit.distance }, shot.target);
          break;
        }
        expect(step.detonation, `${shot.choice} hit ${step.impact?.box?.id ?? 'ground/lifetime'} first`).toBeNull();
      }
      expect(hitTick, `${shot.choice} immediate or missing tank contact`).toBeGreaterThan(2);
      expect(['hull', 'turret'], `${shot.choice} never reached tank`).toContain(hitPart);
      if (shot.choice === 'V3→A8') expect(frameCrossings).toBe(2);
      else expect(actor).toMatchObject({ x: 40, y: 8, z: 218 });
      report.push({ choice: shot.choice, feet: shot.feet, yaw: shot.yaw, pitch: shot.pitch, hitPart, hitTick, tankDamage });
    }
    console.log('U-169 real ridge rocket flights', JSON.stringify({ report,
      radiusM: rocket.radiusM, gravity: rocket.gravity, rules: 'ordinary throwLaunch/stepProjectile, tank rayBody and blast/armour/health',
      uncertified: 'V3→X5 rocket: finite stance/aim search found no clear shot; inherited eye silhouette remains proven' }));
  }, 60_000);

  it('keeps ordinary exposed blast danger at each standing launch choice', () => {
    for (const shot of shots) {
      const actor = supportedStandingActor(shot.feet);
      const centre = { x: actor.x + 1.5, y: actor.y + standingHeight / 2, z: actor.z };
      expect(blockedAt(centre.x, centre.z, .01, centre.y, 0, .01, world.boxes), shot.choice).toBe(false);
      expect(blastExposure(centre, actor, standingHeight, world.boxes), shot.choice).toBe(1);
      const damage = damageActor(cannon, centre, actor, world.boxes);
      expect(damage.applied, shot.choice).toBeGreaterThan(50);
      expect(damage.health.current).toBeLessThan(damage.health.max);
    }
  });

  it('uses all three built bay canopies to attenuate damage to real standing actors without immunity', () => {
    const report: Record<string, unknown>[] = [];
    for (const bay of [{ id: 'V1', x: 58, y: 20, z: 128 },
      { id: 'V2', x: 88, y: 30, z: 210 }, { id: 'V3', x: 66, y: 26, z: 286 }]) {
      // The high underside is y+3 behind the 0.25 m lip strip; the actor
      // stands 0.7 m from the west edge, with the ordinary 0.35 m radius.
      const actor = supportedStandingActor({ x: bay.x - .1, y: bay.y, z: bay.z });
      const canopy = (box: WorldBox) => box.id.startsWith(`ridge-bay-${bay.id}-`) && box.id.includes('canopy');
      const pieces = world.boxes.filter(canopy);
      expect(pieces.length, bay.id).toBeGreaterThan(0);
      expect(pieces.some((box) => box.minY === bay.y + 3 && box.maxY === bay.y + 3.6), bay.id).toBe(true);
      // A local outside impact tests actor cover, independently of a tank's
      // ability to obtain this overhead trajectory. Keep the centre in clear
      // air: exact-face open-side attenuation is the separate U-166 boundary.
      const centre = { x: actor.x, y: bay.y + 3.61, z: actor.z };
      expect(blockedAt(centre.x, centre.z, .001, centre.y, 0, .001, world.boxes), bay.id).toBe(false);
      expect(blastExposure(centre, actor, standingHeight, world.boxes), bay.id).toBe(0);
      const sheltered = damageActor(cannon, centre, actor, world.boxes);
      const withoutCanopy = world.boxes.filter((box) => !canopy(box));
      expect(blastExposure(centre, actor, standingHeight, withoutCanopy), bay.id).toBe(1);
      const uncovered = damageActor(cannon, centre, actor, withoutCanopy);
      expect(sheltered.applied, bay.id).toBeGreaterThan(0);
      expect(sheltered.raw, bay.id).toBeCloseTo(uncovered.raw * cannon.blastCoverFraction, 8);
      expect(uncovered.applied, bay.id).toBeGreaterThan(50);
      expect(sheltered.health.current, bay.id).toBeGreaterThan(uncovered.health.current);
      report.push({ bay: bay.id, sheltered: sheltered.applied, uncovered: uncovered.applied });
    }
    console.log('U-169 standing canopy blast actors', JSON.stringify(report));
  });
});
