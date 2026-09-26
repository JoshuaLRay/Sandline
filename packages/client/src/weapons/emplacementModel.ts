/**
 * A weapon emplacement as the page draws it (T-4.29): a tripod on the
 * ground at the gun's place, and on its pintle the gun itself — the
 * definition's weapon, drawn as the other side's model, since a nest in a
 * compound is the enemy's gun whoever is on it now — laid the way the host
 * says it is laid. `gun` turns for yaw (about Y) and pitch (about X, up
 * positive); the tripod does not.
 */
import * as THREE from 'three';
import { getEmplacement } from '@sandline/shared';
import { createWeaponModel } from './weaponModels.ts';

export interface EmplacementModel {
  /** The whole thing, placed at the gun's place. */
  readonly root: THREE.Group;
  /** The gun on its pintle: rotate this. Its order is YXZ, yaw then pitch. */
  readonly gun: THREE.Group;
  dispose(): void;
}

const METAL = new THREE.MeshLambertMaterial({ color: 0x33352f });
const OLIVE = new THREE.MeshLambertMaterial({ color: 0x4a5330 });
const UP = new THREE.Vector3(0, 1, 0);

/** The feet of the tripod's legs, round the pintle: two ahead, one behind. */
const FEET: readonly [number, number][] = [
  [0.45, 0.3],
  [-0.45, 0.3],
  [0, -0.55],
];

export function createEmplacementModel(kind: string): EmplacementModel {
  const def = getEmplacement(kind);
  const root = new THREE.Group();
  root.name = `emplacement ${kind}`;
  const own: THREE.Mesh[] = [];
  const add = (mesh: THREE.Mesh, parent: THREE.Object3D): void => {
    mesh.castShadow = true;
    parent.add(mesh);
    own.push(mesh);
  };
  const h = def.gunHeightM;
  for (const [dx, dz] of FEET) {
    const length = Math.hypot(dx, dz, h);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, length, 6), METAL);
    leg.position.set(dx / 2, h / 2, dz / 2);
    leg.quaternion.setFromUnitVectors(UP, new THREE.Vector3(-dx, h, -dz).normalize());
    add(leg, root);
  }
  const pintle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 8), METAL);
  pintle.position.y = h - 0.03;
  add(pintle, root);

  const gun = new THREE.Group();
  gun.name = 'gun';
  gun.rotation.order = 'YXZ';
  gun.position.y = h;
  root.add(gun);
  const cradle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.28), OLIVE);
  cradle.position.set(0, -0.02, 0.06);
  add(cradle, gun);
  // The weapon models are built along +Z with the grip near the origin; the receiver goes over the pintle.
  const weapon = createWeaponModel(def.weapon, 'enemy');
  weapon.object.position.set(0, 0.06, -0.22);
  gun.add(weapon.object);

  return {
    root,
    gun,
    dispose() {
      for (const mesh of own) mesh.geometry.dispose();
      // A code-built weapon's boxes are its own; a loaded template's are shared and stay.
      if (!weapon.object.userData['asset']) {
        weapon.object.traverse((o) => {
          if (o instanceof THREE.Mesh) o.geometry.dispose();
        });
      }
    },
  };
}
