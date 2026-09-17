/**
 * Combat QA surface (T-1.17 made visible).
 *
 * This exists so weapon work can be JUDGED rather than only asserted. T-1.17 is
 * headless by design — spread, falloff and cadence are pure functions in
 * `@sandline/shared` with unit tests — but "does a 9-pellet cone at 5.5 degrees
 * read as a shotgun" is not a question a test can answer, and the numbers in
 * data/weapons.json are guesses until somebody fires them.
 *
 * WHAT THIS IS NOT. It is not E-2.4 (weapon feel: recoil patterns, camera
 * shake, muzzle flash, shell ejection) and must not quietly grow into it. There
 * is no art here, only debug lines. It is also NOT the authoritative hitscan:
 * resolution is a local Three.js raycast against the range targets, whereas the
 * real thing rewinds server-side hitboxes (T-1.18). When T-1.18 lands, this
 * becomes the client-side preview of a server hit event and the raycast goes.
 *
 * What it DOES exercise honestly is every number T-1.17 owns: the same
 * `tryFire` cadence and magazine machine, the same seeded `shotDirections`, the
 * same `damageAtDistance` curve the server will run.
 */
import * as THREE from 'three';
import {
  ANGLE_UNITS,
  TICK_SECONDS,
  WEAPONS,
  type WeaponDef,
  type WeaponState,
  createWeaponState,
  currentConeUnits,
  damageAtDistance,
  decayBloom,
  isReloading,
  shotDirections,
  startReload,
  tryFire,
  wireToTable,
} from '@sandline/shared';

/** Local player. The server assigns real ids; the seed only needs to be stable. */
const ENTITY_ID = 0;

const TRACER_SECONDS = 0.11;
const IMPACT_SECONDS = 0.8;
/** Hard cap on live debug objects, so a held trigger cannot leak the scene. */
const MAX_EFFECTS = 400;

export const WEAPON_ORDER = ['carbine', 'marksman', 'breacher', 'sidearm'] as const;

interface Fading {
  object: THREE.Object3D;
  material: THREE.Material & { opacity: number };
  born: number;
  life: number;
}

export interface LastHit {
  target: string;
  distanceM: number;
  damage: number;
}

export interface FireContext {
  /** Muzzle position in world space. */
  origin: THREE.Vector3;
  /** Aim, in WIRE angle units — the same units the input and wire use. */
  yawWire: number;
  pitchWire: number;
  firing: boolean;
  ads: boolean;
}

export class CombatQA {
  private index = 0;
  private def: WeaponDef;
  private state: WeaponState;
  private readonly raycaster = new THREE.Raycaster();
  private readonly effects: Fading[] = [];
  private readonly tracerGeometry = new THREE.BufferGeometry();
  private readonly impactGeometry = new THREE.SphereGeometry(0.09, 8, 6);

