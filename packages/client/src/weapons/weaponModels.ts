/**
 * What is in the hands, as geometry: one model per loadout item, shared by the
 * third-person body (the rig's aim attachment) and the first-person viewmodel.
 *
 * Every model is built in AIM SPACE, the rig's weapon-attachment frame: +Z is
 * forward along the bore, +Y up, +X the holder's left, and the origin is the
 * butt at the shoulder — the same frame the carbine box has always sat in, so
 * a model dropped onto `rig.aim` sits where the tracers start.
 *
 * Primitives and flat Lambert on purpose, like the soldier (T-2.32): a 2002
 * weapon is a handful of boxes and cylinders whose silhouette says what it is,
 * and each one is a few draw calls rather than a texture to author.
 *
 * Keyed by the data's ids (weapons.json, projectiles.json). An id with no
 * model of its own gets the carbine's, so a new weapon in the data is held as
 * a rifle until someone models it, never as nothing.
 */
import * as THREE from 'three';

export type Vec3Tuple = [number, number, number];

export interface WeaponModelSpec {
  /** Where the right hand holds it, in aim space. */
  gripRight: Vec3Tuple;
  /** Where the left hand holds it (or rests, for a grenade), in aim space. */
  gripLeft: Vec3Tuple;
  /**
   * The point the eye looks along when aimed, in aim space: the rear sight,
   * the scope's eyepiece, the launcher's sight. The viewmodel puts this on
   * the view axis at ADS.
   */
  sight: Vec3Tuple;
  /** Metres ahead of the eye the sight sits at ADS. */
  eyeRelief: number;
  /** First-person hip placement: the sight's offset from the view axis, camera space (+X right, +Y up). */
  hip: Vec3Tuple;
}

export interface WeaponModel {
  readonly id: string;
  readonly object: THREE.Group;
  readonly spec: WeaponModelSpec;
}

const MATERIALS = {
  metal: new THREE.MeshLambertMaterial({ color: 0x2b2d2f }),
  polymer: new THREE.MeshLambertMaterial({ color: 0x1f221e }),
  wood: new THREE.MeshLambertMaterial({ color: 0x5b3c22 }),
  tan: new THREE.MeshLambertMaterial({ color: 0x7d6c4a }),
  olive: new THREE.MeshLambertMaterial({ color: 0x4a5330 }),
  lens: new THREE.MeshLambertMaterial({ color: 0x0d1a24, emissive: 0x081018 }),
  brass: new THREE.MeshLambertMaterial({ color: 0x8d7a3c }),
} as const;
type MaterialName = keyof typeof MATERIALS;

function box(group: THREE.Group, material: MaterialName, size: Vec3Tuple, at: Vec3Tuple, rotX = 0): void {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), MATERIALS[material]);
  mesh.position.set(at[0], at[1], at[2]);
  mesh.rotation.x = rotX;
  mesh.castShadow = true;
  group.add(mesh);
}

/** A cylinder lying along +Z. */
function tube(group: THREE.Group, material: MaterialName, radius: number, length: number, at: Vec3Tuple, sides = 8, radiusFront = radius): void {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusFront, radius, length, sides), MATERIALS[material]);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(at[0], at[1], at[2]);
  mesh.castShadow = true;
  group.add(mesh);
}

const RIFLE_GRIPS = { gripRight: [0, -0.08, 0.17] as Vec3Tuple, gripLeft: [0.02, -0.02, 0.36] as Vec3Tuple };

type Builder = (group: THREE.Group) => WeaponModelSpec;

