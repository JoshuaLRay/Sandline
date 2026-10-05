/**
 * U-070: the tank as the page draws it. U-126: drawn from the generated model (`tools/src/art/vehicles`, the asset
 * `vehicle-<archetype>`) once it has loaded (`provideVehicleAssets`). It has a modelled hull and running gear, and
 * a turret node that turns apart from the hull. Until it loads, or if it never does, the tank is U-070's code-built
 * stand-in in the style of the other stand-in models (`weapons/emplacementModel.ts`): a hull on two tracks, a
 * turret, a barrel.
 *
 * Either way the page adds the same two things: a lock lamp on the turret's roof for the cannon's tell, and a flash
 * at the muzzle. Either way the tank is sized from the archetype's `vehicle` block, so the picture and the hitbox
 * agree. A dead tank is a wreck: the same model, charred and still.
 *
 * The hull and the turret are the meshes the crosshair's ray can hit (`shootable`); `TankModels` maps them back
 * to the tank's netId, as `RemoteSoldiers.netIdOf` does for a soldier.
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
  /** The hull: placed at the hull capsule's centre over the tank's feet, turned to its heading. */
  readonly root: THREE.Object3D;
  readonly turret: THREE.Object3D;
  /** The hull and the turret: what a ray can hit. */
  readonly hits: readonly THREE.Mesh[];
  /** True when drawn from the generated model; false for the code-built stand-in. */
  readonly generated: boolean;
  /** Apply one frame's look. */
  apply(frame: TankFrame): void;
  dispose(): void;
}

let templates: ReadonlyMap<string, THREE.Object3D> = new Map();
let assetsVersion = 0;

/** The asset a vehicle archetype is drawn from (U-126). */
export function vehicleAssetId(def: EnemyDef): string {
  return `vehicle-${def.id}`;
}

/** The loaded generated vehicles, by asset id; an empty map goes back to the code-built stand-in. */
export function provideVehicleAssets(loaded: ReadonlyMap<string, THREE.Object3D>): void {
  templates = loaded;
  assetsVersion++;
}

/** Bumped whenever the generated vehicles change, so a tank already drawn is redrawn from them. */
export function vehicleAssetsVersion(): number {
  return assetsVersion;
}

/** The name of the generated model's turret pivot node (`tools/src/art/vehicles/index.ts`); its mesh hangs under it. */
export const TURRET_NODE = 'turret';

/** A lit material's charred twin, made once per material and shared by every wreck. */
const charred = new WeakMap<THREE.Material, THREE.Material>();
function charredOf(material: THREE.Material): THREE.Material {
  let out = charred.get(material);
  if (!out) {
    out = new THREE.MeshLambertMaterial({ map: (material as THREE.MeshLambertMaterial).map ?? null, color: 0x3c3732 });
    charred.set(material, out);
  }
  return out;
}

/** The lamp and the flash, which the page adds to either model. */
function tellAndFlash(own: THREE.BufferGeometry[]): { lamp: THREE.Mesh; flash: THREE.Mesh } {
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), LAMP);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), FLASH);
  own.push(lamp.geometry, flash.geometry);
  lamp.visible = false;
  flash.visible = false;
  return { lamp, flash };
}

/**
 * The generated model: a clone of the template, sharing its geometry and material. The lamp sits on the dome's
 * crown and the flash at the gun's drawn tip, both read off the turret's own mesh.
 */
