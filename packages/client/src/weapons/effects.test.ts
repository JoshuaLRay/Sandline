/**
 * T-2.10. The pool is the point: a held trigger must not grow the scene, and
 * everything must be gone within a bound derived from the numbers.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WORLD, rayWorld, surfaceAt } from '@sandline/shared';
import {
  DECAL_FADE_SECONDS,
  DECAL_OFFSET_M,
  DECAL_SECONDS,
  FLASH_FORWARD_M,
  FLINCH_PARTS,
  FLINCH_SECONDS,
  IMPACT_POOL,
  SPARKS_PER_IMPACT,
  SPARK_SECONDS,
  FLASH_LIGHT_INTENSITY,
  FLASH_POOL,
  FLASH_SECONDS,
  GRAVITY_M_S2,
  SHELL_FADE_SECONDS,
  SHELL_POOL,
  SHELL_REST_SECONDS,
  SHELL_SIZE_M,
  REACTION_SECONDS,
  BLAST_DEBRIS,
  BLAST_DEBRIS_SECONDS,
  BLAST_FLASH_SECONDS,
  BLAST_POOL,
  SCORCH_SECONDS,
  WeaponEffects,
  debrisVelocities,
  ejectVelocity,
  flightSeconds,
  shellLifetimeSeconds,
  sparkVelocities,
} from './effects.ts';
import { createHumanoidPlaceholder } from '../character/humanoidPlaceholder.ts';
import { createHumanoidSoldier } from '../character/humanoidSoldier.ts';
import { HUMANOID_BONES, requireRig, type HumanoidRig } from '../character/humanoidRig.ts';
import { hitReactionFrom, shooterDirection } from '../character/hitReaction.ts';

/** Facing +Z: forward = (0, 0, 1), so right = (-1, 0, 0) and back = (0, 0, -1). */
const FWD_X = 0;
const FWD_Z = 1;
const MUZZLE = new THREE.Vector3(2, 1.42, 3);
const FLOOR_Y = 0;

function setup() {
  const scene = new THREE.Scene();
  const fx = new WeaponEffects(scene);
  return { scene, fx };
}

/** The scene's live children: what a renderer would actually draw. */
function visibleCount(scene: THREE.Scene): number {
  return scene.children.filter((o) => o.visible).length;
}

describe('a held trigger cannot leak the scene (T-2.10)', () => {
  it('five seconds at 20 shots a second ends with the pool at its cap and no object beyond it', () => {
    const { scene, fx } = setup();
    const objectsAtStart = scene.children.length;
    const seen = new Set<THREE.Object3D>(scene.children);
    const dt = 1 / 60;
    let now = 0;
    let shot = 0;
    let nextShot = 0;
    while (now < 5) {
      if (now >= nextShot) {
        shot += 1;
        fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, shot, now);
        nextShot += 0.05;
      }
      fx.update(now);
      for (const o of scene.children) seen.add(o);
      expect(scene.children.length).toBe(objectsAtStart);
      expect(fx.liveShells).toBeLessThanOrEqual(SHELL_POOL);
      expect(fx.liveFlashes).toBeLessThanOrEqual(FLASH_POOL);
      now += dt;
    }
    expect(shot).toBe(100);
    // Saturated: a shell lives longer than the pool takes to fill at this rate.
    expect(fx.liveShells).toBe(SHELL_POOL);
    // Every object the scene ever held was there before the first shot.
    expect(seen.size).toBe(objectsAtStart);
  });

  it('returns to zero within the derived lifetime after release', () => {
    const { scene, fx } = setup();
    let now = 0;
    for (let shot = 1; shot <= 100; shot += 1) {
      fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, shot, now);
      fx.update(now);
      now += 0.05;
    }
    const released = now;
    const bound = shellLifetimeSeconds(MUZZLE.y - FLOOR_Y);
    // Halfway through the bound, shells are still lying there.
    while (now < released + bound / 2) {
      fx.update(now);
      now += 1 / 60;
    }
    expect(fx.liveShells).toBeGreaterThan(0);
    while (now <= released + bound + 1 / 60) {
      fx.update(now);
      now += 1 / 60;
    }
    expect(fx.liveShells).toBe(0);
    expect(fx.liveFlashes).toBe(0);
    expect(visibleCount(scene)).toBe(0);
  });

  it('a full pool recycles the oldest shell rather than dropping the new one', () => {
    const { fx } = setup();
    // Births half a second apart: further than any two lifetimes differ.
    for (let shot = 1; shot <= SHELL_POOL; shot += 1) fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, shot, shot * 0.5);
    expect(fx.liveShells).toBe(SHELL_POOL);
    fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, SHELL_POOL + 1, (SHELL_POOL + 1) * 0.5);
    expect(fx.liveShells).toBe(SHELL_POOL);
    // Past the first shell's longest possible life, before the second's
    // shortest: had the first survived it would retire here. It was recycled
    // instead, so the count holds at the cap.
    const longest = shellLifetimeSeconds(MUZZLE.y - FLOOR_Y);
    fx.update(0.5 + longest + 0.01);
    expect(fx.liveShells).toBe(SHELL_POOL);
    // And the second goes on schedule.
    fx.update(1.0 + longest + 0.01);
    expect(fx.liveShells).toBe(SHELL_POOL - 1);
  });
});

