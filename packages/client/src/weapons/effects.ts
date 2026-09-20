/**
 * Muzzle flash and shell ejection (T-2.10).
 *
 * PRIMITIVES, POOLED, CAPPED. No art: a flash is an additive sprite and a
 * point light, a shell is a tiny box. Every object this can ever show is
 * allocated ONCE, here, and added to the scene hidden; a shot takes the next
 * free slot, or the oldest live one when the pool is full. A held trigger
 * therefore never allocates and never grows the scene — the same rule the
 * tracers follow (§0.3 rule 3), enforced by construction rather than by a
 * counter that could drift.
 *
 * STATELESS PER FRAME. Everything drawn is a function of (now - born): the
 * flash's intensity is a ramp on its age, and a shell's position is the
 * closed-form ballistic arc — origin + v·t - ½g·t² — until the analytic
 * landing time, then the rest point. No per-frame integration, so 30 and
 * 120 fps draw the same shell in the same place at the same moment, and a
 * test can ask where a shell IS at t without stepping to it.
 *
 * SEEDED, NOT RANDOM. The variation in each shell's throw and each flash's
 * size comes from the shot index through `seedFrom`, so a burst looks the
 * same every time it is fired and a test can assert on the result. The
 * client is allowed `Math.random`; it is simply not needed.
 *
 * FRAMES ARE SECONDS. The plan says "two frames" for a flash; at 60 fps that
 * is 33 ms, so the life is a duration and a 120 fps display sees four frames
 * of it rather than a flash half as long.
 */
import * as THREE from 'three';
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

export interface EjectVelocity {
  x: number;
  y: number;
  z: number;
}

/** The throw for a shot: right and back of the muzzle with a seeded variation. */
export function ejectVelocity(forwardX: number, forwardZ: number, shotIndex: number): EjectVelocity {
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

export class WeaponEffects {
  private readonly flashes: FlashSlot[] = [];
  private readonly shells: ShellSlot[] = [];
  private readonly shellGeometry = new THREE.BoxGeometry(SHELL_SIZE_M.x, SHELL_SIZE_M.y, SHELL_SIZE_M.z);
  /** Reused per call so a shot allocates nothing. */
  private readonly scratch = new THREE.Vector3();

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
  }

  get liveFlashes(): number {
    return this.flashes.reduce((n, f) => n + (f.live ? 1 : 0), 0);
  }

  get liveShells(): number {
    return this.shells.reduce((n, s) => n + (s.live ? 1 : 0), 0);
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

  /** Hide everything now. The pool stays allocated; there is nothing to free. */
  reset(): void {
    for (const flash of this.flashes) this.retireFlash(flash);
    for (const shell of this.shells) this.retireShell(shell);
  }

  readout(): string {
    return `fx  flashes ${this.liveFlashes}/${FLASH_POOL}  shells ${this.liveShells}/${SHELL_POOL}`;
  }
}
