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
  HIT_FULL_DAMAGE,
  HIT_MIN_STRENGTH,
  HIT_RECOVERY_RATE,
  type HitDescription,
  hitReactionSeconds,
  hitStrength,
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
  WeaponEffects,
  ejectVelocity,
  flightSeconds,
  shellLifetimeSeconds,
  sparkVelocities,
} from './effects.ts';
import { createHumanoidPlaceholder } from '../character/humanoidPlaceholder.ts';
import { HUMANOID_BONES, type HumanoidRig, requireRig } from '../character/humanoidRig.ts';
import { HIT_TWIST_RAD, createHumanoidSoldier } from '../character/humanoidSoldier.ts';

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

/** T-2.27 fixtures: a soldier at the origin facing +Z, feet on the floor, 1.8 m tall. */
function skinned(): { root: THREE.Object3D; rig: HumanoidRig } {
  const root = createHumanoidSoldier('remote');
  root.position.set(0, 0.9, 0);
  return { root, rig: requireRig(root) };
}
function hitFrom(shooter: THREE.Vector3 | null, pointY: number, damage: number): HitDescription {
  return { shooter, point: { x: 0, y: pointY, z: 0 }, damage, feetY: 0, height: 1.8 };
}
function chestYaw(rig: HumanoidRig): number {
  const rest = new THREE.Quaternion().fromArray(requireRig(createHumanoidSoldier('remote')).bone('chest')!.quaternion.toArray());
  return new THREE.Euler().setFromQuaternion(rest.invert().multiply(rig.bone('chest')!.quaternion), 'YXZ').y;
}
function bones(rig: HumanoidRig) {
  return HUMANOID_BONES.map((name) => ({ name, p: rig.bone(name)!.position.toArray(), q: rig.bone(name)!.quaternion.toArray() }));
}
const LEFT = new THREE.Vector3(6, 1.2, 0);
const RIGHT = new THREE.Vector3(-6, 1.2, 0);

