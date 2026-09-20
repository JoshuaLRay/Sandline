/**
 * Muzzle flash, shell ejection (T-2.10) and impacts (T-2.11).
 *
 * PRIMITIVES, POOLED, CAPPED. No art: a flash is an additive sprite and a
 * point light, a shell is a tiny box, an impact is a dark quad on the wall
 * and a handful of additive points thrown off it. Every object this can ever
 * show is allocated ONCE, here, and added to the scene hidden; a shot takes
 * the next free slot, or the oldest live one when the pool is full. A held
 * trigger therefore never allocates and never grows the scene — the same
 * rule the tracers follow (§0.3 rule 3), enforced by construction rather
 * than by a counter that could drift.
 *
 * STATELESS PER FRAME. Everything drawn is a function of (now - born): the
 * flash's intensity is a ramp on its age, and a shell's position is the
 * closed-form ballistic arc — origin + v·t - ½g·t² — until the analytic
 * landing time, then the rest point. Sparks fly the same arc. No per-frame
 * integration, so 30 and 120 fps draw the same picture at the same moment,
 * and a test can ask where a shell IS at t without stepping to it.
 *
 * SEEDED, NOT RANDOM. The variation in each shell's throw, each flash's
 * size and each spark's direction comes from the shot index through
 * `seedFrom`, so a burst looks the same every time it is fired and a test
 * can assert on the result. The client is allowed `Math.random`; it is
 * simply not needed.
 *
 * FRAMES ARE SECONDS. The plan says "two frames" for a flash; at 60 fps that
 * is 33 ms, so the life is a duration and a 120 fps display sees four frames
 * of it rather than a flash half as long.
 *
 * IMPACTS ARE THE SERVER'S. `impact` is called with the point the server
 * reported in its hit event, never with the end of the predicted tracer.
 * The two differ whenever the client's scenery and the server's world
 * disagree, or the target moved; drawing the impact where the round was
 * SEEN to stop rather than where it DID would be a picture of a lie. So the
 * impact lands a round trip after the tracer, which is the honest order.
 */
import * as THREE from 'three';
import { rigOf } from '../character/humanoidRig.ts';
import { seedFrom, unitFromSeed } from '@sandline/shared';

/** Two frames at 60 fps. A duration, so the flash lasts as long at any rate. */
export const FLASH_SECONDS = 0.034;
/** More flashes than can be alive at once at any cadence in data. */
export const FLASH_POOL = 4;
/** How far ahead of the visual muzzle the flash sits, metres. */
export const FLASH_FORWARD_M = 0.08;
export const FLASH_LIGHT_INTENSITY = 6;
export const FLASH_LIGHT_RANGE_M = 5;

export const SHELL_POOL = 32;
/** A landed shell lies still this long before it starts to fade. */
export const SHELL_REST_SECONDS = 1.5;
export const SHELL_FADE_SECONDS = 0.6;
export const GRAVITY_M_S2 = 9.81;
/** Exaggerated: a real shell is a centimetre and would vanish in third person. */
export const SHELL_SIZE_M = { x: 0.02, y: 0.02, z: 0.05 } as const;
/** Ejection speed, metres per second, before the seeded variation. */
export const SHELL_EJECT = { right: 2.2, back: 0.5, up: 1.3 } as const;
/** The seeded variation added to each component, as a fraction of it. */
export const SHELL_EJECT_VARIATION = 0.35;

export const IMPACT_POOL = 24;
/** The dark mark left on the wall: a square this wide, metres. */
export const DECAL_SIZE_M = 0.14;
/** Lifted off the surface by this much so it draws over the wall, not in it. */
export const DECAL_OFFSET_M = 0.004;
export const DECAL_SECONDS = 4;
/** The last part of the decal's life is the fade. */
export const DECAL_FADE_SECONDS = 1;
export const SPARKS_PER_IMPACT = 8;
export const SPARK_SECONDS = 0.28;
/** Spark launch speeds, metres per second: off the surface, across it, and up. */
export const SPARK_SPEED = { out: 3.2, across: 1.8, up: 0.9 } as const;

