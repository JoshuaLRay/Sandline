/** U-180: the resolved V3 gun line, every named support ray and blind spot,
 * the west door's swept four-metre turn, socket/patrol/supply clearances and
 * staged-reserve concealment from production cameras, all in the complete
 * furnished scene. Navigation and controller travel live in qalatOutpostNav. */
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG as config, DEFAULT_MUZZLE_RIG as rig, TICK_SECONDS, blockedAt, createMoveState,
  degToWire, emplacementFacing, getEmplacement, gunMuzzle, gunnerPlace, rayWorld, stepCharacter,
  supportUnder, withinArc, type WorldBox,
} from '@sandline/shared';
import { createSceneCollider } from '../../../client/src/camera/sceneCollider.ts';
import { createCameraSolve, solveCamera } from '../../../client/src/camera/cameraSolve.ts';
import { DEFAULT_CAMERA_CONFIG } from '../../../client/src/camera/cameraConfig.ts';
import { mobileOrbit } from '../../../client/src/camera/mobileOrbit.ts';
import { MOBILE_CAMERA_MIN, mobileCameraMax } from '../../../client/src/ui/mobileDevice.ts';
import observers from './qalat-observers.json' with { type: 'json' };
import { between, rayOccluded } from './insertionScreening.ts';
import { OUTPOST, buildOutpostWorld } from './qalatOutpost.ts';

type Point = { x: number; y: number; z: number };
type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
const p = (x: number, y: number, z: number): Point => ({ x, y, z });
const eyeOf = (f: Point, h: number = rig.eyeHeight): Point => ({ ...f, y: f.y + h });
// Independent §6.2/§8.2/§9 transcription, including U-180's resolved gun line:
// O-C01 x26..32 in the south throat; mg-nest gun 0.7 m toward A8 from OG1.
const V1 = p(58, 20, 128), V2 = p(88, 30, 210), V3 = p(66, 26, 286);
const SUPPORT_RAYS: [string, Point, Point][] = [
  ['V1 truck fan', V1, p(-4, 8, 126)], ['V1 eastern road wall', V1, p(24, 8, 138)],
  ['V2 MG nest', V2, p(-22, 8, 222)], ['V2 crossing approach', V2, p(26, 8, 232)],
  ['V3 A7', V3, p(-18, 8, 302)], ['V3 A8', V3, p(16, 8, 332)],
  ['V3 south-gate gun', V3, p(31.2, 8, 360.4)], ['V3 X5 turret', V3, p(54, 11.2, 334)],
];
const GUN = p(31.2, 8, 360.4), USE = p(31.5, 8, 361), A8 = p(16, 8, 332), APPROACH = p(32, 8, 350);
const O_C01 = { minX: 26, maxX: 32, minZ: 358.6, maxZ: 359.4, top: 9.1 };
const OLD_GUN = p(38, 8, 360);
const CELL: Rect = { minX: 10, maxX: 22, minZ: 396, maxZ: 410 };
const REFUGE: Rect = { minX: 10, maxX: 22, minZ: 376, maxZ: 384 };
const COURT: Rect = { minX: 8, maxX: 56, minZ: 356, maxZ: 412 };
const GARRISON: [string, number, number][] = [['OG1', 31.5, 361], ['OG2', 18, 368], ['OG3', 48, 378],
  ['OG4', 18, 390], ['OG5', 28, 402], ['OG6', 36, 386], ['OR1', 50, 402]];