describe('a hit lands on the rig (T-2.27)', () => {
  it('turns the chest away from the shooter, by where they stand in the world', () => {
    const { fx } = setup();
    const { root, rig } = skinned();
    fx.flinch(root, 1, hitFrom(LEFT, 1.0, 20));
    expect(fx.liveReactions).toBe(1);
    expect(fx.liveFlinches).toBe(0);
    expect(chestYaw(rig)).toBeGreaterThan(0.05);
    fx.flinch(root, 1, hitFrom(RIGHT, 1.0, 20));
    expect(chestYaw(rig)).toBeLessThan(-0.05);
    // Turned to face +X, the same shooter is now behind and to the right;
    // one at world -Z is on the soldier's left.
    root.rotation.y = Math.PI / 2;
    fx.flinch(root, 1, hitFrom(new THREE.Vector3(0, 1.2, -6), 1.0, 20));
    expect(chestYaw(rig)).toBeGreaterThan(0.05);
    // An unknown shooter is taken to be in front: no twist, a lean back.
    fx.flinch(root, 1, hitFrom(null, 1.0, 20));
    expect(Math.abs(chestYaw(rig))).toBeLessThan(1e-9);
    expect(bones(rig)).not.toEqual(bones(skinned().rig));
  });

  it('snaps the head on a head-zone hit, by the height of the point against damage.json', () => {
    const { fx } = setup();
    const { root, rig } = skinned();
    const neckRest = rig.bone('neck')!.quaternion.toArray();
    // 1.0 of 1.8 m is the torso: the head rides the chest but the neck is untouched.
    fx.flinch(root, 1, hitFrom(LEFT, 1.0, 20));
    expect(rig.bone('neck')!.quaternion.toArray()).toEqual(neckRest);
    // 1.6 of 1.8 m is past the head's 0.78.
    fx.flinch(root, 1, hitFrom(LEFT, 1.6, 20));
    expect(rig.bone('neck')!.quaternion.toArray()).not.toEqual(neckRest);
  });

  it('is sized by the damage, floored so a graze still reads', () => {
    expect(hitStrength(HIT_FULL_DAMAGE)).toBe(1);
    expect(hitStrength(HIT_FULL_DAMAGE * 3)).toBe(1);
    expect(hitStrength(HIT_FULL_DAMAGE / 2)).toBeCloseTo(0.5, 12);
    expect(hitStrength(1)).toBe(HIT_MIN_STRENGTH);
    expect(hitStrength(0)).toBe(0);
    const { fx } = setup();
    const { root, rig } = skinned();
    fx.flinch(root, 1, hitFrom(LEFT, 1.0, HIT_FULL_DAMAGE));
    const full = chestYaw(rig);
    expect(full).toBeCloseTo(HIT_TWIST_RAD, 6);
    fx.flinch(root, 1, hitFrom(LEFT, 1.0, HIT_FULL_DAMAGE / 2));
    expect(chestYaw(rig)).toBeCloseTo(full / 2, 6);
  });

  it('recovers on the exponential, the same at 30 and 120 fps, and is exact when over', () => {
    for (const fps of [30, 120]) {
      const { fx } = setup();
      const { root, rig } = skinned();
      const rest = bones(rig);
      fx.flinch(root, 2, hitFrom(LEFT, 1.0, HIT_FULL_DAMAGE));
      const dt = 1 / fps;
      let now = 2;
      while (now + dt < 2 + hitReactionSeconds()) {
        now += dt;
        fx.update(now);
        expect(chestYaw(rig)).toBeCloseTo(HIT_TWIST_RAD * Math.exp(-HIT_RECOVERY_RATE * (now - 2)), 6);
        expect(fx.liveReactions).toBe(1);
      }
      fx.update(2 + hitReactionSeconds() + 1e-9);
      expect(fx.liveReactions).toBe(0);
      expect(bones(rig)).toEqual(rest);
    }
  });

  it('a second hit restarts it with its own direction, and the rest is exact after', () => {
    const { fx } = setup();
    const { root, rig } = skinned();
    const rest = bones(rig);
    fx.flinch(root, 0, hitFrom(LEFT, 1.0, HIT_FULL_DAMAGE));
    fx.update(0.1);
    const faded = chestYaw(rig);
    expect(faded).toBeLessThan(HIT_TWIST_RAD * 0.5);
    fx.flinch(root, 0.1, hitFrom(RIGHT, 1.0, HIT_FULL_DAMAGE));
    expect(chestYaw(rig)).toBeCloseTo(-HIT_TWIST_RAD, 6);
    expect(fx.liveReactions).toBe(1);
    fx.update(0.1 + hitReactionSeconds() / 2);
    expect(chestYaw(rig)).toBeLessThan(0);
    fx.update(0.1 + hitReactionSeconds() + 1e-9);
    expect(fx.liveReactions).toBe(0);
    expect(bones(rig)).toEqual(rest);
    // And withdrawn early by a reset.
    fx.flinch(root, 5, hitFrom(LEFT, 1.6, HIT_FULL_DAMAGE));
    fx.reset();
    expect(fx.liveReactions).toBe(0);
    expect(bones(rig)).toEqual(rest);
  });

  it('a downed soldier shows nothing', () => {
    const { fx } = setup();
    const { root, rig } = skinned();
    rig.setPose('downed');
    const downed = bones(rig);
    fx.flinch(root, 1, hitFrom(LEFT, 1.6, HIT_FULL_DAMAGE));
    expect(fx.liveReactions).toBe(0);
    expect(fx.liveFlinches).toBe(0);
    expect(bones(rig)).toEqual(downed);
  });

  it('the grey box keeps the translation flinch: the same call jerks it back and turns nothing', () => {
    const { fx } = setup();
    const soldier = createHumanoidPlaceholder('remote');
    soldier.position.set(0, 0.9, 0);
    const rest = soldier.children.map((c) => ({ name: c.name, z: c.position.z, q: c.quaternion.toArray() }));
    fx.flinch(soldier, 1, { shooter: LEFT, point: { x: 0, y: 1.6, z: 0 }, damage: HIT_FULL_DAMAGE, feetY: 0, height: 1.8 });
    expect(fx.liveReactions).toBe(0);
    expect(fx.liveFlinches).toBe(1);
    fx.update(1 + FLINCH_SECONDS / 3);
    for (const [i, part] of soldier.children.entries()) {
      expect(part.quaternion.toArray()).toEqual(rest[i]!.q);
      if (FLINCH_PARTS.includes(part.name)) expect(part.position.z).toBeLessThan(rest[i]!.z);
      else expect(part.position.z).toBe(rest[i]!.z);
    }
    fx.update(1 + FLINCH_SECONDS + 1e-9);
    expect(fx.liveFlinches).toBe(0);
    for (const [i, part] of soldier.children.entries()) expect(part.position.z).toBe(rest[i]!.z);
  });
});
