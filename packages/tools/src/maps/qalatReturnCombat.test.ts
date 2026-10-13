import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG, ENEMIES, TICK_SECONDS, applyDamage, blastDamageOn, blastExposure, blockedAt,
  createHealth, createMoveState, createProjectileState, getProjectile, stepCharacter, stepProjectile, supportUnder,
  type MoveState, type ProjectileDef, type WorldBox,
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
  expect(supportUnder(feet.x, feet.z, DEFAULT_MOVE_CONFIG.radius, feet.y + .45, world.boxes, 0)).toBe(feet.y);
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

// Independent §6.2/§11.2 coordinates. The hold occupies the inland side of
// the authored R5 high rock; its approach starts at the exact §6.3 C12-U
// endpoint on the already built R5 landing. U-141 still owns that crossing
// and its rocket firing clearance; this test does not supply either.
const R5 = { x: 86, y: 30, z: 248 };
const RIDGE_HOLD = { x: 95.8, y: 30, z: 238 };
const RIDGE_EXPOSED = { x: 91, y: 30, z: 238 };
const RIDGE_OUTSIDE_BLAST = { x: 93.2, y: 30.9, z: 238 };
const ridgeShelter = (box: WorldBox) => box.id.startsWith('ridge-cover-R5-high-rock');

/** Local shell impact fixture, with Session.fireShell's ordinary cannon
 * definition and gravity-compensated velocity. This exercises protection at
 * the cover itself, independently of U-141's unbuilt C12-U firing geometry.
 * Session.stepProjectiles checks the real actor's capsules on exactly this
 * scenery-truncated chord before selecting the blast centre.
 */
function shellTowardRidgeActor(feet: Point, boxes: readonly WorldBox[],
  origin = { x: 91.5, y: 30 + standingHeight / 2, z: 238 }) {
  const target = { ...feet, y: feet.y + standingHeight / 2 };
  const dx = target.x - origin.x, dz = target.z - origin.z;
  const seconds = Math.hypot(dx, dz) / cannon.speedMPerSec;
  const dy = target.y + .5 * cannon.gravity * seconds * seconds - origin.y;
  const scale = cannon.speedMPerSec / Math.hypot(dx, dy, dz);
  let state = createProjectileState(origin, { x: dx * scale, y: dy * scale, z: dz * scale });
  const parts = bodyParts(DEFAULT_HITBOX, 'standing', feet, 0);
  expect(blockedAt(origin.x, origin.z, cannon.radiusM, origin.y - cannon.radiusM,
    0, cannon.radiusM * 2, boxes), 'shell must begin in clear air').toBe(false);
  for (let tick = 0; tick < Math.ceil(cannon.maxLifeSeconds / TICK_SECONDS); tick++) {
    const step = stepProjectile(cannon, state, TICK_SECONDS, { ...projectileWorld, boxes });
    state = step.state;
    const delta = { x: step.to.x - step.from.x, y: step.to.y - step.from.y, z: step.to.z - step.from.z };
    const length = Math.hypot(delta.x, delta.y, delta.z);
    const direction = length > 0 ? { x: delta.x / length, y: delta.y / length, z: delta.z / length } : null;
    const body = direction ? rayBody({ origin: step.from, direction, maxDistance: length }, parts) : null;
    if (body && direction) return { bodyHit: true, box: null, centre: {
      x: step.from.x + direction.x * body.distance,
      y: step.from.y + direction.y * body.distance,
      z: step.from.z + direction.z * body.distance,
    } };
    if (step.detonation) return { bodyHit: false, box: step.impact?.box ?? null, centre: step.detonation.point };
  }
  throw new Error('ordinary cannon shell never reached the ridge cover or actor');
}

/** Actual standing controller travel on the already built y30 shelf/pocket.
 * Waypoints follow the open ends of the cover, without a jump, vault or link.
 */
function walkRidgeHold(stops: readonly Point[], initial?: MoveState) {
  let state: MoveState = initial ?? { ...createMoveState(stops[0]!.x, stops[0]!.y, stops[0]!.z), grounded: true };
  expectSupportedActor(state, standingHeight);
  for (const goal of stops.slice(1)) {
    expectSupportedActor(goal, standingHeight);
    let arrived = false;
    for (let tick = 0; tick < 600; tick++) {
      if (Math.hypot(state.x - goal.x, state.z - goal.z) < .15) { arrived = true; break; }
      const yaw = Math.round(Math.atan2(goal.x - state.x, goal.z - state.z) / (2 * Math.PI) * 1024 + 1024) % 1024;
      state = stepCharacter(state, { moveX: 0, moveY: 1, yaw, sprint: false, jump: false,
        crouch: false, prone: false }, TICK_SECONDS, DEFAULT_MOVE_CONFIG, world.boxes);
      expect(state.y, `left the R5 floor approaching ${JSON.stringify(goal)}`).toBeCloseTo(30, 6);
      expect(state.vault).toBeNull();
    }
    expect(arrived, `R5 actor stalled at ${JSON.stringify(state)} toward ${JSON.stringify(goal)}`).toBe(true);
  }
  return state;
}

