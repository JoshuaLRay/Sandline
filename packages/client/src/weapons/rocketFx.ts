/**
 * U-158: a rocket's smoke trail and the flash of its launch — the squad's rockets and the enemy's alike.
 *
 * POOLED AND CAPPED, like `effects.ts`. Every puff the trail can ever show is one vertex of ONE `THREE.Points`,
 * allocated here: a rocket in flight takes the next free puff, or the oldest when the pool is full, so a barrage
 * never allocates, never grows the scene and costs one draw call however many rockets fly (ADR-013's budget). The
 * launch flashes are a small pool of sprites and a light, as the muzzle flashes are.
 *
 * STATELESS PER PUFF. A puff is a point and a birth time; its place, size, colour and fade are closed forms of its
 * age, so 30 and 120 fps draw the same smoke. A trail is laid at even spacing along the path the rocket was drawn
 * on between two frames, each puff born at the moment the rocket passed it, so a low frame rate lays the same
 * trail rather than a dotted one.
 *
 * SEEDED, NOT RANDOM: each puff's wobble comes from its own count through `seedFrom`, as the shells' throws do.
 */
import * as THREE from 'three';
import { seedFrom, unitFromSeed } from '@sandline/shared';
import { flashTexture } from './effects.ts';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Puffs in the pool: two rockets' full trails at once, with room for their backblasts. */
export const TRAIL_POOL = 320;
/** Metres between puffs along a rocket's path: close enough that they overlap into one plume. */
export const TRAIL_SPACING_M = 0.4;
/** How long a puff hangs before it is gone, seconds. */
export const TRAIL_PUFF_SECONDS = 1.6;
/** A puff's size when laid and when it has spread (point-size units, about metres). */
export const TRAIL_SIZE = { from: 0.7, to: 2.6 } as const;
/** A fresh puff's opacity; it thins to nothing over its life. */
export const TRAIL_ALPHA = 0.55;
/** How fast the smoke drifts up, metres a second. */
export const TRAIL_RISE_M_S = 0.35;
/** The first fraction of a second a puff is the motor's flame, not its smoke. */
export const TRAIL_HOT_SECONDS = 0.07;
/** A rocket drawn further than this from its last frame jumped (a handover, a hitch): the trail restarts there. */
export const TRAIL_JUMP_M = 25;
/** Most puffs one rocket lays in one frame, so a stalled frame cannot claim the whole pool. */
export const TRAIL_MAX_PER_FRAME = 48;

/** Launch flashes at once. */
export const LAUNCH_POOL = 3;
/** How long the launch flash shows, seconds: longer and bigger than a rifle's. */
export const LAUNCH_FLASH_SECONDS = 0.12;
export const LAUNCH_FLASH_SIZE_M = 0.9;
/** The backblast's flash at the tube's open rear, bigger again: it is what is seen from the side. */
export const BACKBLAST_FLASH_SIZE_M = 1.3;
/** Metres behind the muzzle the tube's rear is (the RPG-7 and the squad's launcher are both about a metre long). */
export const BACKBLAST_BEHIND_M = 0.95;
/** Puffs the backblast throws out behind the tube, and how much bigger than a trail puff each is. */
export const BACKBLAST_PUFFS = 5;
export const BACKBLAST_PUFF_SCALE = 1.8;
export const LAUNCH_LIGHT_INTENSITY = 30;
export const LAUNCH_LIGHT_RANGE_M = 10;

/** The line in three's points shader that sizes a point; `patchPointSize` makes it read each puff's own size. */
export const POINT_SIZE_LINE = 'gl_PointSize = size;';

/**
 * Make a points vertex shader size each point by its own `puffSize` attribute. Returns the shader unchanged when
 * three's shader no longer has the line (the puffs are then all one size, never missing); a test pins the line.
 */
export function patchPointSize(vertexShader: string): string {
  if (!vertexShader.includes(POINT_SIZE_LINE)) return vertexShader;
  return `attribute float puffSize;\n${vertexShader.replace(POINT_SIZE_LINE, 'gl_PointSize = size * puffSize;')}`;
}

let glow: THREE.DataTexture | null = null;