/** A hit on a soldier jerks the upper body back this far for this long. */
export const FLINCH_SECONDS = 0.18;
export const FLINCH_BACK_M = 0.07;
/** The parts that flinch: the upper body, not the legs that hold it up. */
export const FLINCH_PARTS: readonly string[] = ['torso', 'head', 'helmet', 'arm-left', 'arm-right', 'backpack', 'rifle'];

interface FlashSlot {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  light: THREE.PointLight;
  born: number;
  live: boolean;
}

interface ShellSlot {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  born: number;
  live: boolean;
  origin: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Radians per second about the two axes the box tumbles on. */
  spinX: number;
  spinY: number;
  /** Seconds after `born` at which the shell reaches the floor. */
  flight: number;
  /** World Y of the shell's centre once it has landed. */
  restY: number;
}

interface ImpactSlot {
  decal: THREE.Mesh;
  decalMaterial: THREE.MeshBasicMaterial;
  sparks: THREE.Points;
  sparkMaterial: THREE.PointsMaterial;
  positions: THREE.BufferAttribute;
  /** Launch velocity per spark, xyz interleaved. */
  velocities: Float32Array;
  origin: THREE.Vector3;
  born: number;
  live: boolean;
}

interface FlinchSlot {
  born: number;
  /** Each part's resting local Z, restored exactly when the flinch ends. */
  bases: { part: THREE.Object3D; z: number }[];
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** The throw for a shot: right and back of the muzzle with a seeded variation. */
export function ejectVelocity(forwardX: number, forwardZ: number, shotIndex: number): Vec3Like {
  const vary = (k: number): number => 1 + SHELL_EJECT_VARIATION * (2 * unitFromSeed(seedFrom(shotIndex, k)) - 1);
  const right = SHELL_EJECT.right * vary(1);
  const back = SHELL_EJECT.back * vary(2);
  const up = SHELL_EJECT.up * vary(3);
  // right = cross(forward, up) = (-forwardZ, 0, forwardX); back = -forward.
  return {
    x: -forwardZ * right - forwardX * back,
    y: up,
    z: forwardX * right - forwardZ * back,
  };
}

/**
 * Seconds until a body launched upward at `upSpeed` from `height` above its
 * rest point comes down to it, under gravity. Closed form: the positive root
 * of h + v·t - ½g·t² = 0.
 */
export function flightSeconds(upSpeed: number, height: number): number {
  if (!(height > 0)) return 0;
  return (upSpeed + Math.sqrt(upSpeed * upSpeed + 2 * GRAVITY_M_S2 * height)) / GRAVITY_M_S2;
}

/**
 * The longest a shell can live when ejected from `muzzleHeight` above the
 * floor: the longest possible flight, then the rest, then the fade. Derived
 * from the numbers rather than fitted, so a tuning change moves the bound.
 */
export function shellLifetimeSeconds(muzzleHeight: number): number {
  const maxUp = SHELL_EJECT.up * (1 + SHELL_EJECT_VARIATION);
  return flightSeconds(maxUp, muzzleHeight - SHELL_SIZE_M.y / 2) + SHELL_REST_SECONDS + SHELL_FADE_SECONDS;
}

/**
 * Launch velocities for one impact's sparks: out along the surface normal,
 * scattered across it, and lifted, each seeded from the impact index so the
 * same hit throws the same sparks.
 */
export function sparkVelocities(normal: Vec3Like, impactIndex: number, out: Float32Array): void {
  // Any vector not parallel to the normal gives a tangent by cross product.
  const ax = Math.abs(normal.y) < 0.9 ? 0 : 1;
  const ay = Math.abs(normal.y) < 0.9 ? 1 : 0;
  // t1 = normal x helper, t2 = normal x t1.
  const t1x = normal.y * 0 - normal.z * ay;
  const t1y = normal.z * ax - normal.x * 0;
  const t1z = normal.x * ay - normal.y * ax;
  const t2x = normal.y * t1z - normal.z * t1y;
  const t2y = normal.z * t1x - normal.x * t1z;
  const t2z = normal.x * t1y - normal.y * t1x;
  for (let i = 0; i < SPARKS_PER_IMPACT; i += 1) {
    const u = (k: number): number => unitFromSeed(seedFrom(impactIndex, i, k));
    const along = SPARK_SPEED.out * (0.4 + 0.6 * u(1));
    const a = SPARK_SPEED.across * (2 * u(2) - 1);
    const b = SPARK_SPEED.across * (2 * u(3) - 1);
    const up = SPARK_SPEED.up * u(4);
    out[i * 3] = normal.x * along + t1x * a + t2x * b;
    out[i * 3 + 1] = normal.y * along + t1y * a + t2y * b + up;
    out[i * 3 + 2] = normal.z * along + t1z * a + t2z * b;
  }
}

const PLANE_FACING = new THREE.Vector3(0, 0, 1);

export class WeaponEffects {
  private readonly flashes: FlashSlot[] = [];
  private readonly shells: ShellSlot[] = [];
  private readonly impacts: ImpactSlot[] = [];
  private readonly flinches = new Map<THREE.Object3D, FlinchSlot>();
  private readonly shellGeometry = new THREE.BoxGeometry(SHELL_SIZE_M.x, SHELL_SIZE_M.y, SHELL_SIZE_M.z);
  private readonly decalGeometry = new THREE.PlaneGeometry(DECAL_SIZE_M, DECAL_SIZE_M);
  /** Reused per call so a shot allocates nothing. */
  private readonly scratch = new THREE.Vector3();
  private readonly scratchNormal = new THREE.Vector3();
  /** Counts impacts for their seeds; never reset, so no two share a throw. */
  private impactsSpawned = 0;