const RESERVE: [string, number, number][] = [['C1', 28, 440], ['C2', 32, 440], ['C3', 36, 440], ['C4', 32, 444]];
const RELEASE: [string, number, number][] = [['C1', 30, 404], ['C2', 38, 404], ['C3', 28, 388], ['C4', 44, 388]];
const OG6_PATROL = [[36, 386], [36, 376], [28, 384]] as const;
const HOLDING = [[16, 402], [12, 400], [20, 400], [12, 404], [20, 404], [12, 408]] as const;
// P-OUTPOST (§12) and a conservative 1×1×1.2 m cache with four standing use
// points 1.6 m out, each inside the 2 m reach and seeing the box top.
const CACHE = p(14, 8, 380);
const CACHE_USES = [[15.6, 380], [14, 381.6], [14, 378.4], [12.4, 380]] as const;
// U-180 west reveal and the two corners that bound the turn.
const REVEAL = { minX: 7.2, maxX: 8, minZ: 371.4, maxZ: 372, minY: 8, maxY: 11 };
const INNER_JAMB = { x: 8, z: 372 }, OUTER_JAMB = { x: 7.2, z: 372 }, REFUGE_CORNER = { x: 9.4, z: 375.4 };
// Band centre: east along the pad, a 32° bevel past the jamb, then the lane z371.4..375.4.
const TURN = [{ x: 4.4, z: 374 }, { x: 7.82, z: 374 }, { x: 7.82 + .6 / Math.tan(32 * Math.PI / 180), z: 373.4 }, { x: 24, z: 373.4 }];

const world = buildOutpostWorld();
const blocked = rayOccluded(world.boxes);
const inside = (r: Rect, x: number, z: number, margin = 0) =>
  x > r.minX - margin && x < r.maxX + margin && z > r.minZ - margin && z < r.maxZ + margin;
const region = (x0: number, x1: number, z0: number, z1: number) =>
  world.boxes.filter((b) => b.maxX >= x0 && b.minX <= x1 && b.maxZ >= z0 && b.minZ <= z1);
const first = (from: Point, to: Point, short = 0) => {
  const ray = between(from, to);
  return rayWorld({ ...ray, maxDistance: ray.maxDistance - short }, world.boxes);
};
afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));

