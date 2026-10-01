/**
 * U-070: the tank as the page draws it — a code-built placeholder in the style of the other stand-in models
 * (`weapons/emplacementModel.ts`): a hull on two tracks, a turret that turns apart from it, a barrel, a lock
 * lamp for the cannon's tell and a flash at the muzzle. Sized from the archetype's `vehicle` block, so the
 * picture and the hitbox agree. A dead tank is a wreck: the same shapes, charred and still. Real art comes later.
 *
 * The hull and the turret boxes are the meshes the crosshair's ray can hit (`shootable`); `TankModels` maps
 * them back to the tank's netId, as `RemoteSoldiers.netIdOf` does for a soldier.
 */
import * as THREE from 'three';
import { type EnemyDef, type InterpResult, type Vitality, enemyByIndex } from '@sandline/shared';
import { TankFx, type TankFrame, wireRadians } from './tankLook.ts';

const OLIVE = new THREE.MeshLambertMaterial({ color: 0x4a5330 });
const DARK = new THREE.MeshLambertMaterial({ color: 0x2b2d24 });
const CHAR = new THREE.MeshLambertMaterial({ color: 0x1a1a18 });
const LAMP = new THREE.MeshBasicMaterial({ color: 0xff3b1f });
const FLASH = new THREE.MeshBasicMaterial({ color: 0xffd27a });

export interface TankModel {
  /** The hull box: placed at the tank's feet, turned to its heading. */
  readonly root: THREE.Mesh;
  readonly turret: THREE.Group;
  /** The two boxes a ray can hit. */
  readonly hits: readonly THREE.Mesh[];
  /** Apply one frame's look. */
  apply(frame: TankFrame): void;
  dispose(): void;
}

export function createTankModel(def: EnemyDef): TankModel {
  const v = def.vehicle;
  if (!v) throw new Error(`'${def.id}' is not a vehicle`);
  const own: THREE.BufferGeometry[] = [];
  const geo = <T extends THREE.BufferGeometry>(g: T): T => (own.push(g), g);
  const length = Math.abs(v.hull.to[2] - v.hull.from[2]) + v.hull.radius * 1.4;
  const width = v.hull.radius * 2;
  const hullY = v.hull.from[1];

  const root = new THREE.Mesh(geo(new THREE.BoxGeometry(width * 0.82, v.hull.radius * 1.1, length)), OLIVE);
  root.name = `tank ${def.id}`;
  root.position.y = hullY;
  root.castShadow = true;
  const dark: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const track = new THREE.Mesh(geo(new THREE.BoxGeometry(width * 0.22, v.hull.radius * 0.95, length * 1.02)), DARK);
    track.position.set(side * width * 0.4, -v.hull.radius * 0.15, 0);
    track.castShadow = true;
    root.add(track);
    dark.push(track);
  }

  // The turret turns about the turret capsule's own axis, apart from the hull.
  const turret = new THREE.Group();
  turret.name = 'turret';
  turret.position.set(v.turret.from[0], v.turret.from[1] - hullY, v.turret.from[2]);
  root.add(turret);
  const box = new THREE.Mesh(geo(new THREE.BoxGeometry(v.turret.radius * 1.9, v.turret.radius * 0.9, v.turret.radius * 2.2)), OLIVE);
  box.castShadow = true;
  turret.add(box);
  const muzzle = v.cannon.muzzle;
  const barrelLength = muzzle[2] - v.turret.from[2];
  const barrel = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.09, 0.11, barrelLength, 8)), DARK);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, muzzle[1] - v.turret.from[1], barrelLength / 2);
  barrel.castShadow = true;
  turret.add(barrel);
  dark.push(barrel);

  // The lock lamp on the turret's roof, and the flash at the muzzle: both hidden until a frame says otherwise.
  const lamp = new THREE.Mesh(geo(new THREE.SphereGeometry(0.16, 8, 6)), LAMP);
  lamp.position.set(0, v.turret.radius * 0.6, -0.2);
  lamp.visible = false;
  turret.add(lamp);
  const flash = new THREE.Mesh(geo(new THREE.SphereGeometry(0.45, 8, 6)), FLASH);
  flash.position.set(0, muzzle[1] - v.turret.from[1], barrelLength + 0.2);
  flash.visible = false;
  turret.add(flash);

  const olive: THREE.Mesh[] = [root, box];
  return {
    root,
    turret,
    hits: [root, box],
    apply(frame) {
      turret.rotation.y = frame.turretRelative;
      lamp.visible = !frame.wreck && frame.tell > 0;
      lamp.scale.setScalar(0.7 + 0.6 * frame.tell);
      flash.visible = !frame.wreck && frame.flash;
      for (const m of olive) m.material = frame.wreck ? CHAR : OLIVE;
      for (const m of dark) m.material = frame.wreck ? CHAR : DARK;
      // A wreck settles a little: nose down, turret where it stopped.
      root.rotation.z = frame.wreck ? 0.05 : 0;
    },
    dispose() {
      for (const g of own) g.dispose();
    },
  };
}

