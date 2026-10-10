import * as THREE from 'three';
import {
  type InterpResult,
  type MoveConfig,
  PROJECTILE_IDS,
  type Vitality,
  WEAPON_IDS,
  type WorldBox,
  cos,
  enemyByIndex,
  sin,
  wireToTable,
} from '@sandline/shared';
import { type FootPlacementDriver, createFootPlacementDriver } from './footPlacement.ts';
import { requireRig } from './humanoidRig.ts';
import { type FighterLook, disposeSoldier, setSoldierPalette } from './humanoidSoldier.ts';
import { fighterVariantFor } from './assetSoldier.ts';
import { type LocomotionPoseDriver, createLocomotionPoseDriver } from './locomotionPose.ts';
import { type LocomotionState, classifyLocomotion } from './locomotionState.ts';
import { type PaletteName, paletteFor } from './soldierTexture.ts';
import { type KickState, createKick, decayKick } from './weaponKick.ts';
import { LauncherFx, WIND_UP_CUE_FORWARD_M, applyWindUpCue, createWindUpCue } from './launcherLook.ts';
import { type WeaponSide, weaponMuzzle } from '../weapons/weaponModels.ts';

/**
 * Every soldier-shaped thing the server owns, drawn (T-1.16 onward; pulled
 * out of main.ts for T-3.11).
 *
 * The other five slots of the session (ADR-001) and, since T-3.11, enemies:
 * both arrive as replicated entities at the interpolation delay, and both are
 * drawn by one path — the same humanoid rig, pose driver, weapon layer, hit
 * reactions and foot placement (T-2.22..T-2.28). What differs is only what
 * the caller says about the entity each frame: its palette, its vitality and
 * what it holds. An enemy is a soldier in the other side's colours, not a
 * second kind of mesh; the one place that could tell them apart by anything
 * but paint would be a place their animation drifted apart.
 *
 * WHAT THIS DOES NOT KNOW: slots, rosters and names. It is handed a palette,
 * never a slot, so nothing here can put an enemy on the squad's HUD — the
 * HUD reads `NetClient.roster`, which an enemy is never in.
 *
 * THE ROOT IS THE HITBOX (see humanoidRig.ts), so every mesh made here joins
 * `shootable` for the non-recursive raycasts that converge the aim, and
 * leaves it when removed.
 */

export interface RemoteSoldierOptions {
  /** Where meshes are added. */
  scene: THREE.Object3D;
  /** The aim's raycast list. Leaving remote players out is what produced the down-and-left shots. */
  shootable: THREE.Object3D[];
  /** The soldier factory: the skinned soldier, or the grey box under `?greybox`. */
  create: (variant: 'remote') => THREE.Mesh;
  /** The session's world, for the feet. */
  world: () => readonly WorldBox[];
  /** Shared with the session by reference, as everywhere. */
  config: MoveConfig;
  /** T-2.47: each remote's gait, every frame it walks — its phase, its state, where its feet are — for footsteps. */
  onGait?: (netId: number, phase: number, state: LocomotionState, feet: { x: number; y: number; z: number }) => void;
}

/** What the caller knows about one remote this frame, beyond where it is. */
export interface RemoteSoldierState {
  palette: PaletteName;
  /**
   * Not interpolated: a state, not a position. Anything but alive lies down:
   * a downed soldier in the downed pose, and a dead enemy — which never goes
   * down (T-3.10) — holds the same pose as its corpse until it despawns.
   */
  vitality: Vitality;
  /** A WEAPON_IDS or PROJECTILE_IDS id. */
  held: string;
  /** 0..1 through a reload. */
  reload: number;
  /** T-4.35: an enemy's fighter variant and whether it carries the MG; absent for the squad. */
  look?: FighterLook;
  /**
   * U-158: an RPG gunner with its launcher (not its rifle) in hand, and whether it is winding up (U-157's `aiming`):
   * carried low, then shouldered with a glint on the warhead. Absent for everyone else, whose launcher is aimed.
   */
  launcher?: { aiming: boolean };
}

/**
 * The slice of `NetClient` the renderer reads about remotes: where they are,
 * and what their components say. An interface so a test can see exactly what
 * the picture is a function of.
 */