describe('muzzle flash (T-2.10)', () => {
  it('appears just ahead of the muzzle, lit, and is gone after two frames', () => {
    const { scene, fx } = setup();
    fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, 1, 1);
    fx.update(1);
    expect(fx.liveFlashes).toBe(1);
    const light = scene.children.find((o): o is THREE.PointLight => o instanceof THREE.PointLight && o.visible);
    const sprite = scene.children.find((o): o is THREE.Sprite => o instanceof THREE.Sprite && o.visible);
    expect(light).toBeDefined();
    expect(sprite).toBeDefined();
    if (!light || !sprite) return;
    expect(sprite.position.x).toBeCloseTo(MUZZLE.x, 12);
    expect(sprite.position.y).toBeCloseTo(MUZZLE.y, 12);
    expect(sprite.position.z).toBeCloseTo(MUZZLE.z + FLASH_FORWARD_M, 12);
    expect(light.intensity).toBe(FLASH_LIGHT_INTENSITY);

    fx.update(1 + FLASH_SECONDS / 2);
    expect(light.intensity).toBeCloseTo(FLASH_LIGHT_INTENSITY / 2, 9);
    fx.update(1 + FLASH_SECONDS);
    expect(fx.liveFlashes).toBe(0);
    expect(light.visible).toBe(false);
    expect(sprite.visible).toBe(false);
  });

  it('gives each shot its own flash rather than restarting one', () => {
    const { fx } = setup();
    fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, 1, 0);
    fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, 2, FLASH_SECONDS / 2);
    fx.update(FLASH_SECONDS / 2);
    expect(fx.liveFlashes).toBe(2);
  });

  it('rides the drawn muzzle for its whole life, however far that moves (B-02)', () => {
    const { scene, fx } = setup();
    fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, 1, 0);
    const sprite = scene.children.find((o): o is THREE.Sprite => o instanceof THREE.Sprite && o.visible);
    const light = scene.children.find((o): o is THREE.PointLight => o instanceof THREE.PointLight && o.visible);
    expect(sprite).toBeDefined();
    expect(light).toBeDefined();
    if (!sprite || !light) return;
    // Running backward at 4 m/s, a frame at a time: a flash left where the
    // shot put it would drift ahead of the eye by the distance run, out past
    // the near plane and into view. It must stay exactly FLASH_FORWARD_M on.
    for (let frame = 1; frame * (1 / 60) < FLASH_SECONDS; frame += 1) {
      const drawn = { x: MUZZLE.x, y: MUZZLE.y, z: MUZZLE.z - (4 * frame) / 60 };
      fx.followMuzzle(drawn, FWD_X, FWD_Z);
      fx.update(frame / 60);
      expect(sprite.position.z - drawn.z).toBeCloseTo(FLASH_FORWARD_M, 12);
      expect(sprite.position.x).toBeCloseTo(drawn.x, 12);
      expect(light.position.equals(sprite.position)).toBe(true);
    }
    // Turning carries it round too.
    fx.followMuzzle(MUZZLE, 1, 0);
    expect(sprite.position.x).toBeCloseTo(MUZZLE.x + FLASH_FORWARD_M, 12);
    expect(sprite.position.z).toBeCloseTo(MUZZLE.z, 12);
  });

  it('leaves a retired flash where it was: following touches only live ones', () => {
    const { scene, fx } = setup();
    fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, 1, 0);
    fx.update(FLASH_SECONDS);
    const sprite = scene.children.find((o): o is THREE.Sprite => o instanceof THREE.Sprite);
    if (!sprite) throw new Error('no flash sprite in the pool');
    const before = sprite.position.clone();
    fx.followMuzzle({ x: 50, y: 1, z: 50 }, FWD_X, FWD_Z);
    expect(sprite.position.equals(before)).toBe(true);
    expect(sprite.visible).toBe(false);
  });
});