describe('U-180 resolved V3 gun line and complete-scene support rays', () => {
  it('places the mg-nest so V3 sees the crew through the arch while the gun fires at A8 over O-C01', () => {
    const bag = world.boxes.find((b) => b.id === 'outpost-furniture-O-C01')!;
    expect([bag.minX, bag.maxX, bag.minZ, bag.maxZ, bag.minY, bag.maxY]).toEqual([O_C01.minX, O_C01.maxX, O_C01.minZ, O_C01.maxZ, 8, O_C01.top]);
    expect(OUTPOST.southGateGun).toMatchObject({ cover: 'O-C01', kind: 'mg-nest', gun: GUN, use: USE, toward: { id: 'A8', ...A8 } });
    // The real emplacement rules put the crouched crew 0.7 m behind the gun.
    const def = getEmplacement('mg-nest');
    const yawDeg = Math.atan2(A8.x - GUN.x, A8.z - GUN.z) * 180 / Math.PI;
    const placed = { id: 'og1-mg', kind: 'mg-nest', ...GUN, yawDeg };
    const crew = gunnerPlace(placed, def), muzzle = gunMuzzle(placed, def);
    expect(Math.hypot(crew.x - USE.x, crew.z - USE.z), 'gunner place is the OG1 socket').toBeLessThanOrEqual(.05);
    expect(muzzle).toEqual({ ...GUN, y: 8 + def.gunHeightM });
    // Crew space: crouched on the gun, standing when dismounted, clear of the east lane.
    for (const h of [config.crouchHeight, config.height]) {
      expect(blockedAt(USE.x, USE.z, config.radius, 8, .05, h, world.boxes), `OG1 body ${h}`).toBe(false);
    }
    expect(supportUnder(USE.x, USE.z, config.radius, 8.01, world.boxes, 0)).toBeCloseTo(8, 6);
    expect(USE.x + config.radius, 'OG1 stays west of the x32..36 gate lane').toBeLessThanOrEqual(32);
    // Before U-180 the listed V3 gun ray crossed the south wall outside its
    // arch and below its y14 top (U-116); it stays blocked.
    const old = eyeOf(V3), along = (355.5 - old.z) / (OLD_GUN.z - old.z);
    expect(old.x + (OLD_GUN.x - old.x) * along).toBeGreaterThan(36);
    expect(old.y + (OLD_GUN.y - old.y) * along).toBeLessThan(14);
    expect(first(old, OLD_GUN, 1), 'original target').not.toBeNull();
    // V3's standing eye now reaches the crouched crew, its chest, the muzzle and the gun's feet.
    for (const h of [config.crouchHeight / 2, rig.crouchEyeHeight, config.crouchHeight - .05, rig.eyeHeight])
      expect(first(eyeOf(V3), { ...USE, y: 8 + h }), `V3 → OG1 at ${h}`).toBeNull();
    expect(first(eyeOf(V3), muzzle), 'V3 → muzzle').toBeNull();
    // Its own sandbags end the feet ray (U-167's 1 m-short contract lets a
    // target's own cover do so); nothing else does.
    expect(first(eyeOf(V3), GUN, 1)?.box.id, 'V3 → gun feet, 1 m short').toBe('outpost-furniture-O-C01');
    // Actual MG rounds: inside the traverse and elevation limits, clear to a
    // standing target at A8 from shins to eyes. At OG1's facing point (32,350),
    // 10 m out, the 1.1 m sandbags leave the shins in dead ground.
    const facing = emplacementFacing(placed);
    for (const [target, h] of [...[.3, .9, rig.eyeHeight].map((h) => [A8, h] as const), [APPROACH, .9] as const, [APPROACH, rig.eyeHeight] as const]) {
      const to = { ...target, y: 8 + h }, flat = Math.hypot(to.x - muzzle.x, to.z - muzzle.z);
      const yaw = degToWire(Math.atan2(to.x - muzzle.x, to.z - muzzle.z) * 180 / Math.PI);
      const pitch = Math.atan2(to.y - muzzle.y, flat) * 180 / Math.PI;
      expect(withinArc(facing, yaw, def.traverseDeg), `traverse ${JSON.stringify(to)}`).toBe(true);
      expect(pitch).toBeGreaterThanOrEqual(-def.elevationDownDeg); expect(pitch).toBeLessThanOrEqual(def.elevationUpDeg);
      expect(first(muzzle, to), `MG → ${JSON.stringify(to)}`).toBeNull();
    }
    // The sandbags face the road: A8's eye meets O-C01 before the crouched body, not the head.
    expect(first(eyeOf(A8), { ...USE, y: 8 + config.crouchHeight / 2 })?.box.id).toBe('outpost-furniture-O-C01');
    expect(first(eyeOf(A8), { ...USE, y: 8 + rig.crouchEyeHeight })).toBeNull();
    expect(first(gunMuzzle(placed, def), { ...APPROACH, y: 8.3 })?.box.id, 'close-in dead ground').toBe('outpost-furniture-O-C01');
  });

  it('keeps every V1–V3 support ray clear and every named blind spot closed in the furnished scene', () => {
    // The generator's listed bay targets are this independent set (V3's gun included).
    for (const [label, bay, target] of SUPPORT_RAYS)
      expect(first(eyeOf(bay), target, 1)?.box.id ?? null, label).toBe(label === 'V3 south-gate gun' ? 'outpost-furniture-O-C01' : null);
    const heights = [.05, config.proneHeight, config.crouchHeight, rig.eyeHeight, config.height];
    let rays = 0;
    const hidden = (label: string, bay: Point, x: number, y: number, z: number) => {
      for (const h of heights) {
        expect(blocked(between(eyeOf(bay), { x, y: y + h, z })), `${label} visible at ${x}/${y + h}/${z}`).toBe(true);
        rays++;
      }
    };
    hidden('V1 → A4 nest', V1, -22, 8, 222);
    hidden('V2 → A2', V2, 12, 8, 128);
    for (let x = COURT.minX + .5; x < COURT.maxX; x += 2) for (let z = COURT.minZ + .5; z < COURT.maxZ; z += 2) hidden('V2 → compound', V2, x, 8, z);
    // V3: prisoner rooms, radio room, the west service gate (pad, door,
    // reveal and inside landing) and the basement rooms below.
    for (const [x0, x1, z0, z1] of [[10, 22, 386, 395.4], [10, 22, 396, 410], [42, 54, 390, 410]] as const)
      for (let x = x0 + .5; x < x1; x += 1) for (let z = z0 + .5; z < z1; z += 1) hidden('V3 → prisoner/radio rooms', V3, x, 8, z);
    for (let x = 4.25; x < 12; x += .5) for (let z = 372.25; z < 376; z += .5) hidden('V3 → west service gate', V3, x, 8, z);
    for (const x of [7.4, 7.8]) hidden('V3 → west reveal', V3, x, 8, 371.7);
    for (const [cx, cz, w, d] of [[-2, 96, 12, 12], [-20, 120, 20, 24], [-36, 160, 24, 32], [-18, 200, 20, 24],
      [8, 232, 16, 16], [30, 270, 28, 36], [-14, 310, 20, 20], [-14, 346, 20, 24], [-8, 370, 12, 12]] as const)
      for (let x = cx - w / 2 + 1; x < cx + w / 2; x += 2) for (let z = cz - d / 2 + 1; z < cz + d / 2; z += 2) hidden('V3 → basement', V3, x, 0, z);
    expect(rays).toBeGreaterThan(5_000);
    console.log('U-180 support rays and blind spots', JSON.stringify({ supportRays: SUPPORT_RAYS.length, blindRays: rays }));
  }, 120_000);
});