export interface RemoteView {
  remotes(): ReadonlyMap<number, InterpResult>;
  remoteEnemy(netId: number): { archetype: number; aiming?: boolean; launcher?: boolean } | null;
  remoteSlot(netId: number): number;
  readonly roster: readonly { human: boolean }[];
  remoteVitality(netId: number): Vitality;
  remoteWeapon(netId: number): { index: number; pouch: number; reloadProgress: number };
}

/**
 * How one remote should look this frame, from its components alone. An
 * `Enemy` component means the other side's palette and its archetype's gun
 * (an enemy replicates no Weapon component); it also means no slot, so the
 * roster is never asked about it. A slot's palette follows the roster, as
 * T-2.33 made it.
 */
export function remoteSoldierState(view: RemoteView, netId: number): RemoteSoldierState {
  const enemy = view.remoteEnemy(netId);
  const vitality = view.remoteVitality(netId);
  // U-075: the escorted character wears civilian clothes and carries nothing (bare hands).
  if (enemy && enemyByIndex(enemy.archetype)?.friendly) {
    return { palette: paletteFor({ prisoner: true }), vitality, held: 'knife', reload: 0 };
  }
  if (enemy) {
    const def = enemyByIndex(enemy.archetype);
    // U-158: the launcher while the `launcher` bit says it is in hand (U-157), the archetype's rifle otherwise.
    const launcher = enemy.launcher === true && def?.launcher ? def.launcher : null;
    return {
      palette: paletteFor({ enemy: true }),
      vitality,
      held: launcher ? launcher.projectile : def?.weapon ?? WEAPON_IDS[0],
      reload: 0,
      look: { variant: fighterVariantFor(netId), gunner: def?.weapon === 'lmg' },
      ...(launcher ? { launcher: { aiming: enemy.aiming === true } } : {}),
    };
  }
  const slot = view.remoteSlot(netId);
  const weapon = view.remoteWeapon(netId);
  return {
    palette: paletteFor({ slot, human: view.roster[slot]?.human }),
    vitality,
    held: heldFromWeapon(weapon),
    reload: weapon.reloadProgress,
  };
}

interface Entry {
  mesh: THREE.Mesh;
  pose: LocomotionPoseDriver;
  feet: FootPlacementDriver;
  kick: KickState;
  prev: { x: number; z: number } | null;
  /** U-158: the launcher's carry and wind-up. */
  launcher: LauncherFx;
  /** U-158: the wind-up's glint on the warhead, made the first time a launcher is held. */
  cue: THREE.Sprite | null;
  /** U-158: seconds since a launcher was last in its hands (0 while one is); a rocket seen this soon after is its. */
  sinceLauncher: number;
}

/** U-158: metres from a soldier a newly seen rocket may be and still be the one its launcher just fired. */
export const LAUNCH_MATCH_M = 4;
/** U-158: seconds a launcher counts as just held: the last rocket puts the rifle back in hand on the tick it leaves. */
export const LAUNCH_MATCH_SECONDS = 0.6;
const LAUNCHER = 'rocket';

/** A signed wire angle (1024 per turn) in radians. */
function wireToRadians(wire: number): number {
  return (wire / 1024) * Math.PI * 2;
}

/** What a remote with a replicated Weapon component holds (T-2.26, T-2.32). */
export function heldFromWeapon(weapon: { index: number; pouch: number } | null | undefined): string {
  // U-047: one past the last pouch item is the health kits, which have no model yet: bare hands (the knife's).
  if (weapon && weapon.pouch === PROJECTILE_IDS.length) return 'knife';
  if (weapon && weapon.pouch >= 0) return PROJECTILE_IDS[weapon.pouch] ?? WEAPON_IDS[0];
  return WEAPON_IDS[weapon?.index ?? 0] ?? WEAPON_IDS[0];
}

export class RemoteSoldiers {
  private readonly entries = new Map<number, Entry>();

  constructor(private readonly options: RemoteSoldierOptions) {}

  /** The mesh for a netId, if one exists. Hit reactions and tracers look shooters and targets up here. */
  get(netId: number): THREE.Mesh | undefined {
    return this.entries.get(netId)?.mesh;
  }

  has(netId: number): boolean {
    return this.entries.has(netId);
  }

  /** Whose mesh this is, for what the aim ray hit (T-3.29); null if it is nobody's. */
  netIdOf(object: THREE.Object3D): number | null {
    for (const [netId, entry] of this.entries) if (entry.mesh === object) return netId;
    return null;
  }

