/**
 * U-158: the rocket's smoke trail and launch flash — pooled, capped and a function of age, like `effects.ts`.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BACKBLAST_BEHIND_M,
  BACKBLAST_PUFFS,
  LAUNCH_FLASH_SECONDS,
  LAUNCH_POOL,
  POINT_SIZE_LINE,
  RocketEffects,
  TRAIL_JUMP_M,
  TRAIL_MAX_PER_FRAME,
  TRAIL_POOL,
  TRAIL_PUFF_SECONDS,
  TRAIL_SPACING_M,
  patchPointSize,
} from './rocketFx.ts';

const FRAME = 1 / 60;
const SPEED = 45;

function setup() {
  const scene = new THREE.Scene();
  const fx = new RocketEffects(scene);
  return { scene, fx };
}

/** Fly one rocket along +Z at the rocket's speed for `seconds`, a frame at a time. */
function fly(fx: RocketEffects, key: string, start: number, seconds: number, frame = FRAME, z0 = 0): number {
  let now = start;
  for (let t = 0; t <= seconds + 1e-9; t += frame) {
    fx.follow(key, { x: 0, y: 1.5, z: z0 + SPEED * t }, now);
    fx.update(now);
    now += frame;
  }
  return now;
}

function livePuffs(fx: RocketEffects): ReturnType<RocketEffects['puffAt']>[] {
  return Array.from({ length: TRAIL_POOL }, (_, i) => fx.puffAt(i)).filter((p) => p.live);
}

describe('the smoke trail (U-158)', () => {
  it('is one draw call: every puff a vertex of one points cloud, made once and hidden until a rocket flies', () => {
    const { scene, fx } = setup();
    const before = scene.children.length;
    expect(fx.points.parent).toBe(scene);
    expect(fx.points.visible).toBe(false);
    expect(fx.points.geometry.getAttribute('position').count).toBe(TRAIL_POOL);
    // Four-component colour: a per-puff alpha.
    expect(fx.points.geometry.getAttribute('color').itemSize).toBe(4);
    fly(fx, 'p1', 0, 1);
    expect(fx.points.visible).toBe(true);
    expect(scene.children.length).toBe(before);
  });

  it('lays puffs at even spacing along the path, whatever the frame rate', () => {
    const fast = setup().fx;
    const slow = setup().fx;
    fly(fast, 'p1', 0, 0.5, 1 / 120);
    fly(slow, 'p1', 0, 0.5, 1 / 20);
    const zs = (fx: RocketEffects) => livePuffs(fx).map((p) => p.z).sort((a, b) => a - b);
    // Each puff drifts a little sideways and up with age, never along the path.
    const fastZ = zs(fast);
    const slowZ = zs(slow);
    expect(fastZ.length).toBe(slowZ.length);
    expect(fastZ.length).toBeGreaterThanOrEqual(Math.floor((SPEED * 0.5) / TRAIL_SPACING_M));
    for (let i = 1; i < fastZ.length; i += 1) expect((fastZ[i] as number) - (fastZ[i - 1] as number)).toBeCloseTo(TRAIL_SPACING_M, 0);
  });

  it('ages each puff from when the rocket passed it: the oldest are the biggest and the thinnest', () => {
    const { fx } = setup();
    fly(fx, 'p1', 0, 0.6);
    const puffs = livePuffs(fx).sort((a, b) => a.z - b.z);
    const oldest = puffs[0]!;
    const newest = puffs[puffs.length - 1]!;
    expect(oldest.size).toBeGreaterThan(newest.size);
    expect(oldest.alpha).toBeLessThan(newest.alpha);
    expect(oldest.y).toBeGreaterThan(newest.y);
  });

  it('is forgotten when the rocket lands, and its smoke thins out on its own', () => {
    const { fx } = setup();
    const now = fly(fx, 'p1', 0, 0.5);
    expect(fx.trails).toBe(1);
    fx.update(now);
    expect(fx.trails).toBe(0);
    expect(fx.livePuffs).toBeGreaterThan(0);
    fx.update(now + TRAIL_PUFF_SECONDS + 0.01);
    expect(fx.livePuffs).toBe(0);
    expect(fx.points.visible).toBe(false);
  });

  it('never claims more than the pool: a barrage reuses the oldest puffs', () => {
    const { fx } = setup();
    let now = 0;
    for (let t = 0; t < 2; t += FRAME) {
      for (let r = 0; r < 4; r += 1) fx.follow(`p${r}`, { x: r * 3, y: 1.5, z: SPEED * t }, now);
      fx.update(now);
      now += FRAME;
    }
    expect(fx.livePuffs).toBe(TRAIL_POOL);
    // The newest smoke is kept: the puffs alive are the last laid.
    const newest = Math.max(...livePuffs(fx).map((p) => p.z));
    expect(newest).toBeGreaterThan(SPEED * 1.9);
  });

  it('draws no smoke across a jump, and lays at most a capped number in one frame', () => {
    const { fx } = setup();
    fx.follow('p1', { x: 0, y: 1, z: 0 }, 0);
    fx.follow('p1', { x: 0, y: 1, z: TRAIL_JUMP_M + 1 }, 0.1);
    fx.update(0.1);
    expect(fx.livePuffs).toBe(1);
    fx.follow('p1', { x: 0, y: 1, z: TRAIL_JUMP_M + 1 + TRAIL_JUMP_M * 0.99 }, 0.2);
    fx.update(0.2);
    expect(fx.livePuffs).toBe(1 + Math.min(TRAIL_MAX_PER_FRAME, Math.floor((TRAIL_JUMP_M * 0.99) / TRAIL_SPACING_M)));
  });

  it('hides everything on reset', () => {
    const { fx } = setup();
    fly(fx, 'p1', 0, 0.5);
    fx.launch({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: 1 }, 0.5);
    fx.reset();
    expect(fx.livePuffs).toBe(0);
    expect(fx.liveLaunches).toBe(0);
    expect(fx.trails).toBe(0);
    expect(fx.points.visible).toBe(false);
  });

  it('sizes each puff on its own: three\'s points shader still has the line the patch rewrites', () => {
    const shader = THREE.ShaderLib.points.vertexShader;
    expect(shader).toContain(POINT_SIZE_LINE);
    const patched = patchPointSize(shader);
    expect(patched).toContain('attribute float puffSize;');
    expect(patched).toContain('gl_PointSize = size * puffSize;');
    expect(patched).not.toContain(POINT_SIZE_LINE);
    // A shader without the line is left alone (the puffs are one size, never missing).
    expect(patchPointSize('void main() {}')).toBe('void main() {}');
  });
});