describe('U-180 west entry turn through the recessed reveal', () => {
  const local = region(0, 30, 362, 386);
  /** Sweep a 4 m segment perpendicular to the centre polyline, rotating it
   * about each vertex (§2.2 bevel). Returns blocked/unsupported samples. */
  function sweep(boxes: readonly WorldBox[]) {
    const bad: { x: number; z: number }[] = [];
    let samples = 0;
    const at = (cx: number, cz: number, angle: number) => {
      for (let t = -1.999; t <= 1.999 + 1e-9; t += .037) {
        const x = cx + Math.sin(angle) * t, z = cz + Math.cos(angle) * t;
        samples++;
        if (blockedAt(x, z, .001, 8, 0, 2.999, boxes) || Math.abs(supportUnder(x, z, .001, 8.01, boxes, 0) - 8) > 1e-6) bad.push({ x, z });
      }
    };
    const angles = TURN.slice(1).map((b, i) => Math.atan2(TURN[i]!.z - b.z, b.x - TURN[i]!.x));
    for (let i = 1; i < TURN.length; i++) {
      const a = TURN[i - 1]!, b = TURN[i]!, length = Math.hypot(b.x - a.x, b.z - a.z);
      for (let s = 0; s <= length; s += .02) at(a.x + (b.x - a.x) * s / length, a.z + (b.z - a.z) * s / length, angles[i - 1]!);
      if (i < TURN.length - 1) for (let k = 0; k <= 40; k++) at(b.x, b.z, angles[i - 1]! + (angles[i]! - angles[i - 1]!) * k / 40);
    }
    return { samples, bad };
  }

  it('measures the corner pinch and the exact bounded reveal with the door kept 4 m at its outer face', () => {
    const gap = (a: { x: number; z: number }) => Math.hypot(REFUGE_CORNER.x - a.x, REFUGE_CORNER.z - a.z);
    expect(gap(INNER_JAMB), 'inherited pinch').toBeLessThan(3.7);
    expect(gap(OUTER_JAMB), 'reveal pinch').toBeGreaterThanOrEqual(4);
    expect(OUTPOST.westReveal.cut).toEqual(REVEAL);
    for (let x = REVEAL.minX + .01; x < REVEAL.maxX; x += .1) for (let z = REVEAL.minZ + .01; z < REVEAL.maxZ; z += .1) {
      expect(blockedAt(x, z, .001, 8, 0, REVEAL.maxY - 8 - .001, local), `reveal open ${x}/${z}`).toBe(false);
      expect(supportUnder(x, z, .001, 8.01, local, 0), `reveal floor ${x}/${z}`).toBeCloseTo(8, 6);
      expect(blockedAt(x, z, .001, REVEAL.maxY + .001, 0, .5, local), `reveal lintel ${x}/${z}`).toBe(true);
    }
    // Door: still exactly 4 m (z372..376) through the outer 0.2 m jamb; infill beyond it.
    for (let z = 370.05; z < 378; z += .1) {
      const open = z > 372 && z < 376;
      expect(blockedAt(7.1, z, .001, 8, 0, 2.999, local), `outer door face ${z}`).toBe(!open);
      expect(blockedAt(7.6, z, .001, 8, 0, 2.999, local), `reveal depth ${z}`).toBe(!(z > REVEAL.minZ && z < 376));
    }
  });

  it('sweeps a full four-metre band from the west pad into the court lane; the inherited jamb blocks it', () => {
    const actual = sweep(local);
    expect(actual.bad.slice(0, 3), 'band blocked').toEqual([]);
    expect(actual.samples).toBeGreaterThan(100_000);
    // Negative control: restoring the cut masonry stops the identical band.
    const restored = sweep([...local, { id: 'restored-infill', kind: 'cover', ...REVEAL }]);
    expect(restored.bad.length).toBeGreaterThan(0);
    console.log('U-180 west four-metre turn', JSON.stringify({ samples: actual.samples, restoredInfillBlocked: restored.bad.length,
      pinchBeforeM: +Math.hypot(1.4, 3.4).toFixed(3), pinchAfterM: +Math.hypot(2.2, 3.4).toFixed(3) }));
  }, 60_000);

  it('rejects sprint-jump, vault, crouch and prone escapes from inside the reveal and its jambs', () => {
    let attempts = 0, peak = 8;
    // Bodies straddling the 0.6 m recess and beside both jamb faces push into the
    // infill, the jamb and the wall in every direction.
    for (const [x, z] of [[7.6, 371.8], [7.6, 372.4], [8.4, 371.2], [8.4, 372], [6.6, 372.4]] as const)
      for (const yaw of [0, 128, 256, 384, 512, 640, 768, 896]) for (const stance of ['jump', 'crouch', 'prone']) {
        // Every box within 32 m: a 1.5 s sprint push cannot leave the window.
        const boxes = region(x - 32, x + 32, z - 32, z + 32);
        let state = { ...createMoveState(x, 8, z), grounded: true };
        expect(blockedAt(x, z, config.radius, 8, .05, config.height, boxes), `start ${x}/${z}`).toBe(false);
        for (let tick = 0; tick < 75; tick++) {
          const push = tick < 45;
          state = stepCharacter(state, { moveX: 0, moveY: push ? 1 : 0, yaw, sprint: push, jump: push && stance === 'jump',
            crouch: push && stance === 'crouch', prone: push && stance === 'prone' }, TICK_SECONDS, config, boxes);
          const where = `${x}/${z}/${yaw}/${stance}/${tick}: ${JSON.stringify(state)}`;
          // Never onto the y11 lintel, infill or y14 wall and never landed on
          // a raised surface (B10's legal stair descends from the pad).
          expect(state.y, where).toBeLessThan(8 + config.vaultMaxHeight + .5);
          peak = Math.max(peak, state.y);
          if (state.grounded) expect(state.y, `${where} landed above the floor`).toBeLessThanOrEqual(8 + 1e-6);
          expect(blockedAt(state.x, state.z, config.radius, state.y, .05, config.proneHeight, boxes), `${where} inside solid`).toBe(false);
        }
        expect(state.grounded && state.vault === null, `${x}/${z}/${yaw}/${stance} settled`).toBe(true);
        attempts++;
      }
    expect(attempts).toBe(120);
    console.log('U-180 west reveal escape attempts', JSON.stringify({ attempts, ticks: 75, peakFeet: +peak.toFixed(3) }));
  }, 60_000);

  it('walks two abreast soldiers through the turn both ways on the real controller without touching it', () => {
    // Lanes 1.6 m either side of the centre (bodies inside the band), mitred.
    const lane = (offset: number) => {
      const legs = TURN.slice(1).map((b, i) => {
        const a = TURN[i]!, l = Math.hypot(b.x - a.x, b.z - a.z), n = { x: -(b.z - a.z) / l, z: (b.x - a.x) / l };
        return { a: { x: a.x + n.x * offset, z: a.z + n.z * offset }, d: { x: (b.x - a.x) / l, z: (b.z - a.z) / l }, n };
      });
      const points = [legs[0]!.a];
      for (let i = 1; i < legs.length; i++) {
        const u = legs[i - 1]!, v = legs[i]!, cross = u.d.x * v.d.z - u.d.z * v.d.x;
        const s = ((v.a.x - u.a.x) * v.d.z - (v.a.z - u.a.z) * v.d.x) / cross;
        points.push({ x: u.a.x + u.d.x * s, z: u.a.z + u.d.z * s });
      }
      const last = TURN.at(-1)!, n = legs.at(-1)!.n;
      points.push({ x: last.x + n.x * offset, z: last.z + n.z * offset });
      return points;
    };
    const distance = (q: { x: number; z: number }, line: readonly { x: number; z: number }[]) => Math.min(...line.slice(1).map((b, i) => {
      const a = line[i]!, dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.z - a.z) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(q.x - a.x - t * dx, q.z - a.z - t * dz);
    }));
    let ticks = 0, worst = 0;
    for (const offset of [-1.6, 1.6]) for (const reverse of [false, true]) {
      const line = reverse ? lane(offset).reverse() : lane(offset);
      let state = { ...createMoveState(line[0]!.x, 8, line[0]!.z), grounded: true }, next = 1;
      for (let tick = 0; tick < 900 && next < line.length; tick++, ticks++) {
        const goal = line[next]!;
        if (Math.hypot(goal.x - state.x, goal.z - state.z) < .15) { next++; continue; }
        const yaw = (Math.round(Math.atan2(goal.x - state.x, goal.z - state.z) / (2 * Math.PI) * 1024) + 1024) % 1024;
        state = stepCharacter(state, { moveX: 0, moveY: 1, yaw, sprint: false, jump: false, crouch: false, prone: false }, TICK_SECONDS, config, local);
        const where = `${offset}/${reverse}: ${JSON.stringify(state)}`;
        expect(state.y, where).toBeCloseTo(8, 6); expect(state.vault, where).toBeNull();
        expect(blockedAt(state.x, state.z, config.radius, 8, .05, config.height, local), where).toBe(false);
        worst = Math.max(worst, distance(state, line));
      }
      expect(next, `lane ${offset} ${reverse ? 'outward' : 'inward'} stalled at ${JSON.stringify(state)}`).toBe(line.length);
    }
    // No wall deflected either soldier off its lane.
    expect(worst).toBeLessThan(.2);
    console.log('U-180 west turn controller', JSON.stringify({ walks: 4, ticks, maxLaneDeviationM: +worst.toFixed(3) }));
  }, 60_000);
});

