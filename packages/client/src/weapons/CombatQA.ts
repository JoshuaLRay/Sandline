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
 * is no art here, only debug lines.
 *
 * TRACERS ARE PREDICTED; HITS ARE THE SERVER'S. That split matters and it was
 * wrong in both directions before.
 *
 * Drawing tracers from the server's HitEvent meant nothing appeared until a
 * full round trip had elapsed — 160 ms at 80 ms ping, felt as the trigger
 * lagging and worsening with the connection. Nothing about a muzzle flash is
 * the server's business. So the tracer is drawn the instant the trigger
 * resolves locally, from the same seeded spread (T-1.17) the server will use,
 * which is precisely the option T-1.17 kept alive by making spread
 * deterministic even though replication did not require it.
 *
 * The local raycast is back, but ONLY to decide where the streak stops. It
 * settles nothing: damage, hit markers and whether anything was hit at all come
 * from the server's rewound trace (T-1.18). A tracer is a picture; a hit is a
 * fact.
 *
 * Cadence, magazine and bloom are also simulated locally, because an ammo
 * counter that waits for a round trip feels broken. The server runs the same
 * machine and is the authority; this copy exists so the HUD responds now.
 *
 * What it DOES exercise honestly is every number T-1.17 owns: the same
 * `tryFire` cadence and magazine machine, the same seeded `shotDirections`, the
 * same `damageAtDistance` curve the server will run.
 */
import * as THREE from 'three';
import {
  ANGLE_UNITS,
  TICK_SECONDS,
  WEAPON_IDS,
  type Shot,
  type WeaponDef,
  type WeaponState,
  allowsFire,
  createWeaponState,
  currentConeUnits,
  decayBloom,
  finishReload,
  getWeapon,
  isReloading,
  reloadProgress,
  startReload,
  tryFire,
} from '@sandline/shared';

const TRACER_SECONDS = 0.11;
const IMPACT_SECONDS = 0.8;
/** Hard cap on live debug objects, so a held trigger cannot leak the scene. */
const MAX_EFFECTS = 400;

/** Re-exported: the order is protocol, and shared owns it (see WEAPON_IDS). */
export const WEAPON_ORDER = WEAPON_IDS;

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
  /**
   * Aim, in TABLE angle units (1/4096 turn).
   *
   * Deliberately NOT the raw camera yaw/pitch. In third person the camera sits
   * off the shoulder, so the muzzle is no longer on its centre line and firing
   * along the camera angles would put shots beside the reticle. The caller
   * converges muzzle-to-aim-point first and passes the result here.
   */
  yaw: number;
  pitch: number;
  /** Trigger held this tick. */
  firing: boolean;
  /** Trigger went down since the last tick. Semi-automatics need this. */
  triggerEdge: boolean;
  ads: boolean;
  /** Prone (T-2.42): narrows the cone the same way `ads` does, from data. */
  prone: boolean;
}

export class CombatQA {
  private index = 0;
  private def: WeaponDef;
  private state: WeaponState;
  /**
   * Per-weapon working copies of the shipped definitions.
   *
   * The tuning panel edits these live, so they must NOT be the frozen objects
   * from `WEAPONS` — and they must survive a weapon switch, or a tester loses
   * every value they dialled in the moment they press 2 to compare.
   */
  private readonly working = new Map<string, WeaponDef>();
  /** Fired when the active weapon changes, so the panel can rebind its rows. */
  onWeaponChange: ((def: WeaponDef) => void) | null = null;
  private readonly effects: Fading[] = [];
  private readonly tracerGeometry = new THREE.BufferGeometry();
  private readonly impactGeometry = new THREE.SphereGeometry(0.09, 8, 6);

  shotsFired = 0;
  pelletsFired = 0;
  pelletsHit = 0;
  lastHit: LastHit | null = null;

  private readonly raycaster = new THREE.Raycaster();

  constructor(
    private readonly scene: THREE.Scene,
    /** Visual-only: what a predicted tracer may terminate on. */
    private readonly scenery: THREE.Object3D[] = [],
  ) {
    this.def = this.workingDef(0);
    this.state = createWeaponState(this.def);
  }

  /** The LIVE definition. Mutating it retunes the weapon immediately. */
  get weapon(): WeaponDef {
    return this.def;
  }

  get weaponIndex(): number {
    return this.index;
  }

  /** How far through a reload the weapon in hand is, 0..1 (T-2.26). */
  reloadProgress(now: number): number {
    return reloadProgress(this.def, this.state, now);
  }

  private workingDef(index: number): WeaponDef {
    const id = WEAPON_ORDER[index] ?? WEAPON_ORDER[0];
    const existing = this.working.get(id);
    if (existing !== undefined) return existing;
    const copy = { ...getWeapon(id) };
    this.working.set(id, copy);
    return copy;
  }