describe('shell ejection (T-2.10)', () => {
  it('throws the shell right and back of the muzzle, and upward', () => {
    for (let shot = 1; shot <= 40; shot += 1) {
      const v = ejectVelocity(FWD_X, FWD_Z, shot);
      // right is (-1, 0, 0); back is (0, 0, -1).
      expect(v.x).toBeLessThan(0);
      expect(v.z).toBeLessThan(0);
      expect(v.y).toBeGreaterThan(0);
    }
    // And it follows the facing: turned to +X, right is +Z.
    const turned = ejectVelocity(1, 0, 3);
    expect(turned.z).toBeGreaterThan(0);
    expect(turned.x).toBeLessThan(0);
  });

  it('is the same throw every time and not the same for every shot', () => {
    expect(ejectVelocity(FWD_X, FWD_Z, 7)).toEqual(ejectVelocity(FWD_X, FWD_Z, 7));
    expect(ejectVelocity(FWD_X, FWD_Z, 7)).not.toEqual(ejectVelocity(FWD_X, FWD_Z, 8));
  });

  it('carries the shooter\'s own velocity, so a shooter cannot overtake their brass (B-02)', () => {
    const { scene, fx } = setup();
    // Running straight backward at 4 m/s — faster than the throw's own back.
    const carrier = { x: 0, y: 0, z: -4 };
    fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, 1, 0, carrier);
    const v = ejectVelocity(FWD_X, FWD_Z, 1);
    const shell = scene.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.visible);
    if (!shell) throw new Error('no shell');
    const t = 0.05;
    fx.update(t);
    expect(shell.position.x).toBeCloseTo(MUZZLE.x + v.x * t, 12);
    expect(shell.position.z).toBeCloseTo(MUZZLE.z + (v.z + carrier.z) * t, 12);
    // Relative to the shooter, still thrown back of the muzzle: never ahead of it.
    expect(shell.position.z).toBeLessThan(MUZZLE.z + carrier.z * t);
    // Vertical is the throw's alone: the carrier's y is ignored, the arc is unchanged.
    expect(shell.position.y).toBeCloseTo(MUZZLE.y + v.y * t - 0.5 * GRAVITY_M_S2 * t * t, 12);
  });

  it('follows the closed-form arc and lands exactly when the formula says', () => {
    const { scene, fx } = setup();
    fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, 1, 0);
    const v = ejectVelocity(FWD_X, FWD_Z, 1);
    const shell = scene.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.visible);
    expect(shell).toBeDefined();
    if (!shell) return;
    const restY = FLOOR_Y + SHELL_SIZE_M.y / 2;
    const flight = flightSeconds(v.y, MUZZLE.y - restY);

    const t = flight / 2;
    fx.update(t);
    expect(shell.position.x).toBeCloseTo(MUZZLE.x + v.x * t, 12);
    expect(shell.position.y).toBeCloseTo(MUZZLE.y + v.y * t - 0.5 * GRAVITY_M_S2 * t * t, 12);
    expect(shell.position.z).toBeCloseTo(MUZZLE.z + v.z * t, 12);
    expect(shell.position.y).toBeGreaterThan(restY);

    fx.update(flight + 1e-9);
    expect(shell.position.y).toBeCloseTo(restY, 12);
    // The arc's own height at the landing time is the floor: the two agree.
    expect(MUZZLE.y + v.y * flight - 0.5 * GRAVITY_M_S2 * flight * flight).toBeCloseTo(restY, 9);
    // Then it stays put through the rest.
    fx.update(flight + SHELL_REST_SECONDS / 2);
    expect(shell.position.y).toBeCloseTo(restY, 12);
    expect(shell.position.x).toBeCloseTo(MUZZLE.x + v.x * flight, 12);
    expect(shell.material).toHaveProperty('opacity', 1);
  });

  it('fades after resting and retires at the end of the fade, at any frame rate', () => {
    const v = ejectVelocity(FWD_X, FWD_Z, 1);
    const flight = flightSeconds(v.y, MUZZLE.y - SHELL_SIZE_M.y / 2);
    for (const fps of [30, 120]) {
      const { scene, fx } = setup();
      fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, 1, 0);
      const shell = scene.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.visible);
      if (!shell) throw new Error('no shell');
      const material = shell.material as THREE.MeshBasicMaterial;
      let now = 0;
      const midFade = flight + SHELL_REST_SECONDS + SHELL_FADE_SECONDS / 2;
      while (now < midFade) {
        now += 1 / fps;
        fx.update(now);
      }
      expect(material.opacity).toBeGreaterThan(0.3);
      expect(material.opacity).toBeLessThan(0.7);
      while (now < flight + SHELL_REST_SECONDS + SHELL_FADE_SECONDS) {
        now += 1 / fps;
        fx.update(now);
      }
      expect(fx.liveShells).toBe(0);
    }
  });

  it('places the shell identically at 30 and 120 fps because the arc is closed-form', () => {
    const at = (fps: number): THREE.Vector3 => {
      const { scene, fx } = setup();
      fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, 5, 0);
      const shell = scene.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.visible);
      if (!shell) throw new Error('no shell');
      let now = 0;
      for (let i = 0; i < fps * 0.3; i += 1) {
        now += 1 / fps;
        fx.update(now);
      }
      return shell.position.clone();
    };
    const a = at(30);
    const b = at(120);
    // Both end at t = 0.3 s within float error, so the positions agree.
    expect(a.distanceTo(b)).toBeLessThan(1e-9);
  });

  it('derives the lifetime bound from the throw, the rest and the fade', () => {
    const bound = shellLifetimeSeconds(1.42);
    expect(bound).toBeGreaterThan(SHELL_REST_SECONDS + SHELL_FADE_SECONDS);
    expect(bound).toBeLessThan(SHELL_REST_SECONDS + SHELL_FADE_SECONDS + 1);
    expect(flightSeconds(0, 0)).toBe(0);
    // Straight drop from 1 m: sqrt(2h/g).
    expect(flightSeconds(0, 1)).toBeCloseTo(Math.sqrt(2 / GRAVITY_M_S2), 12);
  });

  it('reset hides everything without freeing the pool', () => {
    const { scene, fx } = setup();
    const before = scene.children.length;
    for (let shot = 1; shot <= 5; shot += 1) fx.fire(MUZZLE, FWD_X, FWD_Z, FLOOR_Y, shot, 0);
    fx.reset();
    expect(fx.liveShells).toBe(0);
    expect(fx.liveFlashes).toBe(0);
    expect(visibleCount(scene)).toBe(0);
    expect(scene.children.length).toBe(before);
  });
});