describe('U-165 R5 inland escorted hold with actual actor/projectile/blast rules', () => {
  it('stops the ordinary swept cannon shell at built high rock and attenuates real actor health damage', () => {
    expectSupportedActor(RIDGE_HOLD, standingHeight);
    expect(world.boxes.filter(ridgeShelter).length).toBeGreaterThan(0);
    const protectedFlight = shellTowardRidgeActor(RIDGE_HOLD, world.boxes);
    expect(protectedFlight.bodyHit, 'shell penetrated the built cover to the actor').toBe(false);
    expect(protectedFlight.box?.id).toMatch(/^ridge-cover-R5-high-rock/);
    expect(protectedFlight.centre.x).toBeCloseTo(93.4, 8);
    expect(blastExposure(protectedFlight.centre, RIDGE_HOLD, standingHeight, world.boxes)).toBe(0);

    // Removing only that rock makes the identical shot reach the actual body,
    // retaining the shelf and every other rock/shell. This checks collision
    // causality, rather than passing because some unrelated terrain stops it.
    const withoutCover = world.boxes.filter((box) => !ridgeShelter(box));
    expect(blastExposure(protectedFlight.centre, RIDGE_HOLD, standingHeight, withoutCover)).toBe(1);
    const unprotectedFlight = shellTowardRidgeActor(RIDGE_HOLD, withoutCover);
    expect(unprotectedFlight.bodyHit, 'control shell did not reach the actual actor').toBe(true);
    const protectedActor = damageActor(cannon, protectedFlight.centre, RIDGE_HOLD, standingHeight, world.boxes);
    const sameImpactUncovered = damageActor(cannon, protectedFlight.centre, RIDGE_HOLD, standingHeight, withoutCover);
    const uncoveredActor = damageActor(cannon, unprotectedFlight.centre, RIDGE_HOLD, standingHeight, withoutCover);
    expect(protectedActor.applied).toBeGreaterThan(0);
    expect(protectedActor.damage).toBeCloseTo(sameImpactUncovered.damage * cannon.blastCoverFraction, 8);
    expect(protectedActor.applied).toBeLessThan(uncoveredActor.applied);
    expect(protectedActor.health.current).toBeGreaterThan(uncoveredActor.health.current);
    console.log('U-165 R5 ordinary cannon actor proof', JSON.stringify({ impact: protectedFlight.centre,
      solid: protectedFlight.box?.id, shelteredDamage: protectedActor.applied, uncoveredDamage: uncoveredActor.applied }));
  });

  it('reaches the inland hold from the ridge/C12-U landing and keeps ordinary danger after leaving cover', () => {
    const arrived = walkRidgeHold([R5, { x: 95.8, y: 30, z: 248 }, RIDGE_HOLD]);
    expect(Math.hypot(arrived.x - RIDGE_HOLD.x, arrived.z - RIDGE_HOLD.z)).toBeLessThan(.15);
    // Return around the north end into ordinary open exposure on the original
    // shelf. The standing actor is neither teleported nor given immunity.
    const left = walkRidgeHold([RIDGE_HOLD, { x: 95.8, y: 30, z: 243 },
      { x: 91, y: 30, z: 243 }, RIDGE_EXPOSED], arrived);
    // As in the inherited U-152 exterior-impact fixtures, start this blast in
    // clear air immediately outside the cover. The exact projectile collision
    // face is covered above; rayWorld treats an origin on that solid face as
    // blocked in every direction, so it cannot prove the open-side control.
    expectShelteredActor(cannon, RIDGE_OUTSIDE_BLAST, RIDGE_HOLD, standingHeight, ridgeShelter);
    expect(blastExposure(RIDGE_OUTSIDE_BLAST, left, standingHeight, world.boxes)).toBe(1);
    const sheltered = damageActor(cannon, RIDGE_OUTSIDE_BLAST, RIDGE_HOLD, standingHeight, world.boxes);
    const exposed = damageActor(cannon, RIDGE_OUTSIDE_BLAST, left, standingHeight, world.boxes);
    expect(exposed.applied).toBeGreaterThan(50);
    expect(exposed.applied).toBeGreaterThan(sheltered.applied);
    expect(exposed.health.current).toBeLessThan(sheltered.health.current);
    const directFlight = shellTowardRidgeActor(left, world.boxes,
      { x: 88.5, y: left.y + standingHeight / 2, z: left.z });
    expect(directFlight.bodyHit, 'ordinary shell failed to reach the actor after leaving cover').toBe(true);
    expect(blastExposure(directFlight.centre, left, standingHeight, world.boxes)).toBe(1);
    const directHit = damageActor(cannon, directFlight.centre, left, standingHeight, world.boxes);
    expect(directHit.applied).toBeGreaterThan(50);
    expect(directHit.health.current).toBeLessThan(sheltered.health.current);
    const returned = walkRidgeHold([RIDGE_EXPOSED, { x: 91, y: 30, z: 248 }, R5], left);
    expect(Math.hypot(returned.x - R5.x, returned.z - R5.z)).toBeLessThan(.15);
  }, 30_000);
});