  get size(): number {
    return this.entries.size;
  }

  ids(): IterableIterator<number> {
    return this.entries.keys();
  }

  /** The mesh for a netId, made on first sight. */
  ensure(netId: number): THREE.Mesh {
    let entry = this.entries.get(netId);
    if (!entry) {
      const mesh = this.options.create('remote');
      mesh.name = `net ${netId}`;
      this.options.scene.add(mesh);
      this.options.shootable.push(mesh);
      entry = {
        mesh,
        pose: createLocomotionPoseDriver(mesh),
        feet: createFootPlacementDriver(mesh, { world: this.options.world, config: this.options.config }),
        kick: createKick(),
        prev: null,
        launcher: new LauncherFx(),
        cue: null,
        sinceLauncher: Infinity,
      };
      this.entries.set(netId, entry);
    }
    return entry.mesh;
  }

  /**
   * Draw every remote the client returns this frame, and remove every one it
   * no longer does. With no session, everything goes.
   */
  update(view: RemoteView | null, dt: number): void {
    const seen = new Set<number>();
    for (const [netId, sample] of view?.remotes() ?? []) {
      // U-070: a vehicle is not a soldier; `TankModels` draws it.
      const enemy = view!.remoteEnemy(netId);
      if (enemy && enemyByIndex(enemy.archetype)?.vehicle) continue;
      seen.add(netId);
      this.draw(netId, sample, remoteSoldierState(view!, netId), dt);
    }
    this.retain(seen);
  }

  /**
   * U-158: the launcher a rocket first seen at `at` just left — the soldier drawn nearest it, within
   * `LAUNCH_MATCH_M`, with a launcher in hand now or a moment ago — and where that launcher's muzzle is drawn and
   * which way it points, world space, into `out`. Null when no drawn soldier fired it (the rocket is our own, or its
   * firer is not drawn), so a flash is never drawn on the wrong body.
   */
  launcherNear(at: { x: number; y: number; z: number }, out: { muzzle: THREE.Vector3; forward: THREE.Vector3 }): number | null {
    let best: { netId: number; entry: Entry } | null = null;
    let bestD = LAUNCH_MATCH_M;
    for (const [netId, entry] of this.entries) {
      if (entry.sinceLauncher > LAUNCH_MATCH_SECONDS) continue;
      const p = entry.mesh.position;
      const d = Math.hypot(at.x - p.x, at.y - p.y, at.z - p.z);
      if (d <= bestD) {
        bestD = d;
        best = { netId, entry };
      }
    }
    if (!best) return null;
    const aim = requireRig(best.entry.mesh).aim;
    const side = (best.entry.mesh.userData['side'] as WeaponSide | undefined) ?? 'squad';
    const tip = weaponMuzzle(LAUNCHER, side);
    aim.updateWorldMatrix(true, false);
    aim.localToWorld(out.muzzle.set(tip[0], tip[1], tip[2]));
    out.forward.set(0, 0, 1).transformDirection(aim.matrixWorld);
    return best.netId;
  }

  /** U-158: how many soldiers are showing a wind-up this frame (the QA readout). */
  get windingUp(): number {
    let n = 0;
    for (const entry of this.entries.values()) if (entry.cue?.visible) n += 1;
    return n;
  }

  /** U-158: the wind-up glint on a soldier, if one has been made (tests and capture). */
  windUpCue(netId: number): THREE.Sprite | null {
    return this.entries.get(netId)?.cue ?? null;
  }

  /** Add one fire-layer kick, from the server's shot event (T-2.26). */
  kick(netId: number, add: (kick: KickState) => KickState): void {
    const entry = this.entries.get(netId);
    if (entry) entry.kick = add(entry.kick);
  }

