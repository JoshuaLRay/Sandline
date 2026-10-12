import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, ENEMIES, TICK_SECONDS, applyDamage, blastDamageOn, blastExposure, blockedAt,
  createHealth, createProjectileState, getProjectile, stepProjectile, supportUnder, type ProjectileDef, type WorldBox,
} from '@sandline/shared';
import { LAUNCH_AHEAD_M, throwEye, throwLaunch } from '../../../server/src/ai/throw.ts';
import { DEFAULT_HITBOX, bodyParts, rayBody, vehicleHitbox } from '../../../server/src/net/lagComp.ts';
import { buildRoadSupportWorld } from './qalatRoadSupports.ts';

type Point = { x: number; y: number; z: number };
const world = buildRoadSupportWorld();
const projectileWorld = { boxes: world.boxes, groundY: DEFAULT_MOVE_CONFIG.groundY };
const rocket = getProjectile('rocket'), tank = ENEMIES['tank']!.vehicle!;
// Session.fireTankCannon uses the ordinary rocket row with these three real
// cannon overrides; cover fractions and actor damage rules remain unchanged.
const cannon: ProjectileDef = { ...rocket, speedMPerSec: tank.cannon.speedMPerSec,
  blastDamage: tank.cannon.blastDamage, blastRadiusM: tank.cannon.blastRadiusM };
const standingHeight = 2 * (DEFAULT_HITBOX.halfHeight + DEFAULT_HITBOX.radius);
const crouchHeight = 2 * (DEFAULT_HITBOX.crouchHalfHeight! + DEFAULT_HITBOX.radius);
const stop = { x: 32, y: 8, z: 98 }, switchback = { x: 26, y: 8, z: 232 };
const x5 = { x: 54, y: 8, z: 334 }, a8 = { x: 16, y: 8, z: 332 };

// Independent, reproducible standing launch choices. A-C02's shot leaves the
// adjacent toll-office doorway from its north interior; the regroup centre's
// direct shot hits the south jamb. The modest elevated aim reaches the real
// turret after clearing that doorway and A-S18, with ordinary rocket gravity.
const shots = [
  { cover: 'A-C01', feet: { x: 42, y: 8, z: 103.4 }, target: stop, tankYaw: 416, yaw: 2749, pitch: 9 },
  { cover: 'A-C02', feet: { x: -6, y: 8, z: 121 }, target: stop, tankYaw: 416, yaw: 1379, pitch: 44 },
  { cover: 'A-C07', feet: { x: -3, y: 8, z: 214 }, target: switchback, tankYaw: 529, yaw: 662, pitch: 19 },
  { cover: 'A-C08', feet: { x: 13, y: 8, z: 223 }, target: switchback, tankYaw: 529, yaw: 629, pitch: 10 },
  { cover: 'A-C11', feet: { x: 2, y: 8, z: 330 }, target: x5, tankYaw: 747, yaw: 974, pitch: 27 },
  { cover: 'A-C12', feet: { x: 34.16, y: 8, z: 336.7 }, target: x5, tankYaw: 747, yaw: 1112, pitch: 12 },
  { cover: 'A-C11', feet: { x: 2, y: 8, z: 330 }, target: a8, tankYaw: 759, yaw: 931, pitch: 10 },
  { cover: 'A-C12', feet: { x: 34.16, y: 8, z: 336.7 }, target: a8, tankYaw: 759, yaw: 2907, pitch: 11 },
];

function expectSupportedActor(feet: Point, height: number) {
  expect(supportUnder(feet.x, feet.z, DEFAULT_MOVE_CONFIG.radius, 8.45, world.boxes, 0)).toBe(8);
  expect(blockedAt(feet.x, feet.z, DEFAULT_MOVE_CONFIG.radius, feet.y, 0, height, world.boxes)).toBe(false);
}

/** Same actor geometry/rule path used by Session.detonate, including actual
 * health mutation. No immunity flag is installed on either control actor.
 */
function damageActor(def: ProjectileDef, centre: Point, feet: Point, height: number, boxes: readonly WorldBox[]) {
  const health = createHealth(), before = health.current;
  const damage = blastDamageOn(def, centre, feet, height, boxes);
  const result = applyDamage(health, damage, 1);
  expect(health.immuneUntil).toBeUndefined();
  expect(health.current).toBeCloseTo(before - result.applied, 8);
  return { health, damage, applied: result.applied };
}