  shotsFired = 0;
  pelletsFired = 0;
  pelletsHit = 0;
  lastHit: LastHit | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly targets: THREE.Object3D[],
  ) {
    this.def = weaponAt(0);
    this.state = createWeaponState(this.def);
  }

  get weapon(): WeaponDef {
    return this.def;
  }

  /** Switch weapons. Each keeps a fresh magazine; this is a range, not a match. */
  selectWeapon(index: number): void {
    if (index === this.index || index < 0 || index >= WEAPON_ORDER.length) return;
    this.index = index;
    this.def = weaponAt(index);
    this.state = createWeaponState(this.def);
  }

  requestReload(now: number): void {
    startReload(this.def, this.state, now);
  }

  /**
   * One simulation tick. `tick` and `now` are passed in rather than read here:
   * the spread seed is (tick, entityId, shotIndex, pelletIndex), so the tick
   * number is part of the result, not bookkeeping.
   */
  tick(tickNumber: number, now: number, ctx: FireContext): void {
    if (ctx.firing) {
      const shot = tryFire(this.def, this.state, now, ctx.ads);
      if (shot !== null) {
        this.shotsFired += 1;
        const directions = shotDirections(
          this.def,
          shot,
          ENTITY_ID,
          tickNumber,
          wireToTable(ctx.yawWire),
          wireToTable(normalizeWirePitch(ctx.pitchWire)),
        );
        for (const dir of directions) this.resolvePellet(ctx.origin, dir, now);
      }
    }

    // Convenience for a range: an empty magazine reloads itself rather than
    // making the tester notice and press a key to carry on testing.
    if (this.state.ammo === 0 && !isReloading(this.state, now)) {
      startReload(this.def, this.state, now);
    }

    decayBloom(this.def, this.state, TICK_SECONDS);
  }

  private resolvePellet(origin: THREE.Vector3, dir: { x: number; y: number; z: number }, now: number): void {
    const direction = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
    this.raycaster.set(origin, direction);
    this.raycaster.far = this.def.maxRangeM;
    const [hit] = this.raycaster.intersectObjects(this.targets, false);

    const end = hit
      ? hit.point.clone()
      : origin.clone().addScaledVector(direction, this.def.maxRangeM);

    this.pelletsFired += 1;
    if (hit) {
      this.pelletsHit += 1;
      const damage = damageAtDistance(this.def, hit.distance);
      this.lastHit = {
        target: hit.object.name === '' ? 'target' : hit.object.name,
        distanceM: hit.distance,
        damage,
      };
      this.spawnImpact(end, damage, now);
    }
    this.spawnTracer(origin, end, Boolean(hit), now);
  }

  private spawnTracer(from: THREE.Vector3, to: THREE.Vector3, hit: boolean, now: number): void {
    const geometry = this.tracerGeometry.clone();
    geometry.setFromPoints([from.clone(), to]);
    const material = new THREE.LineBasicMaterial({
      color: hit ? 0xff8f4d : 0xffe6a8,
      transparent: true,
      opacity: 0.95,
    });
    const line = new THREE.Line(geometry, material);
    this.scene.add(line);
    this.push({ object: line, material, born: now, life: TRACER_SECONDS });
  }

  private spawnImpact(at: THREE.Vector3, damage: number, now: number): void {
    // Colour carries the falloff: full damage is hot, the floor is cold. The
    // point of a range is to SEE the curve, not read it off a number.
    const fraction = this.def.damage === 0 ? 0 : damage / this.def.damage;
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(0.12 * fraction, 0.95, 0.45 + 0.15 * fraction),
      transparent: true,
      opacity: 1,
    });
    const dot = new THREE.Mesh(this.impactGeometry, material);
    dot.position.copy(at);
    this.scene.add(dot);
    this.push({ object: dot, material, born: now, life: IMPACT_SECONDS });
  }

  private push(effect: Fading): void {
    this.effects.push(effect);
    while (this.effects.length > MAX_EFFECTS) {
      const oldest = this.effects.shift();
      if (oldest) this.dispose(oldest);
    }
  }

  /** Fade and retire debug geometry. Called once per frame, not per tick. */
  fade(now: number): void {
    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const effect = this.effects[i];
      if (effect === undefined) continue;
      const age = (now - effect.born) / effect.life;
      if (age >= 1) {
        this.dispose(effect);
        this.effects.splice(i, 1);
      } else {
        effect.material.opacity = 1 - age;
      }
    }
  }

  private dispose(effect: Fading): void {
    this.scene.remove(effect.object);
    effect.material.dispose();
    if (effect.object instanceof THREE.Line) effect.object.geometry.dispose();
  }

  reset(): void {
    for (const effect of this.effects) this.dispose(effect);
    this.effects.length = 0;
    this.state = createWeaponState(this.def);
    this.shotsFired = 0;
    this.pelletsFired = 0;
    this.pelletsHit = 0;
    this.lastHit = null;
  }

  /** Current cone half-angle in degrees, for the HUD. */
  coneDegrees(ads: boolean): number {
    return (currentConeUnits(this.def, this.state, ads) / ANGLE_UNITS) * 360;
  }

  readout(now: number, ads: boolean): string {
    const reloading = isReloading(this.state, now);
    const ammo = reloading
      ? `reloading ${(this.state.reloadEndsAt - now).toFixed(1)}s`
      : `${this.state.ammo}/${this.def.magSize}`;
    const accuracy = this.pelletsFired === 0
      ? '--'
      : `${Math.round((this.pelletsHit / this.pelletsFired) * 100)}%`;
    const hit = this.lastHit
      ? `${this.lastHit.damage.toFixed(1)} dmg @ ${this.lastHit.distanceM.toFixed(1)}m`
      : 'no hits yet';
    return (
      `${this.def.name}   ${ammo}\n` +
      `${this.def.rpm} rpm  x${this.def.pellets}  cone ${this.coneDegrees(ads).toFixed(2)}deg${ads ? ' ADS' : ''}\n` +
      `shots ${this.shotsFired}  pellets on target ${accuracy}\n` +
      `last ${hit}`
    );
  }
}

function weaponAt(index: number): WeaponDef {
  const id = WEAPON_ORDER[index] ?? WEAPON_ORDER[0];
  const def = WEAPONS[id];
  if (def === undefined) throw new Error(`weapon "${id}" missing from the shipped table`);
  return def;
}

/** Camera pitch accumulates signed; the angle table wants it wrapped. */
function normalizeWirePitch(pitchWire: number): number {
  const units = 1024;
  return ((Math.round(pitchWire) % units) + units) % units;
}
