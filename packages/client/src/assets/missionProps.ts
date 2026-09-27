/**
 * U-011: what a world's mission asks you to touch, drawn where it is — each
 * upload objective's terminal and, when it has one, the lever the enemy
 * goes for. From the committed mission data (`missionFor`), so a page shows
 * them for whichever world it is in; they collide with nothing (the panel
 * and the lever stand on the level's own geometry, and the nav bake is
 * untouched) and take no rounds.
 *
 * Grey-box props, like the rest of the grey box: a waist-high console with a
 * lit screen facing where you stand to use it, and a post with a red handle.
 */
import * as THREE from 'three';
import { type MissionDef, type MissionPoint, missionFor } from '@sandline/shared';

/** The console's footprint and height, metres. */
const CONSOLE = { w: 0.7, d: 0.35, h: 0.95 };
const LEVER_POST = { r: 0.06, h: 1.1 };

const consoleMat = new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.7, metalness: 0.3 });
const screenMat = new THREE.MeshStandardMaterial({ color: 0x0f2a18, emissive: 0x2fd46a, emissiveIntensity: 0.9, roughness: 0.4 });
const postMat = new THREE.MeshStandardMaterial({ color: 0x5a5e62, roughness: 0.6, metalness: 0.5 });
const handleMat = new THREE.MeshStandardMaterial({ color: 0xb8322a, roughness: 0.5 });

/** Where each of a mission's props stands, facing: the terminals and levers of its uploads. */
export function missionPropPlaces(mission: MissionDef | undefined): { kind: 'terminal' | 'lever'; at: MissionPoint; label: string }[] {
  const out: { kind: 'terminal' | 'lever'; at: MissionPoint; label: string }[] = [];
  for (const o of mission?.objectives ?? []) {
    if (o.type !== 'upload') continue;
    out.push({ kind: 'terminal', at: o.terminal, label: o.label });
    if (o.lever) out.push({ kind: 'lever', at: o.lever.at, label: o.label });
  }
  return out;
}

function terminalModel(at: MissionPoint): THREE.Group {
  const g = new THREE.Group();
  // The console stands on the floor under the panel point, the panel at its top.
  const body = new THREE.Mesh(new THREE.BoxGeometry(CONSOLE.w, CONSOLE.h, CONSOLE.d), consoleMat);
  body.position.y = CONSOLE.h / 2;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(CONSOLE.w * 0.8, 0.3), screenMat);
  screen.position.set(0, CONSOLE.h + 0.12, -CONSOLE.d / 2 + 0.05);
  screen.rotation.x = -0.35;
  screen.rotation.y = Math.PI;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(CONSOLE.w, 0.3, 0.08), consoleMat);
  lid.position.set(0, CONSOLE.h + 0.12, -CONSOLE.d / 2 + 0.1);
  lid.rotation.x = -0.35;
  g.add(body, lid, screen);
  g.position.set(at.x, Math.max(0, at.y - CONSOLE.h - 0.05), at.z);
  return g;
}

function leverModel(at: MissionPoint): THREE.Group {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(LEVER_POST.r, LEVER_POST.r * 1.3, LEVER_POST.h, 10), postMat);
  post.position.y = LEVER_POST.h / 2;
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.2), postMat);
  box.position.y = LEVER_POST.h;
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.45, 8), handleMat);
  arm.position.set(0.12, LEVER_POST.h + 0.18, 0);
  arm.rotation.z = -0.6;
  const grip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), handleMat);
  grip.position.set(0.25, LEVER_POST.h + 0.36, 0);
  g.add(post, box, arm, grip);
  g.position.set(at.x, Math.max(0, at.y - LEVER_POST.h), at.z);
  return g;
}

/** The props of the world a page is in, rebuilt when it changes. */
export class MissionProps {
  private readonly root = new THREE.Group();

  constructor(scene: THREE.Scene) {
    this.root.name = 'mission props';
    scene.add(this.root);
  }

  /** Show the props of `worldId`'s committed mission (none for a world without one). The terminal faces the way you came from: the lower z. */
  show(worldId: string): void {
    for (const child of [...this.root.children]) {
      this.root.remove(child);
      child.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    for (const prop of missionPropPlaces(missionFor(worldId))) {
      const model = prop.kind === 'terminal' ? terminalModel(prop.at) : leverModel(prop.at);
      model.name = `${prop.kind} (${prop.label})`;
      this.root.add(model);
    }
  }

  /** How many props are up: a terminal and a lever for each upload that has both. */
  get count(): number {
    return this.root.children.length;
  }
}