  /**
   * Place and pose one remote for this frame. Its locomotion comes from the
   * same rendered samples used to place it, so animation never feeds back
   * into interpolation, hitboxes, or authoritative movement.
   */
  draw(netId: number, sample: InterpResult, state: RemoteSoldierState, dt: number): THREE.Mesh {
    const mesh = this.ensure(netId);
    const entry = this.entries.get(netId)!;
    const { config } = this.options;
    // Re-asked every frame rather than fixed at creation: a slot flips
    // between bot and human on the LIVE entity (ADR-001), and the body is
    // where that should show. A repaint is a texture swap the call itself
    // skips when nothing changed.
    setSoldierPalette(mesh, state.palette, state.look);
    mesh.position.set(sample.x, sample.y + 0.9, sample.z);
    const yaw = wireToTable(sample.yaw);
    mesh.rotation.y = Math.atan2(sin(yaw), cos(yaw));

    const velocityX = entry.prev && dt > 0 ? (sample.x - entry.prev.x) / dt : 0;
    const velocityZ = entry.prev && dt > 0 ? (sample.z - entry.prev.z) / dt : 0;
    const lying = state.vitality !== 'alive';
    const rig = requireRig(mesh);
    const frame = entry.launcher.update({ launcher: state.launcher !== undefined, aiming: state.launcher?.aiming ?? false, vitality: state.vitality }, dt);
    if (lying) {
      rig.setPose(state.vitality === 'dead' ? 'dead' : 'downed');
      entry.pose.reset();
      rig.aimAt(0, 0);
    } else {
      const locomotion = classifyLocomotion(
        {
          velocityX,
          velocityZ,
          grounded: true,
          crouched: sample.crouched,
          prone: sample.prone,
          downed: false,
          facingYaw: sample.yaw,
          vaultProgress: sample.vaultElapsed == null ? null : Math.min(1, sample.vaultElapsed / config.vaultSeconds),
        },
        config,
      );
      rig.setPose(sample.prone ? 'prone' : sample.crouched ? 'crouched' : 'standing');
      entry.pose.update(locomotion, dt);
      this.options.onGait?.(netId, entry.pose.phase, locomotion.state, { x: sample.x, y: sample.y, z: sample.z });
      // Their replicated aim pitch, the one the server traces their shots
      // along, unsigned on the wire like yaw (T-2.25); their kick from the
      // server's shot events and their reload from the snapshot (T-2.26).
      entry.kick = decayKick(entry.kick, dt);
      rig.setHeld(state.held);
      rig.hold({
        pitch: wireToRadians(sample.pitch > 511 ? sample.pitch - 1024 : sample.pitch),
        weight: 1 - entry.pose.vaultWeight,
        kickBack: entry.kick.back,
        kickUp: entry.kick.up,
        reload: state.reload,
        lower: frame.lower,
      });
    }
    // U-158: a soldier with a launcher in hand (or one a moment ago) is who a new rocket near them came from.
    entry.sinceLauncher = !lying && rig.held === LAUNCHER ? 0 : entry.sinceLauncher + Math.max(0, dt);
    if (state.launcher && !entry.cue) {
      entry.cue = createWindUpCue();
      const tip = weaponMuzzle(LAUNCHER, 'enemy');
      entry.cue.position.set(tip[0], tip[1], tip[2] + WIND_UP_CUE_FORWARD_M);
      rig.aim.add(entry.cue);
    }
    if (entry.cue) applyWindUpCue(entry.cue, frame);
    // Their feet stand on what is under them (T-2.28). The mesh is already
    // at its interpolated place; a vaulting or lying soldier gets none.
    entry.feet.update({ feetY: sample.y, active: !lying && entry.pose.vaultWeight === 0 }, dt);
    entry.prev = { x: sample.x, z: sample.z };
    return mesh;
  }

  /**
   * Remove one remote and everything made for it: the mesh from the scene
   * and from `shootable`, its drivers and kick, and its own GPU buffers.
   */
  remove(netId: number): void {
    const entry = this.entries.get(netId);
    if (!entry) return;
    this.entries.delete(netId);
    this.options.scene.remove(entry.mesh);
    const at = this.options.shootable.indexOf(entry.mesh);
    if (at >= 0) this.options.shootable.splice(at, 1);
    if (entry.cue) (entry.cue.material as THREE.SpriteMaterial).dispose();
    disposeSoldier(entry.mesh);
  }

  /**
   * Remove every remote not in `seen` — the ones the client no longer
   * returns because they despawned (T-3.11) — so a corpse leaves the scene
   * the frame its entity leaves the interpolated world.
   */
  retain(seen: ReadonlySet<number>): void {
    for (const netId of [...this.entries.keys()]) {
      if (!seen.has(netId)) this.remove(netId);
    }
  }

  /** Every remote gone: the session was left, and the next one has its own. */
  clear(): void {
    for (const netId of [...this.entries.keys()]) this.remove(netId);
  }
}