describe('impacts land at the server\'s point (T-2.11)', () => {
  /** The spawn line at eye height, aiming at the doorway wall's south face. */
  const eye = { x: 0, y: 1.55, z: -6 };
  const wall = DEFAULT_WORLD.find((b) => b.id === 'west-wall-b');
  if (!wall) throw new Error('fixture: west-wall-b missing');
  const towards = (x: number, y: number, z: number) => {
    const dx = x - eye.x;
    const dy = y - eye.y;
    const dz = z - eye.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return { x: dx / len, y: dy / len, z: dz / len };
  };
  const decals = (scene: THREE.Scene) =>
    scene.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.visible && o.geometry instanceof THREE.PlaneGeometry);

  it('puts a mark on the doorway wall exactly where the server said, every shot', () => {
    const { scene, fx } = setup();
    for (let i = 0; i < 20; i += 1) {
      // Sweep the face just east of the doorway (x -7.6 .. -6.4): clear of the
      // reference figure at x -4.5, which shadows the wall's east end from here.
      const aimX = -7.6 + (i / 19) * 1.2;
      const aimY = 0.3 + (i % 5) * 0.45;
      const hit = rayWorld({ origin: eye, direction: towards(aimX, aimY, wall.minZ), maxDistance: 100 }, DEFAULT_WORLD);
      if (!hit) throw new Error('the sweep must hit the wall');
      const surface = surfaceAt(hit.point, DEFAULT_WORLD);
      if (!surface) throw new Error('the point must lie on a face');
      fx.reset();
      fx.impact(hit.point, surface.normal, i);
      fx.update(i);
      const [decal] = decals(scene);
      expect(decal).toBeDefined();
      if (!decal) return;
      // Lifted off the face along its normal, and no further.
      expect(decal.position.x).toBeCloseTo(hit.point.x, 9);
      expect(decal.position.y).toBeCloseTo(hit.point.y, 9);
      expect(decal.position.z).toBeCloseTo(hit.point.z - DECAL_OFFSET_M, 9);
      // Turned to face out of the wall: the quad's +Z is the normal.
      const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(decal.quaternion);
      expect(facing.distanceTo(new THREE.Vector3(0, 0, -1))).toBeLessThan(1e-9);
    }
  });

  it('draws nothing for a max-range miss: the server\'s point is on no face', () => {
    const miss = towards(0, 1.55, 40);
    const end = { x: eye.x + miss.x * 100, y: eye.y + miss.y * 100, z: eye.z + miss.z * 100 };
    // The caller's rule: no surface, no impact. The predicted tracer would
    // have ended on the client's ground or a target; neither is asked.
    expect(surfaceAt(end, DEFAULT_WORLD)).toBeNull();
  });

  it('sparks leave the face along its normal and fall; the mark outlives them and fades on schedule', () => {
    const { scene, fx } = setup();
    const point = { x: -6, y: 1, z: wall.minZ };
    fx.impact(point, { x: 0, y: 0, z: -1 }, 0);
    fx.update(0);
    const sparks = scene.children.find((o): o is THREE.Points => o instanceof THREE.Points && o.visible);
    const [decal] = decals(scene);
    if (!sparks || !decal) throw new Error('impact not drawn');
    const velocities = new Float32Array(SPARKS_PER_IMPACT * 3);
    sparkVelocities({ x: 0, y: 0, z: -1 }, 1, velocities);
    const at = (t: number, i: number) => {
      fx.update(t);
      const a = sparks.geometry.getAttribute('position').array as Float32Array;
      return { x: a[i * 3] as number, y: a[i * 3 + 1] as number, z: a[i * 3 + 2] as number };
    };
    for (let i = 0; i < SPARKS_PER_IMPACT; i += 1) {
      // Every spark starts at the point and moves OUT of the wall (-Z here).
      const start = at(0, i);
      expect(start.z).toBeCloseTo(point.z, 5);
      const later = at(SPARK_SECONDS / 2, i);
      expect(later.z).toBeLessThan(point.z);
      // On the closed-form arc: x and z linear, y under gravity.
      const t = SPARK_SECONDS / 2;
      expect(later.x).toBeCloseTo(point.x + (velocities[i * 3] as number) * t, 4);
      expect(later.y).toBeCloseTo(point.y + (velocities[i * 3 + 1] as number) * t - 0.5 * GRAVITY_M_S2 * t * t, 4);
    }
    fx.update(SPARK_SECONDS);
    expect(sparks.visible).toBe(false);
    expect(decal.visible).toBe(true);
    fx.update(DECAL_SECONDS - DECAL_FADE_SECONDS / 2);
    expect((decal.material as THREE.MeshBasicMaterial).opacity).toBeLessThan(0.85);
    expect((decal.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0);
    fx.update(DECAL_SECONDS);
    expect(decal.visible).toBe(false);
    expect(fx.liveImpacts).toBe(0);
  });

  it('stays capped under a held trigger and leaves the scene\'s object set unchanged', () => {
    const { scene, fx } = setup();
    const objectsAtStart = scene.children.length;
    let now = 0;
    for (let i = 1; i <= 100; i += 1) {
      fx.impact({ x: -6 + (i % 7) * 0.1, y: 1, z: wall.minZ }, { x: 0, y: 0, z: -1 }, now);
      fx.update(now);
      expect(scene.children.length).toBe(objectsAtStart);
      expect(fx.liveImpacts).toBeLessThanOrEqual(IMPACT_POOL);
      now += 0.05;
    }
    expect(fx.liveImpacts).toBe(IMPACT_POOL);
    fx.update(now + DECAL_SECONDS);
    expect(fx.liveImpacts).toBe(0);
    expect(visibleCount(scene)).toBe(0);
  });
});