  /**
   * Settle the magazine after a stat edit. Dropping mag size below the rounds
   * already loaded would otherwise read as 30/10, and a reload timed against
   * the old duration would finish at the wrong moment.
   */
  applyWeaponEdit(): void {
    if (this.state.ammo > this.def.magSize) this.state.ammo = this.def.magSize;
    this.state.reloadEndsAt = 0;
  }

  /** Restore the active weapon to the shipped data, discarding tuning. */
  resetWeapon(): WeaponDef {
    const id = this.def.id;
    const fresh = { ...getWeapon(id) };
    this.working.set(id, fresh);
    this.def = fresh;
    this.state = createWeaponState(fresh);
    this.onWeaponChange?.(fresh);
    return fresh;
  }

  /** Switch weapons. Each keeps a fresh magazine; this is a range, not a match. */
  selectWeapon(index: number): void {
    if (index === this.index || index < 0 || index >= WEAPON_ORDER.length) return;
    this.index = index;
    this.def = this.workingDef(index);
    this.state = createWeaponState(this.def);
    this.onWeaponChange?.(this.def);
  }

  requestReload(now: number): void {
    startReload(this.def, this.state, now);
  }

  /**
   * One simulation tick. `tick` and `now` are passed in rather than read here:
   * the spread seed is (tick, entityId, shotIndex, pelletIndex), so the tick
   * number is part of the result, not bookkeeping.
   */
  tick(tickNumber: number, now: number, ctx: FireContext): Shot | null {
    /**
     * Settle any finished reload FIRST, every tick.
     *
     * This used to happen only inside `tryFire`, which runs only while the
     * trigger is held — so a reload started on an empty magazine never
     * completed unless you kept firing, the magazine stayed at zero, and the
     * auto-reload below restarted it on the very next tick. The countdown
     * looked like it was resetting itself because it was.
     */
    finishReload(this.def, this.state, now);

    let fired: Shot | null = null;
    if (allowsFire(this.def, ctx.firing, ctx.triggerEdge)) {
      fired = tryFire(this.def, this.state, now, ctx.ads, ctx.prone);
      if (fired !== null) this.shotsFired += 1;
    }

    // Convenience for a range: an empty magazine reloads itself rather than
    // making the tester notice and press a key to carry on testing.
    if (this.state.ammo === 0 && !isReloading(this.state, now)) {
      startReload(this.def, this.state, now);
    }

    decayBloom(this.def, this.state, TICK_SECONDS);
    return fired;
  }

  /**
   * Draw the tracers for a shot immediately, before the server has seen it.
   *
   * The endpoint comes from a local raycast because a streak has to stop
   * somewhere to look right; it carries no authority. Whether that pellet hit
   * anything is decided by `drawServerShot` when the real answer arrives.
   */
  predictShot(origin: THREE.Vector3, directions: readonly { x: number; y: number; z: number }[], now: number): void {
    for (const dir of directions) {
      const direction = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
      this.raycaster.set(origin, direction);
      this.raycaster.far = this.def.maxRangeM;
      const [hit] = this.raycaster.intersectObjects(this.scenery, false);
      const end = hit
        ? hit.point.clone()
        : origin.clone().addScaledVector(direction, this.def.maxRangeM);
      this.spawnTracer(origin, end, false, now);
    }
  }

  /**
   * Draw a tracer along a known segment. Used for OTHER players' shots, where
   * there was no local trigger to predict from and the server's endpoint is the
   * only endpoint there is.
   */
  drawTracer(from: THREE.Vector3, to: THREE.Vector3, now: number): void {
    this.spawnTracer(from, to, false, now);
  }

  /**
   * Record the AUTHORITATIVE outcome of one pellet: the hit marker, the damage,
   * and the accuracy tally. No tracer — the predicted one is already drawn, and
   * a second line arriving a round trip later would be the very lag this
   * separation exists to hide.
   */
  drawServerShot(origin: THREE.Vector3, end: THREE.Vector3, targetNetId: number, damage: number, now: number): void {
    this.pelletsFired += 1;
    if (targetNetId === 0) return;
    this.pelletsHit += 1;
    this.lastHit = {
      target: `net ${targetNetId}`,
      distanceM: origin.distanceTo(end),
      damage,
    };
    this.spawnImpact(end, damage, now);
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
  coneDegrees(ads: boolean, prone = false): number {
    return (currentConeUnits(this.def, this.state, ads, prone) / ANGLE_UNITS) * 360;
  }

  readout(now: number, ads: boolean): string {
    const reloading = isReloading(this.state, now);
    const mode = this.def.auto ? 'auto' : 'semi';
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
      `${this.def.rpm} rpm ${mode}  x${this.def.pellets}  cone ${this.coneDegrees(ads).toFixed(2)}deg${ads ? '  [ADS]' : ''}\n` +
      `shots ${this.shotsFired}  pellets on target ${accuracy}\n` +
      `last ${hit}`
    );
  }
}