/** A soft round spot, white so a colour tints it: a puff of smoke, and the wind-up's glint. Built once. */
export function glowTexture(): THREE.DataTexture {
  if (glow) return glow;
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const r = Math.hypot(((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      // A full, soft ball: a Gaussian, cut off at the edge.
      data[i + 3] = r >= 1 ? 0 : Math.round(Math.exp(-4 * r * r) * 255);
    }
  }
  glow = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  glow.magFilter = THREE.LinearFilter;
  glow.minFilter = THREE.LinearFilter;
  glow.needsUpdate = true;
  return glow;
}

/** The motor's flame, and the smoke it leaves (working colour space: `Color` converts from sRGB). */
const HOT = new THREE.Color(0xffb565);
const SMOKE = new THREE.Color(0xb3ada3);

interface Puff {
  live: boolean;
  born: number;
  x: number;
  y: number;
  z: number;
  /** Its size relative to a trail puff: 1, or more for the backblast. */
  scale: number;
  /** Its own wobble, seeded: a sideways drift (x, z) and a size factor. */
  driftX: number;
  driftZ: number;
  grow: number;
}

interface Track {
  /** Where the last puff was laid, and when the rocket was drawn at the end of the last frame. */
  x: number;
  y: number;
  z: number;
  at: number;
}

interface LaunchSlot {
  front: THREE.Sprite;
  back: THREE.Sprite;
  frontMaterial: THREE.SpriteMaterial;
  backMaterial: THREE.SpriteMaterial;
  light: THREE.PointLight;
  born: number;
  live: boolean;
}

export class RocketEffects {
  private readonly puffs: Puff[] = [];
  private readonly tracks = new Map<string, Track>();
  private readonly seen = new Set<string>();
  private readonly launches: LaunchSlot[] = [];
  private readonly positions: THREE.BufferAttribute;
  private readonly colors: THREE.BufferAttribute;
  private readonly sizes: THREE.BufferAttribute;
  /** The trail: every puff, one draw call. */
  readonly points: THREE.Points;
  /** Counts puffs for their seeds; never reset, so no two wobble alike. */
  private puffsLaid = 0;

  constructor(scene: THREE.Object3D) {
    for (let i = 0; i < TRAIL_POOL; i += 1) {
      this.puffs.push({ live: false, born: 0, x: 0, y: 0, z: 0, scale: 1, driftX: 0, driftZ: 0, grow: 1 });
    }
    const geometry = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array(TRAIL_POOL * 3), 3);
    this.colors = new THREE.BufferAttribute(new Float32Array(TRAIL_POOL * 4), 4);
    this.sizes = new THREE.BufferAttribute(new Float32Array(TRAIL_POOL), 1);
    for (const attribute of [this.positions, this.colors, this.sizes]) attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positions);
    // Four components: three gives the points a per-puff alpha (`vertexAlphas`).
    geometry.setAttribute('color', this.colors);
    geometry.setAttribute('puffSize', this.sizes);
    const material = new THREE.PointsMaterial({
      size: 1,
      sizeAttenuation: true,
      map: glowTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = patchPointSize(shader.vertexShader);
    };
    this.points = new THREE.Points(geometry, material);
    this.points.name = 'rocket trails';
    // Written every frame; never let three cull it on a stale bound.
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);

    const flash = flashTexture();
    for (let i = 0; i < LAUNCH_POOL; i += 1) {
      const sprite = (): [THREE.Sprite, THREE.SpriteMaterial] => {
        const material = new THREE.SpriteMaterial({
          map: flash,
          color: 0xffc978,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const s = new THREE.Sprite(material);
        s.visible = false;
        return [s, material];
      };
      const [front, frontMaterial] = sprite();
      const [back, backMaterial] = sprite();
      const light = new THREE.PointLight(0xffb060, 0, LAUNCH_LIGHT_RANGE_M, 2);
      light.visible = false;
      scene.add(front, back, light);
      this.launches.push({ front, back, frontMaterial, backMaterial, light, born: 0, live: false });
    }
  }

  get livePuffs(): number {
    return this.puffs.reduce((n, p) => n + (p.live ? 1 : 0), 0);
  }

  get liveLaunches(): number {
    return this.launches.reduce((n, l) => n + (l.live ? 1 : 0), 0);
  }

  /** Rockets being followed. */
  get trails(): number {
    return this.tracks.size;
  }

  /**
   * A rocket is drawn at `at` this frame. `key` names it across frames (the drawn projectile's key); a rocket not
   * followed by the next `update` has landed, and its trail is left to thin out on its own.
   */
  follow(key: string, at: Vec3Like, now: number): void {
    this.seen.add(key);
    const track = this.tracks.get(key);
    if (!track) {
      this.tracks.set(key, { x: at.x, y: at.y, z: at.z, at: now });
      this.puff(at.x, at.y, at.z, now, 1);
      return;
    }
    const dx = at.x - track.x;
    const dy = at.y - track.y;
    const dz = at.z - track.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance > TRAIL_JUMP_M) {
      // No smoke across a jump.
      track.x = at.x;
      track.y = at.y;
      track.z = at.z;
      track.at = now;
      return;
    }
    const steps = Math.min(TRAIL_MAX_PER_FRAME, Math.floor(distance / TRAIL_SPACING_M));
    const from = track.at;
    for (let i = 1; i <= steps; i += 1) {
      const f = (i * TRAIL_SPACING_M) / distance;
      // Born the moment the rocket passed it, between the two frames.
      this.puff(track.x + dx * f, track.y + dy * f, track.z + dz * f, from + (now - from) * f, 1);
    }
    if (steps > 0) {
      const f = (steps * TRAIL_SPACING_M) / distance;
      track.x += dx * f;
      track.y += dy * f;
      track.z += dz * f;
    }
    track.at = now;
  }

  /**
   * A rocket left a launcher whose drawn muzzle is `muzzle`, pointing along `forward` (a unit vector): a flash at
   * the muzzle, a bigger one at the tube's open rear, and the backblast's smoke thrown out behind it.
   */
  launch(muzzle: Vec3Like, forward: Vec3Like, now: number): void {
    const slot = this.claim(this.launches);
    slot.live = true;
    slot.born = now;
    slot.front.position.set(muzzle.x + forward.x * 0.1, muzzle.y + forward.y * 0.1, muzzle.z + forward.z * 0.1);
    const rear = { x: muzzle.x - forward.x * BACKBLAST_BEHIND_M, y: muzzle.y - forward.y * BACKBLAST_BEHIND_M, z: muzzle.z - forward.z * BACKBLAST_BEHIND_M };
    slot.back.position.set(rear.x, rear.y, rear.z);
    slot.light.position.copy(slot.front.position);
    slot.front.scale.set(LAUNCH_FLASH_SIZE_M, LAUNCH_FLASH_SIZE_M, 1);
    slot.back.scale.set(BACKBLAST_FLASH_SIZE_M, BACKBLAST_FLASH_SIZE_M, 1);
    slot.front.visible = true;
    slot.back.visible = true;
    slot.light.visible = true;
    this.placeLaunch(slot, 0);
    for (let i = 0; i < BACKBLAST_PUFFS; i += 1) {
      const back = 0.3 * i;
      this.puff(rear.x - forward.x * back, rear.y - forward.y * back, rear.z - forward.z * back, now, BACKBLAST_PUFF_SCALE);
    }
  }

  /** Once per frame, after every `follow`: age every puff and flash, and forget the rockets that have landed. */
  update(now: number): void {
    for (const key of [...this.tracks.keys()]) if (!this.seen.has(key)) this.tracks.delete(key);
    this.seen.clear();
    let live = 0;
    const position = this.positions.array as Float32Array;
    const color = this.colors.array as Float32Array;
    const size = this.sizes.array as Float32Array;
    for (let i = 0; i < TRAIL_POOL; i += 1) {
      const p = this.puffs[i] as Puff;
      const age = now - p.born;
      if (p.live && age >= TRAIL_PUFF_SECONDS) p.live = false;
      if (!p.live) {
        color[i * 4 + 3] = 0;
        size[i] = 0;
        continue;
      }
      live += 1;
      const t = Math.max(0, age);
      const f = t / TRAIL_PUFF_SECONDS;
      position[i * 3] = p.x + p.driftX * t;
      position[i * 3 + 1] = p.y + TRAIL_RISE_M_S * t;
      position[i * 3 + 2] = p.z + p.driftZ * t;
      // It spreads fast, then slowly; and thins all the while.
      size[i] = p.scale * p.grow * (TRAIL_SIZE.from + (TRAIL_SIZE.to - TRAIL_SIZE.from) * (1 - (1 - f) ** 2));
      const hot = Math.max(0, 1 - t / TRAIL_HOT_SECONDS);
      color[i * 4] = SMOKE.r + (HOT.r - SMOKE.r) * hot;
      color[i * 4 + 1] = SMOKE.g + (HOT.g - SMOKE.g) * hot;
      color[i * 4 + 2] = SMOKE.b + (HOT.b - SMOKE.b) * hot;
      color[i * 4 + 3] = Math.min(1, TRAIL_ALPHA * (1 - f) ** 1.5 + 0.4 * hot);
    }
    this.positions.needsUpdate = true;
    this.colors.needsUpdate = true;
    this.sizes.needsUpdate = true;
    this.points.visible = live > 0;
    for (const slot of this.launches) {
      if (!slot.live) continue;
      const t = now - slot.born;
      if (t >= LAUNCH_FLASH_SECONDS) this.retireLaunch(slot);
      else this.placeLaunch(slot, Math.max(0, t));
    }
  }

  /** Hide everything now and forget every rocket. The pools stay allocated. */
  reset(): void {
    for (const p of this.puffs) p.live = false;
    this.tracks.clear();
    this.seen.clear();
    for (const slot of this.launches) this.retireLaunch(slot);
    this.update(0);
  }

  readout(): string {
    return `rockets  trails ${this.trails}  puffs ${this.livePuffs}/${TRAIL_POOL}  launches ${this.liveLaunches}/${LAUNCH_POOL}`;
  }

  /** Where a puff is drawn and how big, at `now` (for tests: everything here is a function of age). */
  puffAt(index: number): { live: boolean; x: number; y: number; z: number; size: number; alpha: number } {
    const p = this.puffs[index] as Puff;
    const position = this.positions.array as Float32Array;
    return {
      live: p.live,
      x: position[index * 3] as number,
      y: position[index * 3 + 1] as number,
      z: position[index * 3 + 2] as number,
      size: (this.sizes.array as Float32Array)[index] as number,
      alpha: (this.colors.array as Float32Array)[index * 4 + 3] as number,
    };
  }

  private puff(x: number, y: number, z: number, born: number, scale: number): void {
    const p = this.claim(this.puffs);
    const n = this.puffsLaid;
    this.puffsLaid += 1;
    p.live = true;
    p.born = born;
    p.x = x;
    p.y = y;
    p.z = z;
    p.scale = scale;
    p.driftX = (unitFromSeed(seedFrom(n, 31)) - 0.5) * 0.3;
    p.driftZ = (unitFromSeed(seedFrom(n, 32)) - 0.5) * 0.3;
    p.grow = 0.85 + 0.3 * unitFromSeed(seedFrom(n, 33));
  }

  /** The next free slot, or the oldest live one when every slot is taken. */
  private claim<T extends { live: boolean; born: number }>(pool: readonly T[]): T {
    let pick = pool[0] as T;
    for (const slot of pool) {
      if (!slot.live) return slot;
      if (slot.born < pick.born) pick = slot;
    }
    return pick;
  }

  private placeLaunch(slot: LaunchSlot, t: number): void {
    const remaining = 1 - t / LAUNCH_FLASH_SECONDS;
    slot.frontMaterial.opacity = remaining;
    slot.backMaterial.opacity = remaining;
    slot.light.intensity = LAUNCH_LIGHT_INTENSITY * remaining;
  }

  private retireLaunch(slot: LaunchSlot): void {
    slot.live = false;
    slot.front.visible = false;
    slot.back.visible = false;
    slot.light.visible = false;
    slot.light.intensity = 0;
  }
}