describe('a hit soldier flinches (T-2.11)', () => {
  it('jerks the upper body back and returns it to exactly where it was', () => {
    const { fx } = setup();
    const soldier = createHumanoidPlaceholder('remote');
    const rest = new Map(soldier.children.map((c) => [c.name, c.position.z]));
    fx.flinch(soldier, 1);
    expect(fx.liveFlinches).toBe(1);
    fx.update(1 + FLINCH_SECONDS / 3);
    for (const part of soldier.children) {
      const base = rest.get(part.name) as number;
      if (FLINCH_PARTS.includes(part.name)) expect(part.position.z).toBeLessThan(base);
      else expect(part.position.z).toBe(base);
    }
    // A hair past the end: 1 + 0.18 - 1 is a float short of 0.18.
    fx.update(1 + FLINCH_SECONDS + 1e-9);
    expect(fx.liveFlinches).toBe(0);
    for (const part of soldier.children) expect(part.position.z).toBe(rest.get(part.name));
  });

  it('a second hit mid-flinch restarts it without drifting the resting pose', () => {
    const { fx } = setup();
    const soldier = createHumanoidPlaceholder('remote');
    const torso = soldier.children.find((c) => c.name === 'torso');
    if (!torso) throw new Error('no torso');
    const base = torso.position.z;
    fx.flinch(soldier, 0);
    fx.update(FLINCH_SECONDS / 2);
    fx.flinch(soldier, FLINCH_SECONDS / 2);
    fx.update(FLINCH_SECONDS / 2 + FLINCH_SECONDS / 3);
    expect(torso.position.z).toBeLessThan(base);
    fx.update(FLINCH_SECONDS / 2 + FLINCH_SECONDS + 1e-9);
    expect(torso.position.z).toBe(base);
    expect(fx.liveFlinches).toBe(0);
  });
});