const BUILDERS: Record<string, Builder> = {
  carbine(g) {
    box(g, 'polymer', [0.045, 0.1, 0.2], [0, -0.01, 0.1]);
    box(g, 'metal', [0.06, 0.09, 0.3], [0, 0, 0.35]);
    box(g, 'polymer', [0.035, 0.1, 0.045], [0, -0.09, 0.2], -0.35);
    box(g, 'metal', [0.04, 0.16, 0.07], [0, -0.12, 0.33], 0.2);
    box(g, 'polymer', [0.066, 0.075, 0.22], [0, 0, 0.6]);
    tube(g, 'metal', 0.012, 0.22, [0, 0.005, 0.8]);
    box(g, 'metal', [0.022, 0.03, 0.2], [0, 0.058, 0.36]);
    box(g, 'metal', [0.012, 0.04, 0.012], [0, 0.058, 0.68]);
    return { ...RIFLE_GRIPS, sight: [0, 0.075, 0.26], eyeRelief: 0.3, hip: [0.16, -0.15, -0.12] };
  },
  marksman(g) {
    box(g, 'tan', [0.05, 0.11, 0.24], [0, -0.01, 0.1]);
    box(g, 'metal', [0.06, 0.09, 0.34], [0, 0, 0.38]);
    box(g, 'tan', [0.035, 0.1, 0.045], [0, -0.09, 0.2], -0.35);
    box(g, 'metal', [0.04, 0.11, 0.07], [0, -0.1, 0.36], 0.1);
    box(g, 'tan', [0.066, 0.075, 0.26], [0, 0, 0.66]);
    tube(g, 'metal', 0.013, 0.36, [0, 0.005, 0.96]);
    // The scope: the one silhouette that says "marksman" at forty metres.
    tube(g, 'metal', 0.024, 0.26, [0, 0.085, 0.38]);
    tube(g, 'metal', 0.032, 0.05, [0, 0.085, 0.24], 8, 0.024);
    tube(g, 'metal', 0.034, 0.06, [0, 0.085, 0.53], 8, 0.034);
    tube(g, 'lens', 0.026, 0.004, [0, 0.085, 0.215]);
    box(g, 'metal', [0.02, 0.04, 0.03], [0, 0.05, 0.3]);
    box(g, 'metal', [0.02, 0.04, 0.03], [0, 0.05, 0.46]);
    return { ...RIFLE_GRIPS, sight: [0, 0.085, 0.215], eyeRelief: 0.1, hip: [0.16, -0.16, -0.14] };
  },
  breacher(g) {
    box(g, 'wood', [0.05, 0.11, 0.24], [0, -0.02, 0.1], 0.08);
    box(g, 'metal', [0.065, 0.085, 0.22], [0, 0, 0.32]);
    box(g, 'wood', [0.035, 0.09, 0.045], [0, -0.085, 0.22], -0.3);
    tube(g, 'metal', 0.019, 0.46, [0, 0.02, 0.66]);
    tube(g, 'metal', 0.016, 0.38, [0, -0.025, 0.6]);
    // The pump, where the left hand is.
    box(g, 'wood', [0.06, 0.055, 0.16], [0, -0.03, 0.4]);
    box(g, 'brass', [0.012, 0.018, 0.012], [0, 0.047, 0.86]);
    return {
      gripRight: [0, -0.08, 0.2],
      gripLeft: [0.02, -0.04, 0.4],
      sight: [0, 0.05, 0.3],
      eyeRelief: 0.32,
      hip: [0.16, -0.15, -0.12],
    };
  },
  sidearm(g) {
    // Held out at arm's length, both hands on the grip.
    box(g, 'metal', [0.032, 0.035, 0.19], [0, 0, 0.4]);
    box(g, 'polymer', [0.03, 0.03, 0.16], [0, -0.03, 0.39]);
    box(g, 'polymer', [0.032, 0.11, 0.05], [0, -0.075, 0.33], -0.25);
    box(g, 'metal', [0.008, 0.012, 0.008], [0, 0.023, 0.48]);
    box(g, 'metal', [0.022, 0.012, 0.008], [0, 0.023, 0.315]);
    return {
      gripRight: [0, -0.08, 0.32],
      gripLeft: [0.03, -0.09, 0.33],
      sight: [0, 0.03, 0.315],
      eyeRelief: 0.32,
      hip: [0.1, -0.1, -0.12],
    };
  },
  frag(g) {
    // In the right hand, low, where it is thrown from. The left hand stays
    // out in front for balance: nothing is held with it.
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.042, 8, 6), MATERIALS.olive);
    body.scale.set(1, 1.15, 1);
    body.position.set(0, -0.04, 0.2);
    body.castShadow = true;
    g.add(body);
    box(g, 'metal', [0.022, 0.03, 0.024], [0, 0.015, 0.2]);
    box(g, 'metal', [0.012, 0.07, 0.01], [-0.02, -0.02, 0.2], 0.1);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.003, 4, 8), MATERIALS.metal);
    ring.position.set(0.02, 0.022, 0.2);
    ring.rotation.y = Math.PI / 2;
    g.add(ring);
    return {
      gripRight: [0, -0.08, 0.2],
      gripLeft: [0.2, -0.16, 0.26],
      // No sight to look along: the "sight" is the grenade itself, held low
      // and right of the view.
      sight: [0, -0.04, 0.2],
      eyeRelief: 0.3,
      hip: [0.14, -0.1, -0.08],
    };
  },
  rocket(g) {
    // On the shoulder: the tube runs back past the ear and out in front.
    tube(g, 'olive', 0.052, 1.0, [0, 0.08, 0.15], 10);
    tube(g, 'olive', 0.07, 0.12, [0, 0.08, -0.3], 10, 0.052);
    tube(g, 'metal', 0.058, 0.05, [0, 0.08, 0.64], 10);
    box(g, 'polymer', [0.035, 0.11, 0.05], [0, -0.01, 0.12], -0.2);
    box(g, 'polymer', [0.035, 0.1, 0.045], [0, -0.005, 0.38], -0.1);
    box(g, 'metal', [0.03, 0.06, 0.08], [0.07, 0.11, 0.24]);
    box(g, 'lens', [0.028, 0.03, 0.004], [0.07, 0.12, 0.198]);
    return {
      gripRight: [0, -0.06, 0.12],
      gripLeft: [0.02, -0.05, 0.38],
      sight: [0.07, 0.12, 0.198],
      eyeRelief: 0.34,
      hip: [0.14, -0.06, -0.08],
    };
  },
};

/** Whether this id has a model of its own (every other id is held as a carbine). */
export function hasWeaponModel(id: string): boolean {
  return id in BUILDERS;
}

/** Build the model for a loadout id. Every call is a fresh group; the materials are shared. */
export function createWeaponModel(id: string): WeaponModel {
  const key = hasWeaponModel(id) ? id : 'carbine';
  const object = new THREE.Group();
  object.name = `weapon ${key}`;
  const spec = (BUILDERS[key] as Builder)(object);
  return { id: key, object, spec };
}