  constructor(private readonly scene: THREE.Scene) {
    for (let i = 0; i < FLASH_POOL; i += 1) {
      const material = new THREE.SpriteMaterial({
        color: 0xffc978,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      const light = new THREE.PointLight(0xffb060, 0, FLASH_LIGHT_RANGE_M, 2);
      light.visible = false;
      scene.add(sprite, light);
      this.flashes.push({ sprite, material, light, born: 0, live: false });
    }
    for (let i = 0; i < SHELL_POOL; i += 1) {
      const material = new THREE.MeshBasicMaterial({ color: 0xd9a441, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(this.shellGeometry, material);
      mesh.visible = false;
      scene.add(mesh);
      this.shells.push({
        mesh,
        material,
        born: 0,
        live: false,
        origin: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        spinX: 0,
        spinY: 0,
        flight: 0,
        restY: 0,
      });
    }
    for (let i = 0; i < IMPACT_POOL; i += 1) {
      const decalMaterial = new THREE.MeshBasicMaterial({
        color: 0x2b241d,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      });
      const decal = new THREE.Mesh(this.decalGeometry, decalMaterial);
      decal.visible = false;
      const positions = new THREE.BufferAttribute(new Float32Array(SPARKS_PER_IMPACT * 3), 3);
      positions.setUsage(THREE.DynamicDrawUsage);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', positions);
      const sparkMaterial = new THREE.PointsMaterial({
        color: 0xffd27a,
        size: 0.045,
        sizeAttenuation: true,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sparks = new THREE.Points(geometry, sparkMaterial);
      sparks.visible = false;
      // The buffer is written each frame; never let three cull it on a stale bound.
      sparks.frustumCulled = false;
      scene.add(decal, sparks);
      this.impacts.push({
        decal,
        decalMaterial,
        sparks,
        sparkMaterial,
        positions,
        velocities: new Float32Array(SPARKS_PER_IMPACT * 3),
        origin: new THREE.Vector3(),
        born: 0,
        live: false,
      });
    }
  }

  get liveFlashes(): number {
    return this.flashes.reduce((n, f) => n + (f.live ? 1 : 0), 0);
  }

  get liveShells(): number {
    return this.shells.reduce((n, s) => n + (s.live ? 1 : 0), 0);
  }

  get liveImpacts(): number {
    return this.impacts.reduce((n, s) => n + (s.live ? 1 : 0), 0);
  }

  get liveFlinches(): number {
    return this.flinches.size;
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

  /**
   * One shot: a flash at the muzzle and a shell thrown right and back.
   * `forwardX`/`forwardZ` are the character's facing, the pair `muzzlePosition`
   * takes; `floorY` is where the shell will come to rest — the feet, since
   * the character is standing on whatever it lands on.
   */
  fire(muzzle: THREE.Vector3, forwardX: number, forwardZ: number, floorY: number, shotIndex: number, now: number): void {
    const flash = this.claim(this.flashes);
    flash.live = true;
    flash.born = now;
    const size = 0.22 + 0.12 * unitFromSeed(seedFrom(shotIndex, 11));
    flash.sprite.scale.set(size, size, 1);
    flash.material.rotation = 2 * Math.PI * unitFromSeed(seedFrom(shotIndex, 12));
    this.scratch.set(muzzle.x + forwardX * FLASH_FORWARD_M, muzzle.y, muzzle.z + forwardZ * FLASH_FORWARD_M);
    flash.sprite.position.copy(this.scratch);
    flash.light.position.copy(this.scratch);
    flash.sprite.visible = true;
    flash.light.visible = true;
    flash.material.opacity = 1;
    flash.light.intensity = FLASH_LIGHT_INTENSITY;

    const shell = this.claim(this.shells);
    shell.live = true;
    shell.born = now;
    shell.origin.copy(muzzle);
    const v = ejectVelocity(forwardX, forwardZ, shotIndex);
    shell.velocity.set(v.x, v.y, v.z);
    shell.spinX = 8 + 10 * unitFromSeed(seedFrom(shotIndex, 21));
    shell.spinY = 4 + 8 * unitFromSeed(seedFrom(shotIndex, 22));
    shell.restY = floorY + SHELL_SIZE_M.y / 2;
    shell.flight = flightSeconds(v.y, muzzle.y - shell.restY);
    shell.material.opacity = 1;
    shell.mesh.visible = true;
    this.placeShell(shell, 0);
  }

  /**
   * A round stopped on scenery at `point`, the SERVER'S point, on a face
   * with outward `normal`. A dark mark lifted just off the face, and sparks
   * thrown off it.
   */
  impact(point: Vec3Like, normal: Vec3Like, now: number): void {
    const slot = this.claim(this.impacts);
    this.impactsSpawned += 1;
    slot.live = true;
    slot.born = now;
    this.scratchNormal.set(normal.x, normal.y, normal.z).normalize();
    slot.origin.set(point.x, point.y, point.z);
    slot.decal.position.copy(slot.origin).addScaledVector(this.scratchNormal, DECAL_OFFSET_M);
    // The quad faces +Z by construction; turn that onto the surface normal.
    slot.decal.quaternion.setFromUnitVectors(PLANE_FACING, this.scratchNormal);
    slot.decalMaterial.opacity = 0.85;
    slot.decal.visible = true;
    sparkVelocities(this.scratchNormal, this.impactsSpawned, slot.velocities);
    slot.sparkMaterial.opacity = 1;
    slot.sparks.visible = true;
    this.placeSparks(slot, 0);
  }

  /**
   * A soldier was hit: jerk the upper body back and let it recover. Hitting
   * a soldier already flinching restarts the flinch; the resting pose is
   * captured once and restored exactly when it ends.
   */
  flinch(root: THREE.Object3D, now: number): void {
    const existing = this.flinches.get(root);
    if (existing) {
      existing.born = now;
      return;
    }
    // A registered rig says what its upper body is (T-2.22); a bare grey box
    // is read off its part names.
    const rig = rigOf(root);
    const parts = rig ? rig.flinchParts : root.children.filter((part) => FLINCH_PARTS.includes(part.name));
    const bases: FlinchSlot['bases'] = parts.map((part) => ({ part, z: part.position.z }));
    this.flinches.set(root, { born: now, bases });
  }

  /** Where a shell is `t` seconds into its life: on the arc, or at rest. */
  private placeShell(shell: ShellSlot, t: number): void {
    const { mesh, origin, velocity } = shell;
    if (t < shell.flight) {
      mesh.position.set(
        origin.x + velocity.x * t,
        origin.y + velocity.y * t - 0.5 * GRAVITY_M_S2 * t * t,
        origin.z + velocity.z * t,
      );
      mesh.rotation.set(shell.spinX * t, shell.spinY * t, 0);
    } else {
      const f = shell.flight;
      mesh.position.set(origin.x + velocity.x * f, shell.restY, origin.z + velocity.z * f);
      // Lands flat on its side, wherever the tumble left its heading.
      mesh.rotation.set(0, shell.spinY * f, 0);
    }
  }

  /** Every spark `t` seconds after the impact, on its own arc. */
  private placeSparks(slot: ImpactSlot, t: number): void {
    const { origin, velocities } = slot;
    const arr = slot.positions.array as Float32Array;
    const drop = 0.5 * GRAVITY_M_S2 * t * t;
    for (let i = 0; i < SPARKS_PER_IMPACT; i += 1) {
      arr[i * 3] = origin.x + (velocities[i * 3] as number) * t;
      arr[i * 3 + 1] = origin.y + (velocities[i * 3 + 1] as number) * t - drop;
      arr[i * 3 + 2] = origin.z + (velocities[i * 3 + 2] as number) * t;
    }
    slot.positions.needsUpdate = true;
  }

  /** Once per frame: age every live effect and retire the finished ones. */
  update(now: number): void {
    for (const flash of this.flashes) {
      if (!flash.live) continue;
      const age = (now - flash.born) / FLASH_SECONDS;
      if (age >= 1) {
        this.retireFlash(flash);
        continue;
      }
      const remaining = 1 - Math.max(0, age);
      flash.material.opacity = remaining;
      flash.light.intensity = FLASH_LIGHT_INTENSITY * remaining;
    }
    for (const shell of this.shells) {
      if (!shell.live) continue;
      const t = now - shell.born;
      const sinceLanding = t - shell.flight;
      if (sinceLanding >= SHELL_REST_SECONDS + SHELL_FADE_SECONDS) {
        this.retireShell(shell);
        continue;
      }
      this.placeShell(shell, Math.max(0, t));
      shell.material.opacity = sinceLanding <= SHELL_REST_SECONDS
        ? 1
        : 1 - (sinceLanding - SHELL_REST_SECONDS) / SHELL_FADE_SECONDS;
    }
    for (const slot of this.impacts) {
      if (!slot.live) continue;
      const t = Math.max(0, now - slot.born);
      if (t >= DECAL_SECONDS) {
        this.retireImpact(slot);
        continue;
      }
      if (t < SPARK_SECONDS) {
        this.placeSparks(slot, t);
        slot.sparkMaterial.opacity = 1 - t / SPARK_SECONDS;
      } else if (slot.sparks.visible) {
        slot.sparks.visible = false;
      }
      const fadeStart = DECAL_SECONDS - DECAL_FADE_SECONDS;
      slot.decalMaterial.opacity = t <= fadeStart ? 0.85 : 0.85 * (1 - (t - fadeStart) / DECAL_FADE_SECONDS);
    }
    for (const [root, flinch] of this.flinches) {
      const age = now - flinch.born;
      if (age >= FLINCH_SECONDS || age < 0) {
        for (const { part, z } of flinch.bases) part.position.z = z;
        this.flinches.delete(root);
        continue;
      }
      // A sharp jerk back over the first third, then an ease forward.
      const f = age / FLINCH_SECONDS;
      const back = f < 1 / 3 ? f * 3 : 1 - (f - 1 / 3) * 1.5;
      for (const { part, z } of flinch.bases) part.position.z = z - FLINCH_BACK_M * back;
    }
  }

  private retireFlash(flash: FlashSlot): void {
    flash.live = false;
    flash.sprite.visible = false;
    flash.light.visible = false;
    flash.light.intensity = 0;
  }

  private retireShell(shell: ShellSlot): void {
    shell.live = false;
    shell.mesh.visible = false;
  }

  private retireImpact(slot: ImpactSlot): void {
    slot.live = false;
    slot.decal.visible = false;
    slot.sparks.visible = false;
  }

  /** Hide everything now. The pool stays allocated; there is nothing to free. */
  reset(): void {
    for (const flash of this.flashes) this.retireFlash(flash);
    for (const shell of this.shells) this.retireShell(shell);
    for (const slot of this.impacts) this.retireImpact(slot);
    for (const [root, flinch] of this.flinches) {
      for (const { part, z } of flinch.bases) part.position.z = z;
      this.flinches.delete(root);
    }
  }

  readout(): string {
    return (
      `fx  flashes ${this.liveFlashes}/${FLASH_POOL}  shells ${this.liveShells}/${SHELL_POOL}` +
      `  impacts ${this.liveImpacts}/${IMPACT_POOL}`
    );
  }
}