describe('the rig takes its own hit reaction (T-2.27)', () => {
  const boneBits = (rig: HumanoidRig): string => JSON.stringify(
    HUMANOID_BONES.map((name) => rig.bone(name)?.quaternion.toArray() ?? null),
  );
  /** A round from the soldier's left, in the head. */
  const headshot = hitReactionFrom(50, 'head', shooterDirection(5, 0, 0));

  it('turns the body instead of translating it, and recovers to the pose exactly', () => {
    const { fx } = setup();
    const soldier = createHumanoidSoldier('remote');
    const rig = requireRig(soldier);
    const rest = boneBits(rig);

    fx.flinch(soldier, 1, headshot);
    expect(fx.liveFlinches).toBe(1);
    fx.update(1 + REACTION_SECONDS / 4);
    expect(boneBits(rig)).not.toBe(rest);
    // A reaction in bones: nothing is jerked back along local -Z (T-2.11).
    for (const name of HUMANOID_BONES) {
      const bone = rig.bone(name);
      const base = rig.base(name);
      if (bone && base) expect(bone.position.toArray()).toEqual(base.position);
    }

    fx.update(1 + REACTION_SECONDS + 1e-9);
    expect(fx.liveFlinches).toBe(0);
    expect(boneBits(rig)).toBe(rest);
  });

  it('a second hit restarts the reaction on the new round, without drifting the pose', () => {
    const { fx } = setup();
    const soldier = createHumanoidSoldier('remote');
    const rig = requireRig(soldier);
    const rest = boneBits(rig);
    const fromRight = hitReactionFrom(50, 'torso', shooterDirection(-5, 0, 0));

    fx.flinch(soldier, 0, headshot);
    fx.update(REACTION_SECONDS / 2);
    fx.flinch(soldier, REACTION_SECONDS / 2, fromRight);
    fx.update(REACTION_SECONDS / 2 + REACTION_SECONDS / 4);
    expect(boneBits(rig)).not.toBe(rest);
    // The newest round is the whole reaction: a torso hit leaves the head bone.
    expect(rig.bone('head')?.quaternion.toArray()).toEqual(rig.base('head')?.quaternion);

    fx.update(REACTION_SECONDS / 2 + REACTION_SECONDS + 1e-9);
    expect(fx.liveFlinches).toBe(0);
    expect(boneBits(rig)).toBe(rest);
  });

  it('a downed soldier does not react, and reset hands the bones back', () => {
    const { fx } = setup();
    const soldier = createHumanoidSoldier('remote');
    const rig = requireRig(soldier);
    rig.setPose('downed');
    const down = boneBits(rig);

    fx.flinch(soldier, 0, headshot);
    fx.update(REACTION_SECONDS / 4);
    expect(boneBits(rig)).toBe(down);

    rig.setPose('standing');
    const up = boneBits(rig);
    fx.flinch(soldier, 1, headshot);
    fx.update(1 + REACTION_SECONDS / 4);
    expect(boneBits(rig)).not.toBe(up);
    fx.reset();
    expect(fx.liveFlinches).toBe(0);
    expect(boneBits(rig)).toBe(up);
  });
});