describe('U-180 hostile, reserve and supply clearances on y8', () => {
  const standing = (label: string, x: number, z: number, height: number = config.height) => {
    expect(blockedAt(x, z, config.radius, 8, .05, height, world.boxes), `${label}: body`).toBe(false);
    expect(supportUnder(x, z, config.radius, 8.01, world.boxes, 0), `${label}: floor`).toBeCloseTo(8, 6);
    expect(inside(CELL, x, z, config.radius) || inside(REFUGE, x, z, config.radius), `${label}: in cell or refuge`).toBe(false);
  };

  it('holds every garrison, radio and staged reserve socket and each release target clear and supported', () => {
    for (const [id, x, z] of [...GARRISON, ...RESERVE]) standing(id, x, z);
    for (const [id, x, z] of RELEASE) standing(`${id} release`, x, z);
    // The verification/insertion inputs carry the same positions and routes.
    expect(observers.guards.slice(-7)).toEqual(GARRISON.map(([, x, z]) => [x, 8, z]));
    expect(observers.reserve).toEqual(RESERVE.map(([, x, z]) => [x, 8, z]));
    expect(observers.reserveRoutes.map((r) => [r[0], r.at(-1)])).toEqual(RESERVE.map(([, x, z], i) => [[x, 8, z], [RELEASE[i]![1], 8, RELEASE[i]![2]]]));
    expect(observers.patrols.at(-1)).toEqual(OG6_PATROL.map(([x, z]) => [x, 8, z]));
  });

  it('samples OG6’s patrol at 0.5 m or finer on the court floor, clear of cover, outside cell and refuge', () => {
    let samples = 0;
    for (let i = 1; i < OG6_PATROL.length; i++) {
      const [ax, az] = OG6_PATROL[i - 1]!, [bx, bz] = OG6_PATROL[i]!, count = Math.ceil(Math.hypot(bx - ax, bz - az) / .5);
      for (let n = 0; n <= count; n++) {
        const x = ax + (bx - ax) * n / count, z = az + (bz - az) * n / count;
        standing(`OG6 ${x}/${z}`, x, z);
        expect(inside(COURT, x, z, -config.radius), `OG6 left the court at ${x}/${z}`).toBe(true);
        samples++;
      }
    }
    expect(samples).toBeGreaterThanOrEqual(Math.ceil(10 / .5) + Math.ceil(Math.hypot(8, 8) / .5) + 2);
  });

  it('keeps P-OUTPOST’s cache volume and four use stands inside the refuge within reach and sight', () => {
    expect(inside(REFUGE, CACHE.x, CACHE.z, -.5)).toBe(true);
    expect(blockedAt(CACHE.x, CACHE.z, .5, 8, 0, 1.2, world.boxes), 'cache volume').toBe(false);
    expect(supportUnder(CACHE.x, CACHE.z, .5, 8.01, world.boxes, 0)).toBeCloseTo(8, 6);
    for (const [x, z] of CACHE_USES) {
      expect(blockedAt(x, z, config.radius, 8, .05, config.height, world.boxes), `use stand ${x}/${z}`).toBe(false);
      expect(supportUnder(x, z, config.radius, 8.01, world.boxes, 0)).toBeCloseTo(8, 6);
      expect(Math.hypot(x - CACHE.x, z - CACHE.z)).toBeLessThanOrEqual(2);
      expect(first({ x, y: 8 + rig.eyeHeight, z }, { ...CACHE, y: 9.2 }), `cache sight ${x}/${z}`).toBeNull();
    }
  });
});