/** What the renderer reads of the net client: the same slice `RemoteSoldiers` uses, plus the tank's own fields. */
export interface TankView {
  remotes(): ReadonlyMap<number, InterpResult>;
  remoteEnemy(netId: number): { archetype: number; turretYaw: number; aiming: boolean } | null;
  remoteVitality(netId: number): Vitality;
}

/** Whether an enemy archetype index is a vehicle: drawn here, not as a soldier. */
export function isVehicleArchetype(index: number): boolean {
  return enemyByIndex(index)?.vehicle !== undefined;
}

interface Entry {
  model: TankModel;
  fx: TankFx;
  hullYaw: number;
}

/** Every tank in the snapshot, drawn and removed as it appears and leaves. */
export class TankModels {
  private readonly entries = new Map<number, Entry>();

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly shootable: THREE.Object3D[],
  ) {}

  has(netId: number): boolean {
    return this.entries.has(netId);
  }

  get size(): number {
    return this.entries.size;
  }

  ids(): IterableIterator<number> {
    return this.entries.keys();
  }

  /** Whose tank this mesh is, for what the aim ray hit; null if it is none. */
  netIdOf(object: THREE.Object3D): number | null {
    for (const [netId, entry] of this.entries) if (entry.model.hits.includes(object as THREE.Mesh)) return netId;
    return null;
  }

  /** The tank's drawn place (feet), for the compass and the markers; null if it is not drawn. */
  at(netId: number): { x: number; y: number; z: number } | null {
    const entry = this.entries.get(netId);
    return entry ? { x: entry.model.root.position.x, y: entry.model.root.position.y, z: entry.model.root.position.z } : null;
  }

  update(view: TankView | null, dt: number): void {
    const seen = new Set<number>();
    for (const [netId, sample] of view?.remotes() ?? []) {
      const enemy = view!.remoteEnemy(netId);
      const def = enemy ? enemyByIndex(enemy.archetype) : null;
      if (!enemy || !def?.vehicle) continue;
      seen.add(netId);
      let entry = this.entries.get(netId);
      if (!entry) {
        const model = createTankModel(def);
        this.scene.add(model.root);
        this.shootable.push(...model.hits);
        entry = { model, fx: new TankFx(), hullYaw: 0 };
        this.entries.set(netId, entry);
      }
      entry.hullYaw = wireRadians(sample.yaw);
      entry.model.root.position.set(sample.x, sample.y + def.vehicle.hull.from[1], sample.z);
      entry.model.root.rotation.y = entry.hullYaw;
      const frame = entry.fx.update(
        {
          hullYaw: entry.hullYaw,
          turretWire: enemy.turretYaw,
          aiming: enemy.aiming,
          vitality: view!.remoteVitality(netId),
          turnRadPerSec: (def.vehicle.turretTurnDegPerSec * Math.PI) / 180,
        },
        dt,
      );
      entry.model.apply(frame);
    }
    for (const netId of [...this.entries.keys()]) if (!seen.has(netId)) this.remove(netId);
  }

  remove(netId: number): void {
    const entry = this.entries.get(netId);
    if (!entry) return;
    this.entries.delete(netId);
    this.scene.remove(entry.model.root);
    for (const hit of entry.model.hits) {
      const at = this.shootable.indexOf(hit);
      if (at >= 0) this.shootable.splice(at, 1);
    }
    entry.model.dispose();
  }

  clear(): void {
    for (const netId of [...this.entries.keys()]) this.remove(netId);
  }
}