function expectShelteredActor(def: ProjectileDef, centre: Point, feet: Point, height: number, shelter: (box: WorldBox) => boolean) {
  expectSupportedActor(feet, height);
  expect(blockedAt(centre.x, centre.z, .01, centre.y, 0, .01, world.boxes), 'blast must start outside solid scenery').toBe(false);
  expect(world.boxes.filter(shelter).length).toBeGreaterThan(0);
  expect(blastExposure(centre, feet, height, world.boxes)).toBe(0);
  const protectedActor = damageActor(def, centre, feet, height, world.boxes);
  // Removing only the named shelter is a geometry counterfactual, retaining
  // every other real solid. It proves that this shelter causes the attenuation
  // instead of another rock, an out-of-range target or a special actor flag.
  const withoutShelter = world.boxes.filter((box) => !shelter(box));
  expect(blastExposure(centre, feet, height, withoutShelter)).toBe(1);
  const exposedActor = damageActor(def, centre, feet, height, withoutShelter);
  expect(exposedActor.damage).toBeGreaterThan(0);
  expect(protectedActor.damage).toBeGreaterThan(0);
  expect(protectedActor.damage).toBeCloseTo(exposedActor.damage * def.blastCoverFraction, 8);
  expect(protectedActor.applied).toBeLessThan(exposedActor.applied);
  expect(protectedActor.health.current).toBeGreaterThan(exposedActor.health.current);
}