function createGeneratedTankModel(def: EnemyDef, template: THREE.Object3D): TankModel | null {
  const v = def.vehicle!;
  const hullY = v.hull.from[1];
  const body = template.clone(true);
  const turret = body.getObjectByName(TURRET_NODE);
  if (!turret) return null;
  const root = new THREE.Group();
  root.name = `tank ${def.id}`;
  root.position.y = hullY;
  body.position.y -= hullY;
  root.add(body);
  const meshes: THREE.Mesh[] = [];
  body.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = true;
    o.receiveShadow = true;
    meshes.push(o);
  });
  const own: THREE.BufferGeometry[] = [];
  const { lamp, flash } = tellAndFlash(own);
  const gunY = v.cannon.muzzle[1] - turret.position.y;
  const shape = turretShape(turret);
  if (!shape) return null;
  const { tip, crown } = shape;
  lamp.position.set(0, crown + 0.06, -0.15);
  flash.position.set(0, gunY, tip + 0.2);
  turret.add(lamp, flash);
  const live = meshes.map((m) => m.material as THREE.Material);
  return {
    root,
    turret,
    hits: meshes,
    generated: true,
    apply(frame) {
      turret.rotation.y = frame.turretRelative;
      lamp.visible = !frame.wreck && frame.tell > 0;
      lamp.scale.setScalar(0.7 + 0.6 * frame.tell);
      flash.visible = !frame.wreck && frame.flash;
      meshes.forEach((m, i) => (m.material = frame.wreck ? charredOf(live[i]!) : live[i]!));
      // A wreck settles a little: nose down, turret where it stopped.
      root.rotation.z = frame.wreck ? 0.05 : 0;
    },
    dispose() {
      // The template owns the shared geometry and material (the asset loader frees them); only the add-ons are ours.
      for (const g of own) g.dispose();
    },
  };
}

const shapes = new WeakMap<THREE.BufferGeometry, { tip: number; crown: number }>();
/**
 * The turret's furthest point forward (the drawn muzzle), and the top of its dome on the axis, in the turret's own
 * frame. The file's meshes sit under the pivot with the scale and offset that decode their quantized positions,
 * so every vertex is carried up through them. Null when the turret has no mesh.
 */
function turretShape(turret: THREE.Object3D): { tip: number; crown: number } | null {
  const meshes: THREE.Mesh[] = [];
  turret.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes.push(o);
  });
  if (meshes.length === 0) return null;
  const key = meshes[0]!.geometry;
  let shape = shapes.get(key);
  if (!shape) {
    let tip = -Infinity;
    let crown = -Infinity;
    let top = -Infinity;
    const v = new THREE.Vector3();
    for (const mesh of meshes) {
      const rel = new THREE.Matrix4();
      for (let o: THREE.Object3D | null = mesh; o && o !== turret; o = o.parent) {
        o.updateMatrix();
        rel.premultiply(o.matrix);
      }
      const p = mesh.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(rel);
        tip = Math.max(tip, v.z);
        top = Math.max(top, v.y);
        // On the axis: the dome's own top, not a hatch or a gun mounted off it.
        if (Math.hypot(v.x, v.z) < 0.1) crown = Math.max(crown, v.y);
      }
    }
    shape = { tip, crown: Number.isFinite(crown) ? crown : top };
    shapes.set(key, shape);
  }
  return shape;
}

/** The tank, from its generated model when one has loaded, else the code-built stand-in. */
export function createTankModel(def: EnemyDef): TankModel {
  const v = def.vehicle;
  if (!v) throw new Error(`'${def.id}' is not a vehicle`);
  const template = templates.get(vehicleAssetId(def));
  return (template && createGeneratedTankModel(def, template)) || createCodeTankModel(def);
}

/** U-070's stand-in, built from boxes and a cylinder. */
function createCodeTankModel(def: EnemyDef): TankModel {
  const v = def.vehicle!;
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
  const { lamp, flash } = tellAndFlash(own);
  lamp.position.set(0, v.turret.radius * 0.6, -0.2);
  turret.add(lamp);
  flash.position.set(0, muzzle[1] - v.turret.from[1], barrelLength + 0.2);
  turret.add(flash);

  const olive: THREE.Mesh[] = [root, box];
  return {
    root,
    turret,
    hits: [root, box],
    generated: false,
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
  /** The generated vehicles' version it was drawn with: a newer one redraws it. */
  version: number;
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
      if (entry && entry.version !== assetsVersion) {
        // The generated model arrived (or went) while this tank was drawn: redraw it, keeping its look's state.
        const fx = entry.fx;
        this.remove(netId);
        entry = this.add(netId, def, fx);
      }
      entry ??= this.add(netId, def, new TankFx());
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

  private add(netId: number, def: EnemyDef, fx: TankFx): Entry {
    const model = createTankModel(def);
    this.scene.add(model.root);
    this.shootable.push(...model.hits);
    const entry = { model, fx, hullYaw: 0, version: assetsVersion };
    this.entries.set(netId, entry);
    return entry;
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