describe('U-180 reserve and captive concealment from production cameras', () => {
  // Independent §8.2 captive sources: road, forecourt and south gate; the
  // three bays; X tank road; the basement. §9.3's reserve is also screened
  // from the ridge route and its R7/R8 descent, the side pads and B10, the
  // court and the north gate.
  const SCREENED = [[-18, 8, 302], [16, 8, 332], [10, 8, 322], [24, 8, 338], [34, 8, 346], [32, 8, 350], [32, 8, 354],
    [58, 20, 128], [88, 30, 210], [66, 26, 286],
    [96, 8, 444], [114, 8, 432], [112, 8, 386], [104, 8, 350], [84, 8, 338], [54, 8, 334],
    [-8, 0, 370], [-14, 0, 346], [30, 0, 270]].map(([x, y, z]) => p(x!, y!, z!));
  const SIDES = [p(86, 30, 248), p(72, 26, 286), p(70, 20, 322), p(70, 12, 350), p(2, 8, 376), p(5, 8, 374), p(59, 8, 374), p(59, 8, 371)];
  const COURTSIDE = [p(32, 8, 410), ...[12, 20, 28, 36, 44, 52].map((x) => p(x, 8, 408)), p(44, 8, 380), p(24, 8, 374), p(40, 8, 362)];
  const reserveBodies = RESERVE.flatMap(([, x, z]) => [.2, 1, 1.75].map((h) => p(x, 8 + h, z)));
  // carry-1 (12,400) lies on the line through the aligned antechamber east
  // and cell south doors; raised cameras at X4, R8 and the east pad reach it
  // over the y14 wall. That captive screening is recorded as a U-177 input.
  const EXPOSED = [12, 400] as const;
  const captives = HOLDING.filter(([x, z]) => x !== EXPOSED[0] || z !== EXPOSED[1]).flatMap(([x, z]) => [.15, .8, 1.6].map((h) => p(x, 8 + h, z)));
  const carry1 = [.15, .8, 1.6].map((h) => p(EXPOSED[0], 8 + h, EXPOSED[1]));

  function scenery(at: Point, reach: number) {
    const material = new THREE.MeshBasicMaterial({ visible: false });
    const boxes = region(at.x - reach, at.x + reach, at.z - reach, at.z + reach);
    const objects: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = boxes.map((b) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ), material);
      mesh.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
      mesh.updateMatrixWorld(); return mesh;
    });
    return { boxes, objects, dispose() { for (const o of objects) o.geometry.dispose(); material.dispose(); } };
  }

  it('solves every desktop and mobile camera at each approach and finds no line to the reserve, the POW or four captives', () => {
    let cameras = 0, rays = 0, shortened = 0, carry1Views = 0;
    for (const [observerSet, targets] of [[SCREENED, [...reserveBodies, ...captives]], [[...SIDES, ...COURTSIDE], reserveBodies]] as const) for (const at of observerSet) {
      expect(blockedAt(at.x, at.z, config.radius, at.y, .05, config.height, world.boxes), `observer ${JSON.stringify(at)}`).toBe(false);
      expect(supportUnder(at.x, at.z, config.radius, at.y + .01, world.boxes, -100), `observer floor ${JSON.stringify(at)}`).toBeCloseTo(at.y, 6);
      const scene = scenery(at, 30);
      try {
        const collider = createSceneCollider(scene.objects);
        const check = (camera: Point, label: string) => {
          // A camera inside solid would see through it: reject that too.
          const inSolid = scene.boxes.some((b) => camera.x > b.minX + 1e-7 && camera.x < b.maxX - 1e-7
            && camera.y > b.minY + 1e-7 && camera.y < b.maxY - 1e-7 && camera.z > b.minZ + 1e-7 && camera.z < b.maxZ - 1e-7);
          expect(inSolid, `${label}: camera inside solid ${JSON.stringify(camera)}`).toBe(false);
          for (const target of targets) {
            expect(blocked(between(camera, target)), `${label}: sees ${JSON.stringify(target)} from ${JSON.stringify(camera)}`).toBe(true);
            rays++;
          }
          if (targets.length > reserveBodies.length && carry1.some((t) => !blocked(between(camera, t)))) carry1Views++;
          cameras++;
        };
        for (const h of [rig.crouchEyeHeight, rig.eyeHeight]) check(eyeOf(at, h), `weapon eye ${JSON.stringify(at)}`);
        for (const yawWire of [0, 256, 512, 768]) for (const degrees of [-75, -55, -35, 0, 35, 55, 75]) {
          const view = { ...at, yawWire, pitchWire: degrees * 1024 / 360, pitchFraction: degrees / 89,
            ads: false, firstPerson: false, shoulderSide: 1 as const };
          const free = solveCamera(view, DEFAULT_CAMERA_CONFIG, createCameraSolve());
          const solved = solveCamera(view, DEFAULT_CAMERA_CONFIG, createCameraSolve(), 1 / 60, collider);
          shortened += solved.distance < free.distance ? 1 : 0;
          check(solved.position, `desktop ${JSON.stringify(at)} ${yawWire}/${degrees}`);
        }
        for (let yaw = 0; yaw < 2 * Math.PI - 1e-9; yaw += Math.PI / 4) for (const pitch of [-1.15, -.8, -.35, 0, .15])
          for (const distance of [MOBILE_CAMERA_MIN, mobileCameraMax(false), mobileCameraMax(true)]) {
            const solved = mobileOrbit(at, yaw, pitch, distance, 0, collider);
            check(solved.position, `mobile ${JSON.stringify(at)} ${yaw.toFixed(2)}/${pitch}/${distance}`);
          }
      } finally { scene.dispose(); }
    }
    expect(shortened).toBeGreaterThan(0);
    console.log('U-180 camera concealment', JSON.stringify({ observers: SCREENED.length + SIDES.length + COURTSIDE.length, cameras, rays,
      desktopArmsShortened: shortened, u177Carry1ViewsFromScreenedSources: carry1Views }));
  }, 240_000);
});