describe('U-152 return rocket launch clearance and actor blast protection', () => {
  it('flies ordinary rockets from all six supported cover choices to real tank hull/turret capsules', () => {
    const hits: string[] = [];
    for (const shot of shots) {
      expectSupportedActor(shot.feet, standingHeight);
      const eye = throwEye(shot.feet);
      const launch = throwLaunch(rocket, eye, shot.yaw, shot.pitch, projectileWorld);
      expect(Math.hypot(launch.origin.x - eye.x, launch.origin.y - eye.y, launch.origin.z - eye.z),
        `${shot.cover} launch was clamped into nearby scenery`).toBeCloseTo(LAUNCH_AHEAD_M, 8);
      expect(blockedAt(launch.origin.x, launch.origin.z, rocket.radiusM, launch.origin.y - rocket.radiusM,
        0, rocket.radiusM * 2, world.boxes), `${shot.cover} muzzle sphere starts occupied`).toBe(false);
      let state = createProjectileState(launch.origin, launch.velocity), hitPart: string | null = null;
      const parts = bodyParts(vehicleHitbox(tank), 'standing', shot.target, shot.tankYaw);
      for (let tick = 0; tick < Math.ceil(rocket.maxLifeSeconds / TICK_SECONDS); tick++) {
        const step = stepProjectile(rocket, state, TICK_SECONDS, projectileWorld);
        state = step.state;
        const delta = { x: step.to.x - step.from.x, y: step.to.y - step.from.y, z: step.to.z - step.from.z };
        const length = Math.hypot(delta.x, delta.y, delta.z);
        // Session.bodyAlong checks the same present-day capsules along the
        // world-truncated chord; a body before a scenery impact wins.
        const hit = length > 0 ? rayBody({ origin: step.from, direction: {
          x: delta.x / length, y: delta.y / length, z: delta.z / length,
        }, maxDistance: length }, parts) : null;
        if (hit) {
          expect(tick, `${shot.cover} immediate body contact`).toBeGreaterThan(2);
          hitPart = hit.part.part!;
          break;
        }
        expect(step.detonation, `${shot.cover} hit ${step.impact?.box?.id ?? 'ground/lifetime'} before the tank`).toBeNull();
      }
      expect(['hull', 'turret'], `${shot.cover} never reached the tank`).toContain(hitPart);
      hits.push(`${shot.cover}→${shot.target === x5 ? 'X5' : shot.target === a8 ? 'A8' : shot.target === stop ? 'X-stop' : 'A5'}:${hitPart}`);
    }
    expect(hits).toHaveLength(8);
    console.log('U-152 real rocket flights', JSON.stringify({ hits, radiusM: rocket.radiusM, gravity: rocket.gravity,
      rules: 'production throwLaunch/stepProjectile and present tank hull/turret rayBody' }));
  }, 60_000);

  it('keeps ordinary blast danger at the supported launch feet without granting immunity', () => {
    for (const shot of shots.slice(0, 6)) {
      const centre = { x: shot.feet.x + (shot.cover === 'A-C01' || shot.cover === 'A-C02' ? 1.5 : -1.5),
        y: shot.feet.y + standingHeight / 2, z: shot.feet.z };
      expect(blockedAt(centre.x, centre.z, .01, centre.y, 0, .01, world.boxes), shot.cover).toBe(false);
      expect(blastExposure(centre, shot.feet, standingHeight, world.boxes), shot.cover).toBe(1);
      const actor = damageActor(cannon, centre, shot.feet, standingHeight, world.boxes);
      expect(actor.applied, `${shot.cover} open exposure did not hurt the actor`).toBeGreaterThan(50);
      expect(actor.health.current).toBeLessThan(actor.health.max);
    }
  });

  it('attenuates actual cannon blasts behind each of the six road covers using actor health', () => {
    const shelters = [
      { id: 'A-C01', feet: { x: 43.918334617360806, y: 8, z: 105.2788897449072 },
        centre: { x: 45.624037720753385, y: 8.9, z: 106.41602514716892 }, height: standingHeight },
      { id: 'A-C02', feet: { x: -3.5505577442052436, y: 8, z: 126.82304789528165 },
        centre: { x: -4.498345635451198, y: 8.9, z: 123.50579027592082 }, height: standingHeight },
      { id: 'A-C07', feet: { x: 1.5095140464924248, y: 8, z: 215.2039200677004 },
        centre: { x: 2.2829726654851394, y: 8.9, z: 213.30543073017284 }, height: standingHeight },
      { id: 'A-C08', feet: { x: 15.584973423955129, y: 8, z: 220.0187015957465 },
        centre: { x: 16.207513288022437, y: 8.9, z: 218.49064920212675 }, height: crouchHeight },
      { id: 'A-C11', feet: { x: 1.175178359098398, y: 8, z: 335.2722161992045 },
        centre: { x: 2.412410820450801, y: 8.9, z: 336.3638919003978 }, height: crouchHeight },
      { id: 'A-C12', feet: { x: 35.38836788571124, y: 8, z: 342.9636729904789 },
        centre: { x: 36.920556989012745, y: 8.9, z: 341.60172712087757 }, height: standingHeight },
    ];
    for (const shelter of shelters) expectShelteredActor(cannon, shelter.centre, shelter.feet, shelter.height,
      (box) => box.id.startsWith(`road-combat-${shelter.id}-`));
  });

  it('protects a real actor inside the store and the exact holding socket with ordinary blast-cover rules', () => {
    const northBlast = { x: 50, y: 8.9, z: 62.75 };
    const store = (box: WorldBox) => box.id.startsWith('D0-weigh-station-store-');
    expectShelteredActor(cannon, northBlast, { x: 50, y: 8, z: 61 }, standingHeight, store);
    // The authored holding point lies beyond the 4.5 m cannon radius at this
    // outer wall. A real 5.5 m carried rocket additionally demonstrates its
    // wall attenuation with positive raw damage, instead of a range-only pass.
    const holding = { x: 50, y: 8, z: 58 };
    expectShelteredActor(rocket, northBlast, holding, standingHeight, store);
    expect(damageActor(cannon, northBlast, holding, standingHeight, world.boxes).applied).toBe(0);
    expectShelteredActor(cannon, { x: 50, y: 12.62, z: 58 }, holding, standingHeight, store);
  });

  it('attenuates a cannon blast for an actor behind the built toll-office wall', () => {
    expectShelteredActor(cannon, { x: .75, y: 8.9, z: 115 }, { x: -1, y: 8, z: 115 }, standingHeight,
      (box) => box.id.startsWith('road-combat-toll-office-'));
  });

  it('protects an actor under the insertion overhang while an equally positioned uncovered actor takes blast damage', () => {
    const roofBlast = { x: 5, y: 14.21, z: -3 }, feet = { x: 5, y: 8, z: -3 };
    expectShelteredActor(rocket, roofBlast, feet, standingHeight, (box) => box.id === 'hollow-overhang');
    expect(damageActor(cannon, roofBlast, feet, standingHeight, world.boxes).applied).toBe(0);
  });
});