describe('blasts (T-2.33)', () => {
  const BLAST_RADIUS_M = 6;
  const point = { x: 2, y: 0.3, z: -4 };

  it('never grows the scene, however many go off', () => {
    const scene = new THREE.Scene();
    const effects = new WeaponEffects(scene);
    const before = scene.children.length;
    for (let i = 0; i < BLAST_POOL * 3; i += 1) {
      effects.blast({ x: i, y: 0.3, z: 0 }, BLAST_RADIUS_M, 0, i * 0.05);
    }
    expect(scene.children.length).toBe(before);
    expect(effects.liveBlasts).toBe(BLAST_POOL);
  });

  it('is gone by the end of the scorch, and not before', () => {
    const scene = new THREE.Scene();
    const effects = new WeaponEffects(scene);
    effects.blast(point, BLAST_RADIUS_M, 0, 0);
    effects.update(BLAST_FLASH_SECONDS + 0.01);
    expect(effects.liveBlasts).toBe(1);
    effects.update(SCORCH_SECONDS - 0.01);
    expect(effects.liveBlasts).toBe(1);
    effects.update(SCORCH_SECONDS);
    expect(effects.liveBlasts).toBe(0);
  });

  it('draws the same picture at any frame rate: everything is a function of age', () => {
    const slow = new WeaponEffects(new THREE.Scene());
    const fast = new WeaponEffects(new THREE.Scene());
    slow.blast(point, BLAST_RADIUS_M, 0, 0);
    fast.blast(point, BLAST_RADIUS_M, 0, 0);
    // 30 fps against 120 fps, up to the same moment.
    for (let t = 1 / 30; t <= 0.2 + 1e-9; t += 1 / 30) slow.update(t);
    for (let t = 1 / 120; t <= 0.2 + 1e-9; t += 1 / 120) fast.update(t);
    const debrisOf = (fx: WeaponEffects) => {
      const points = (fx as unknown as { blasts: { debris: THREE.Points }[] }).blasts[0]?.debris;
      return Array.from(((points?.geometry.getAttribute('position') as THREE.BufferAttribute).array) as Float32Array);
    };
    expect(debrisOf(fast)).toEqual(debrisOf(slow));
  });

  it('leaves no ring when there is nothing under it to mark', () => {
    const scene = new THREE.Scene();
    const effects = new WeaponEffects(scene);
    effects.blast(point, BLAST_RADIUS_M, null, 0);
    const scorch = (effects as unknown as { blasts: { scorch: THREE.Mesh }[] }).blasts[0]?.scorch;
    expect(scorch?.visible).toBe(false);
  });

  it('throws the same debris for the same blast, and different for the next', () => {
    const a = new Float32Array(BLAST_DEBRIS * 3);
    const b = new Float32Array(BLAST_DEBRIS * 3);
    const c = new Float32Array(BLAST_DEBRIS * 3);
    debrisVelocities(7, a);
    debrisVelocities(7, b);
    debrisVelocities(8, c);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
    // Spread, and biased upward: nothing goes straight down.
    for (let i = 0; i < BLAST_DEBRIS; i += 1) expect(a[i * 3 + 1] as number).toBeGreaterThan(0);
  });

  it('flies its debris on the same arc a shell flies', () => {
    const scene = new THREE.Scene();
    const effects = new WeaponEffects(scene);
    effects.blast(point, BLAST_RADIUS_M, 0, 0);
    const velocities = (effects as unknown as { blasts: { velocities: Float32Array }[] }).blasts[0]?.velocities as Float32Array;
    const t = BLAST_DEBRIS_SECONDS / 2;
    effects.update(t);
    const positions = (effects as unknown as { blasts: { positions: THREE.BufferAttribute }[] }).blasts[0]
      ?.positions.array as Float32Array;
    expect(positions[1] as number).toBeCloseTo(
      point.y + (velocities[1] as number) * t - 0.5 * GRAVITY_M_S2 * t * t,
      6,
    );
  });
});
