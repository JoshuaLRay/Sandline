/**
 * U-017: the weapons lying on the ground — each replicated pickup drawn as
 * its weapon's model (the enemy's version, since it was an enemy's), laid
 * on its side where the host says it fell, facing the way the body faced.
 * One model per pickup netId, made when it first appears and taken away the
 * frame the host stops sending it (taken, expired, or cleared by a retry).
 *
 * The models share their generated geometry with every other weapon drawn,
 * so going away is leaving the scene, not disposing anything.
 */
import * as THREE from 'three';
import { WEAPON_IDS } from '@sandline/shared';
import type { RemotePickup } from '../net/NetClient.ts';
import { createWeaponModel } from './weaponModels.ts';

/** Lying on the ground: its side down, a few centimetres up so it does not sink into the floor. */
const LIE_ROLL = Math.PI / 2;
const LIE_HEIGHT = 0.04;

/**
 * U-018: the pickup nearest `eye` within `reachM` of it, for the interact
 * prompt — a hint: the host judges the press, the line to the gun included.
 */
export function pickupInReach(pickups: readonly RemotePickup[], eye: { x: number; y: number; z: number }, reachM: number): RemotePickup | null {
  let best: RemotePickup | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const p of pickups) {
    const d = Math.hypot(eye.x - p.x, eye.y - p.y, eye.z - p.z);
    if (d <= reachM && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

export class PickupModels {
  private readonly models = new Map<number, THREE.Group>();

  constructor(private readonly scene: THREE.Scene) {}

  /** Match the drawn weapons to what the host says lies on the ground. */
  update(pickups: readonly RemotePickup[]): void {
    const seen = new Set<number>();
    for (const p of pickups) {
      seen.add(p.netId);
      let root = this.models.get(p.netId);
      if (!root) {
        const id = WEAPON_IDS[p.weapon] ?? WEAPON_IDS[0];
        root = new THREE.Group();
        root.name = `pickup ${id} ${p.netId}`;
        const model = createWeaponModel(id, 'enemy');
        model.object.rotation.z = LIE_ROLL;
        root.add(model.object);
        this.scene.add(root);
        this.models.set(p.netId, root);
      }
      root.position.set(p.x, p.y + LIE_HEIGHT, p.z);
      root.rotation.y = (p.yaw / 1024) * Math.PI * 2;
    }
    for (const [netId, root] of this.models) {
      if (seen.has(netId)) continue;
      this.scene.remove(root);
      this.models.delete(netId);
    }
  }

  /** Every pickup gone: a session left. */
  clear(): void {
    this.update([]);
  }

  /** How many are drawn. */
  get count(): number {
    return this.models.size;
  }
}