describe('the launch (U-158)', () => {
  it('flashes at the muzzle and the tube\'s rear, throws backblast smoke behind, and is gone after the flash', () => {
    const { scene, fx } = setup();
    fx.launch({ x: 1, y: 1.6, z: 2 }, { x: 0, y: 0, z: 1 }, 10);
    fx.update(10);
    expect(fx.liveLaunches).toBe(1);
    const sprites = scene.children.filter((o): o is THREE.Sprite => o instanceof THREE.Sprite && o.visible);
    expect(sprites).toHaveLength(2);
    const [front, back] = [...sprites].sort((a, b) => b.position.z - a.position.z) as [THREE.Sprite, THREE.Sprite];
    expect(front.position.z).toBeGreaterThan(2);
    expect(back.position.z).toBeCloseTo(2 - BACKBLAST_BEHIND_M, 6);
    expect(fx.livePuffs).toBe(BACKBLAST_PUFFS);
    // Every backblast puff is behind the rear, none in front of the launcher.
    for (const p of livePuffs(fx)) expect(p.z).toBeLessThanOrEqual(2 - BACKBLAST_BEHIND_M + 0.3);
    fx.update(10 + LAUNCH_FLASH_SECONDS + 1e-6);
    expect(fx.liveLaunches).toBe(0);
    expect(scene.children.filter((o) => o instanceof THREE.Sprite && o.visible)).toHaveLength(0);
  });

  it('reuses the oldest flash when more launchers fire at once than the pool holds', () => {
    const { scene, fx } = setup();
    const before = scene.children.length;
    for (let i = 0; i < LAUNCH_POOL + 2; i += 1) fx.launch({ x: i, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, i * 0.01);
    expect(fx.liveLaunches).toBe(LAUNCH_POOL);
    expect(scene.children.length).toBe(before);
  });
});
