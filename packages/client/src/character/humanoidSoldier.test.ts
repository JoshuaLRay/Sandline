import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_HITBOX, bodyParts } from '@sandline/server';
import { DEFAULT_MUZZLE_RIG } from '@sandline/shared';
import { HUMANOID_BONES, type HumanoidBoneName, rigOf, requireRig } from './humanoidRig.ts';
import { AIM_IN_CHEST, createHumanoidSoldier, setSoldierPalette, soldierSkin } from './humanoidSoldier.ts';
import { HUMANOID_HIT_RADIUS, HUMANOID_ROOT_LIFT_M, createHumanoidPlaceholder } from './humanoidPlaceholder.ts';
import { createLocomotionPoseDriver } from './locomotionPose.ts';
import { ATLAS_SIZE, CELLS, CELL_SIZE, soldierAtlas } from './soldierTexture.ts';
import type { LocomotionResult } from './locomotionState.ts';

const WALK: LocomotionResult = {
  state: 'walk',
  direction: 'forward',
  speed: 4.2,
  normalizedSpeed: 1,
  gaitRate: 1,
  airborne: false,
  directionAngle: 0,
  vaultProgress: 0,
};
const IDLE: LocomotionResult = { ...WALK, state: 'idle', speed: 0, normalizedSpeed: 0, gaitRate: 0 };

/** World position of a bone, with the root placed the way main.ts places it. */
function worldOf(root: THREE.Object3D, name: HumanoidBoneName | 'aim'): THREE.Vector3 {
  root.updateMatrixWorld(true);
  const node = name === 'aim' ? requireRig(root).aim : requireRig(root).bone(name);
  if (!node) throw new Error(name);
  return new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
}

function boneSnapshot(root: THREE.Object3D) {
  const rig = requireRig(root);
  return HUMANOID_BONES.map((name) => {
    const bone = rig.bone(name);
    if (!bone) throw new Error(name);
    return { name, p: bone.position.toArray(), q: bone.quaternion.toArray() };
  });
}

/** Where the skin's vertex `i` is now, in model space, by the CPU skinning path. */
function skinnedVertex(skin: THREE.SkinnedMesh, i: number): THREE.Vector3 {
  skin.updateMatrixWorld(true);
  skin.skeleton.update();
  return skin.applyBoneTransform(i, new THREE.Vector3().fromBufferAttribute(skin.geometry.getAttribute('position') as THREE.BufferAttribute, i));
}

describe('skinned soldier (T-2.22)', () => {
  it('returns the SERVER hit capsule as the root, with the skin and rifle under it', () => {
    const soldier = createHumanoidSoldier('local');
    expect(soldier.geometry).toBeInstanceOf(THREE.CapsuleGeometry);
    expect((soldier.material as THREE.Material).visible).toBe(false);
    const skin = soldierSkin(soldier);
    expect(skin).toBeInstanceOf(THREE.SkinnedMesh);
    expect(skin.skeleton.bones.map((b) => b.name)).toEqual(HUMANOID_BONES);
    expect(skin.geometry.getAttribute('skinIndex').count).toBe(skin.geometry.getAttribute('position').count);
    expect(soldier.getObjectByName('rifle')).toBeInstanceOf(THREE.Mesh);

    // The raycast the harness runs: root only, non-recursive, head to shin.
    soldier.position.set(0, DEFAULT_HITBOX.centerOffsetY, 0);
    soldier.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const hitsAt = (y: number): boolean => {
      ray.set(new THREE.Vector3(0, y, -5), new THREE.Vector3(0, 0, 1));
      return ray.intersectObject(soldier, false).length > 0;
    };
    expect(hitsAt(1.65)).toBe(true);
    expect(hitsAt(0.9)).toBe(true);
    expect(hitsAt(0.3)).toBe(true);
    expect(hitsAt(1.9)).toBe(false);
    expect(hitsAt(-0.1)).toBe(false);
  });

  it('stands a 1.8 m soldier on its feet under the root, one draw call of skin', () => {
    const soldier = createHumanoidSoldier('remote');
    soldier.position.set(4, HUMANOID_ROOT_LIFT_M, -2);
    const head = worldOf(soldier, 'head');
    const foot = worldOf(soldier, 'foot-left');
    expect(head.y).toBeCloseTo(1.58, 6);
    expect(foot.y).toBeCloseTo(0.06, 6);
    expect(head.x).toBeCloseTo(4, 6);
    expect(foot.z).toBeCloseTo(-2, 6);
    // The bind pose is the identity: every bone inverse is a pure translation,
    // so a joint's local axes are the model's axes and a pose is plain Eulers.
    const skinAtBind = soldierSkin(soldier);
    for (const inverse of skinAtBind.skeleton.boneInverses) {
      const q = new THREE.Quaternion().setFromRotationMatrix(inverse);
      expect(q.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);
    }
    // And below the arms, which hold the rifle, the standing pose is the bind pose.
    for (const name of ['hips', 'spine', 'chest', 'neck', 'head', 'upper-leg-left', 'lower-leg-right', 'foot-left'] as const) {
      expect(requireRig(soldier).bone(name)!.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    }
    // One skinned mesh, one material; the rifle is the only other draw.
    let meshes = 0;
    soldier.traverse((o) => { if (o instanceof THREE.Mesh && o !== soldier && o.visible) meshes += 1; });
    expect(meshes).toBe(2);
    const skin = soldierSkin(soldier);
    expect(Array.isArray(skin.material)).toBe(false);
    expect(skin.castShadow).toBe(true);
    // Well inside ADR-013's 8–15k triangles.
    expect(skin.geometry.index!.count / 3).toBeLessThan(4000);
  });

  it('textures the whole soldier from one atlas, every vertex inside a cell (T-2.30)', () => {
    const soldier = createHumanoidSoldier('local');
    const skin = soldierSkin(soldier);
    const material = skin.material as THREE.MeshStandardMaterial;
    expect(material.map).toBe(soldierAtlas('local'));
    // The atlas replaced the flat per-segment vertex colours outright: it says
    // everything they said and the things they could not.
    expect(material.vertexColors).toBe(false);
    expect(skin.geometry.getAttribute('color')).toBeUndefined();

    const uv = skin.geometry.getAttribute('uv');
    expect(uv.count).toBe(skin.geometry.getAttribute('position').count);
    // Every vertex sits strictly inside some cell — never on a cell boundary,
    // which under nearest filtering is a stripe of the neighbouring part.
    const origins = new Set(Object.values(CELLS).map((c) => `${c.x},${c.y}`));
    const used = new Set<string>();
    for (let i = 0; i < uv.count; i += 1) {
      const x = Math.floor(uv.getX(i) * ATLAS_SIZE);
      const y = Math.floor(uv.getY(i) * ATLAS_SIZE);
      const origin = `${Math.floor(x / CELL_SIZE) * CELL_SIZE},${Math.floor(y / CELL_SIZE) * CELL_SIZE}`;
      expect(origins.has(origin)).toBe(true);
      used.add(origin);
    }
    // The body reaches for most of the atlas; a layout mostly unused is a
    // layout that has drifted from the model.
    expect(used.size).toBeGreaterThanOrEqual(10);

    // The rifle is textured from the same atlas, so it stays the second draw
    // rather than becoming a third material.
    const rifle = soldier.getObjectByName('rifle') as THREE.Mesh;
    expect((rifle.material as THREE.MeshStandardMaterial).map).toBe(soldierAtlas('local'));
  });

  it('lights the soldier the way 2002 did: diffuse only, smooth normals (T-2.32)', () => {
    const soldier = createHumanoidSoldier('local');
    const skin = soldierSkin(soldier);
    const material = skin.material as THREE.MeshLambertMaterial;
    // A PBR material is a modern look by construction — a roughness response
    // and an environment term the era had no way to compute.
    expect(material).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(material).not.toBeInstanceOf(THREE.MeshStandardMaterial);
    expect((soldier.getObjectByName('rifle') as THREE.Mesh).material).toBeInstanceOf(THREE.MeshLambertMaterial);
    // And NOT flat-shaded: that is the wrong console. The PS2 interpolated
    // per-vertex lighting across a triangle, so curved surfaces read smooth
    // and only the silhouette gave the polygon count away. Faceted shading is
    // a 2015 indie look; PS1 is the jitter and the warp, and we have neither.
    expect(material.flatShading).toBe(false);
  });

  it('gives each variant its own palette off one shared texture (T-2.30)', () => {
    const a = createHumanoidSoldier('local');
    const b = createHumanoidSoldier('remote');
    expect((soldierSkin(a).material as THREE.MeshStandardMaterial).map)
      .not.toBe((soldierSkin(b).material as THREE.MeshStandardMaterial).map);
    // Two soldiers of the same variant share the texture: six of a squad are
    // six draws of one 256² atlas, not six atlases.
    const c = createHumanoidSoldier('local');
    expect((soldierSkin(c).material as THREE.MeshStandardMaterial).map)
      .toBe((soldierSkin(a).material as THREE.MeshStandardMaterial).map);
    // Same geometry either way: a palette is never a mesh change.
    expect(soldierSkin(a).geometry.getAttribute('uv').array)
      .toEqual(soldierSkin(b).geometry.getAttribute('uv').array);
  });

  it('keeps the chunky silhouette inside the capsule the server shoots at (T-2.31)', () => {
    // A stockier soldier is an art change; a soldier whose shoulder, pack or
    // boot sticks out of DEFAULT_HITBOX is a netcode bug wearing art's
    // clothes — you would see rounds pass through visible kit. The skin may
    // be any shape it likes inside the capsule's radius and no shape outside.
    const soldier = createHumanoidSoldier('local');
    const skin = soldierSkin(soldier);
    const position = skin.geometry.getAttribute('position');
    let worst = 0;
    for (let i = 0; i < position.count; i += 1) {
      worst = Math.max(worst, Math.hypot(position.getX(i), position.getZ(i)));
    }
    expect(worst).toBeLessThanOrEqual(HUMANOID_HIT_RADIUS);
    // And it genuinely fills that capsule rather than hiding in the middle of
    // it: a thin soldier in a fat hitbox is the same fault the other way up.
    expect(worst).toBeGreaterThan(HUMANOID_HIT_RADIUS * 0.8);
  });

  it('stays inside the triangle guard after the silhouette pass (T-2.31)', () => {
    const tris = soldierSkin(createHumanoidSoldier('local')).geometry.index!.count / 3;
    // Faceting the limbs bought more than the gear slabs cost, so this went
    // DOWN. Both bounds matter: the ceiling is ADR-013's budget, the floor
    // catches a "simplification" that quietly deletes the era's gear.
    expect(tris).toBeLessThan(4000);
    expect(tris).toBeGreaterThan(600);
  });

  it('repaints a live soldier without touching mesh, skeleton or pose (T-2.33)', () => {
    // ADR-001's bot/human swap happens on a LIVE entity, never by rebuilding
    // the session. A slot changing hands must therefore be a texture swap and
    // nothing else — not a new mesh, not a new material, not a lost pose.
    const soldier = createHumanoidSoldier('remote');
    const skin = soldierSkin(soldier);
    const rig = requireRig(soldier);
    rig.setPose('crouched');
    const before = {
      geometry: skin.geometry,
      material: skin.material,
      skeleton: skin.skeleton,
      bones: boneSnapshot(soldier),
    };

    expect(setSoldierPalette(soldier, 'slot-3')).toBe(true);
    expect((skin.material as THREE.MeshLambertMaterial).map).toBe(soldierAtlas('slot-3'));
    expect(skin.geometry).toBe(before.geometry);
    expect(skin.material).toBe(before.material);
    expect(skin.skeleton).toBe(before.skeleton);
    expect(boneSnapshot(soldier)).toEqual(before.bones);
    expect(rig.pose).toBe('crouched');
    // The rifle follows the body it is held by.
    expect(((soldier.getObjectByName('rifle') as THREE.Mesh).material as THREE.MeshLambertMaterial).map)
      .toBe(soldierAtlas('slot-3'));

    // The grey box has no atlas to swap and says so rather than throwing:
    // `?greybox` is a diagnostic fixture, not a soldier.
    expect(setSoldierPalette(createHumanoidPlaceholder('remote'), 'slot-3')).toBe(false);
  });

  it('keeps local and remote soldiers on one skeleton without sharing materials', () => {
    const a = createHumanoidSoldier('local');
    const b = createHumanoidSoldier('remote');
    expect(boneSnapshot(a)).toEqual(boneSnapshot(b));
    expect(soldierSkin(a).material).not.toBe(soldierSkin(b).material);
    expect(soldierSkin(a).skeleton).not.toBe(soldierSkin(b).skeleton);
  });

  it('puts the rifle at the shared muzzle rig\'s shoulder and both hands on it', () => {
    const soldier = createHumanoidSoldier('local');
    soldier.position.set(0, HUMANOID_ROOT_LIFT_M, 0);
    const aim = worldOf(soldier, 'aim');
    // Right is -X for a soldier facing +Z (muzzle.ts: right = cross(forward, up)).
    expect(aim.x).toBeCloseTo(-DEFAULT_MUZZLE_RIG.shoulderRight, 6);
    expect(aim.y).toBeCloseTo(DEFAULT_MUZZLE_RIG.shoulderHeight, 6);
    expect(AIM_IN_CHEST[0]).toBe(-DEFAULT_MUZZLE_RIG.shoulderRight);
    // Downed lets go of the rifle (and hides it); the other poses hold it.
    for (const pose of ['standing', 'crouched', 'prone'] as const) {
      requireRig(soldier).setPose(pose);
      const at = worldOf(soldier, 'aim');
      const right = worldOf(soldier, 'hand-right');
      const left = worldOf(soldier, 'hand-left');
      // Hands within a hand's breadth of the weapon, whatever the pose does to the chest.
      expect(right.distanceTo(at)).toBeLessThan(0.3);
      expect(left.distanceTo(at)).toBeLessThan(0.5);
      // The left hand is the forward one.
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(requireRig(soldier).aim.getWorldQuaternion(new THREE.Quaternion()));
      expect(left.clone().sub(at).dot(forward)).toBeGreaterThan(right.clone().sub(at).dot(forward));
    }
  });

  it('crouches and lies down by moving bones only; the root and the standing pose are exact', () => {
    const soldier = createHumanoidSoldier('remote');
    soldier.position.set(3, HUMANOID_ROOT_LIFT_M, -2);
    soldier.rotation.y = 0.7;
    const rootBefore = { p: soldier.position.toArray(), q: soldier.quaternion.toArray(), g: soldier.geometry };
    const rig = requireRig(soldier);
    const standing = boneSnapshot(soldier);
    const standingHead = worldOf(soldier, 'head').y;

    rig.setPose('crouched');
    expect(rig.pose).toBe('crouched');
    expect(worldOf(soldier, 'head').y).toBeLessThan(standingHead - 0.35);
    // The feet stay on the ground, or near enough that the boots hide it.
    expect(worldOf(soldier, 'foot-left').y).toBeGreaterThan(-0.06);
    expect(worldOf(soldier, 'foot-right').y).toBeGreaterThan(-0.06);
    expect(worldOf(soldier, 'foot-left').y).toBeLessThan(0.12);
    const crouched = boneSnapshot(soldier);

    rig.setPose('downed');
    expect(rig.pose).toBe('downed');
    // On the back at the downed lift, head forward along the facing, rifle hidden.
    const head = worldOf(soldier, 'head');
    const foot = worldOf(soldier, 'foot-left');
    expect(Math.abs(head.y - 0.28)).toBeLessThan(0.2);
    expect(Math.abs(foot.y - 0.28)).toBeLessThan(0.2);
    const facing = new THREE.Vector3(Math.sin(0.7), 0, Math.cos(0.7));
    expect(head.clone().sub(soldier.position).dot(facing)).toBeGreaterThan(0.4);
    expect(foot.clone().sub(soldier.position).dot(facing)).toBeLessThan(-0.4);
    expect(rig.aim.visible).toBe(false);
    // B-05: not a flat scarecrow — the torso rolls so one shoulder rides
    // clear of the ground (world Y is yaw-invariant, so this holds at any
    // facing), and the near hand comes up off the ground onto the abdomen
    // rather than lying open at the side like the far one.
    const shoulderLeft = worldOf(soldier, 'upper-arm-left');
    const shoulderRight = worldOf(soldier, 'upper-arm-right');
    expect(Math.abs(shoulderLeft.y - shoulderRight.y)).toBeGreaterThan(0.08);
    const handLeft = worldOf(soldier, 'hand-left');
    const handRight = worldOf(soldier, 'hand-right');
    expect(handRight.y).toBeGreaterThan(handLeft.y + 0.3);

    rig.setPose('standing');
    expect(boneSnapshot(soldier)).toEqual(standing);
    expect(rig.aim.visible).toBe(true);
    rig.setPose('crouched');
    expect(boneSnapshot(soldier)).toEqual(crouched);
    rig.setPose('crouched');
    expect(boneSnapshot(soldier)).toEqual(crouched);

    expect(soldier.position.toArray()).toEqual(rootBefore.p);
    expect(soldier.quaternion.toArray()).toEqual(rootBefore.q);
    expect(soldier.geometry).toBe(rootBefore.g);
  });

  it('is shot where it is drawn: the server body covers the skin in every pose, and is no bigger', () => {
    const distanceToSegment = (p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number => {
      const ab = b.clone().sub(a);
      const t = ab.lengthSq() > 0 ? Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())) : 0;
      return p.distanceTo(a.clone().addScaledVector(ab, t));
    };
    for (const pose of ['standing', 'crouched', 'prone', 'downed', 'dead'] as const) {
      const soldier = createHumanoidSoldier('remote');
      soldier.position.set(0, HUMANOID_ROOT_LIFT_M, 0);
      requireRig(soldier).setPose(pose);
      soldier.updateMatrixWorld(true);
      const skin = soldierSkin(soldier);
      skin.skeleton.update();
      const vertices = skin.geometry.getAttribute('position') as THREE.BufferAttribute;
      const points: THREE.Vector3[] = [];
      for (let i = 0; i < vertices.count; i += 1) {
        points.push(skin.applyBoneTransform(i, new THREE.Vector3().fromBufferAttribute(vertices, i)).applyMatrix4(skin.matrixWorld));
      }
      // Feet at the origin, facing +Z: the server's frame for the same body.
      const parts = bodyParts(DEFAULT_HITBOX, pose, { x: 0, y: 0, z: 0 }, 0).map((p) => ({
        a: new THREE.Vector3(p.a.x, p.a.y, p.a.z),
        b: new THREE.Vector3(p.b.x, p.b.y, p.b.z),
        radius: p.radius,
      }));
      const outside = (p: THREE.Vector3) => Math.min(...parts.map((c) => distanceToSegment(p, c.a, c.b) - c.radius));
      // Covers: 95% of the skin's vertices are inside a capsule, within 5 cm, and none far out.
      const covered = points.filter((p) => outside(p) <= 0.05).length / points.length;
      const worst = Math.max(...points.map(outside));
      console.log(`${pose}: ${(covered * 100).toFixed(1)}% of the skin inside the server body, farthest out ${(worst * 100).toFixed(0)} cm`);
      expect(covered, pose).toBeGreaterThan(0.95);
      expect(worst, pose).toBeLessThan(0.15);
      // No bigger: every capsule's axis runs through the skin, not through air.
      for (const c of parts) {
        for (const t of [0, 0.5, 1]) {
          const q = c.a.clone().lerp(c.b, t);
          const nearest = Math.min(...points.map((p) => p.distanceTo(q)));
          expect(nearest, `${pose} capsule axis at ${t}`).toBeLessThan(c.radius + 0.02);
        }
      }
    }
  });

  it('lies dead face down with both hands above the head on the ground, unlike downed', () => {
    const soldier = createHumanoidSoldier('remote');
    soldier.position.set(3, HUMANOID_ROOT_LIFT_M, -2);
    soldier.rotation.y = 0.7;
    const rig = requireRig(soldier);
    rig.setPose('downed');
    const downed = boneSnapshot(soldier);
    rig.setPose('dead');
    expect(rig.pose).toBe('dead');
    expect(rig.aim.visible).toBe(false);
    expect(boneSnapshot(soldier)).not.toEqual(downed);
    const facing = new THREE.Vector3(Math.sin(0.7), 0, Math.cos(0.7));
    const ground = soldier.position.y - HUMANOID_ROOT_LIFT_M;
    const along = (name: HumanoidBoneName) => worldOf(soldier, name).sub(soldier.position).dot(facing);
    // Head forward, feet back, both hands past the head.
    expect(along('head')).toBeGreaterThan(0.4);
    expect(along('foot-left')).toBeLessThan(-0.4);
    for (const hand of ['hand-left', 'hand-right'] as const) {
      expect(along(hand), hand).toBeGreaterThan(along('head') + 0.1);
      expect(worldOf(soldier, hand).y - ground, hand).toBeLessThan(0.3);
    }
    // Face down: the chest's front points at the ground.
    const chestQ = rig.bone('chest')!.getWorldQuaternion(new THREE.Quaternion());
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(chestQ).y).toBeLessThan(-0.9);
    // Flat on the ground, and nothing under it.
    const skin = soldierSkin(soldier);
    skin.skeleton.update();
    const vertices = skin.geometry.getAttribute('position') as THREE.BufferAttribute;
    let lowest = Infinity;
    let highest = -Infinity;
    for (let i = 0; i < vertices.count; i += 1) {
      const v = skin.applyBoneTransform(i, new THREE.Vector3().fromBufferAttribute(vertices, i)).applyMatrix4(skin.matrixWorld);
      lowest = Math.min(lowest, v.y);
      highest = Math.max(highest, v.y);
    }
    console.log(`dead: skin from ${(lowest - ground).toFixed(3)} to ${(highest - ground).toFixed(3)} m over the ground`);
    expect(lowest - ground).toBeGreaterThan(-0.03);
    expect(highest - ground).toBeLessThan(0.55);
  });

  it('goes prone by moving bones only, structurally distinct from crouch and downed, and restores exactly (T-2.41)', () => {
    const soldier = createHumanoidSoldier('remote');
    soldier.position.set(3, HUMANOID_ROOT_LIFT_M, -2);
    soldier.rotation.y = 0.7;
    const rootBefore = { p: soldier.position.toArray(), q: soldier.quaternion.toArray(), g: soldier.geometry };
    const rig = requireRig(soldier);
    const standing = boneSnapshot(soldier);

    rig.setPose('crouched');
    const crouched = boneSnapshot(soldier);
    rig.setPose('downed');
    const downed = boneSnapshot(soldier);

    rig.setPose('prone');
    expect(rig.pose).toBe('prone');
    // Unlike downed, prone keeps the weapon in hand and aimable.
    expect(rig.aim.visible).toBe(true);
    // Face down along the facing, head forward, feet back — not on the back.
    const head = worldOf(soldier, 'head');
    const foot = worldOf(soldier, 'foot-left');
    const facing = new THREE.Vector3(Math.sin(0.7), 0, Math.cos(0.7));
    expect(head.clone().sub(soldier.position).dot(facing)).toBeGreaterThan(0.4);
    expect(foot.clone().sub(soldier.position).dot(facing)).toBeLessThan(-0.4);
    // Head up off the ground and looking along the facing, not into the dirt.
    const ground = soldier.position.y - HUMANOID_ROOT_LIFT_M;
    expect(head.y - ground).toBeGreaterThan(0.3);
    const headQ = rig.bone('head')!.getWorldQuaternion(new THREE.Quaternion());
    const face = new THREE.Vector3(0, 0, 1).applyQuaternion(headQ);
    expect(face.dot(facing)).toBeGreaterThan(0.95);
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(headQ).y).toBeGreaterThan(0.95);
    // No part of the skin under the ground.
    const skin = soldierSkin(soldier);
    skin.skeleton.update();
    const vertices = skin.geometry.getAttribute('position') as THREE.BufferAttribute;
    let lowest = Infinity;
    for (let i = 0; i < vertices.count; i += 1) {
      const v = skin.applyBoneTransform(i, new THREE.Vector3().fromBufferAttribute(vertices, i)).applyMatrix4(skin.matrixWorld);
      lowest = Math.min(lowest, v.y);
    }
    expect(lowest - ground).toBeGreaterThan(-0.01);
    // The rifle lies forward along the ground, butt at the right shoulder.
    const muzzle = new THREE.Vector3(0, 0, 1).applyQuaternion(rig.aim.getWorldQuaternion(new THREE.Quaternion()));
    expect(muzzle.dot(facing)).toBeGreaterThan(0.99);
    const butt = worldOf(soldier, 'aim');
    expect(butt.y - ground).toBeLessThan(0.35);
    expect(butt.distanceTo(worldOf(soldier, 'upper-arm-right'))).toBeLessThan(0.25);
    const prone = boneSnapshot(soldier);
    expect(prone).not.toEqual(crouched);
    expect(prone).not.toEqual(downed);
    expect(prone).not.toEqual(standing);

    rig.setPose('standing');
    expect(boneSnapshot(soldier)).toEqual(standing);
    rig.setPose('crouched');
    expect(boneSnapshot(soldier)).toEqual(crouched);
    rig.setPose('prone');
    expect(boneSnapshot(soldier)).toEqual(prone);
    rig.setPose('prone');
    expect(boneSnapshot(soldier)).toEqual(prone);

    expect(soldier.position.toArray()).toEqual(rootBefore.p);
    expect(soldier.quaternion.toArray()).toEqual(rootBefore.q);
    expect(soldier.geometry).toBe(rootBefore.g);
  });

  it('skins the geometry to the bones: a crouch moves the head\'s vertices down', () => {
    const soldier = createHumanoidSoldier('local');
    const skin = soldierSkin(soldier);
    const skinIndex = skin.geometry.getAttribute('skinIndex');
    const headBone = HUMANOID_BONES.indexOf('head');
    let headVertex = -1;
    for (let i = 0; i < skinIndex.count; i += 1) if (skinIndex.getX(i) === headBone) { headVertex = i; break; }
    expect(headVertex).toBeGreaterThanOrEqual(0);
    const standing = skinnedVertex(skin, headVertex);
    // At rest the skin is exactly the authored geometry.
    expect(standing.y).toBeCloseTo(skin.geometry.getAttribute('position').getY(headVertex), 6);
    requireRig(soldier).setPose('crouched');
    const crouched = skinnedVertex(skin, headVertex);
    expect(crouched.y).toBeLessThan(standing.y - 0.35);
    requireRig(soldier).setPose('standing');
    expect(skinnedVertex(skin, headVertex).y).toBeCloseTo(standing.y, 9);
  });
});

describe('the gait on the skinned rig (T-2.22)', () => {
  it('bends knees, bobs the hips and leaves the root, aim and hands alone', () => {
    const soldier = createHumanoidSoldier('local');
    soldier.position.set(1, HUMANOID_ROOT_LIFT_M, 1);
    const rig = requireRig(soldier);
    const driver = createLocomotionPoseDriver(rig);
    const rootBefore = { p: soldier.position.toArray(), q: soldier.quaternion.toArray() };
    const aimBefore = rig.aim.position.toArray();
    const hipsRest = rig.bone('hips')!.position.y;
    const identity = new THREE.Quaternion();
    let kneeBent = false;
    let bobbed = false;
    for (let i = 0; i < 40; i += 1) {
      driver.update(WALK, 1 / 60);
      if (rig.bone('lower-leg-left')!.quaternion.angleTo(identity) > 0.2) kneeBent = true;
      if (rig.bone('hips')!.position.y < hipsRest - 0.01) bobbed = true;
      // The hands ride the chest, so they stay on the rifle through the stride.
      expect(worldOf(soldier, 'hand-right').distanceTo(worldOf(soldier, 'aim'))).toBeLessThan(0.3);
    }
    expect(kneeBent).toBe(true);
    expect(bobbed).toBe(true);
    // Knees only ever bend backwards.
    for (let i = 0; i < 40; i += 1) {
      driver.update(WALK, 1 / 60);
      const e = new THREE.Euler().setFromQuaternion(rig.bone('lower-leg-right')!.quaternion, 'XYZ');
      expect(e.x).toBeGreaterThanOrEqual(-1e-9);
    }
    expect(soldier.position.toArray()).toEqual(rootBefore.p);
    expect(soldier.quaternion.toArray()).toEqual(rootBefore.q);
    expect(rig.aim.position.toArray()).toEqual(aimBefore);
  });

  it('is the crouch with a gait on it, and idle in a crouch is exactly the crouch', () => {
    const soldier = createHumanoidSoldier('remote');
    const rig = requireRig(soldier);
    const driver = createLocomotionPoseDriver(rig);
    rig.setPose('crouched');
    const crouched = boneSnapshot(soldier);
    driver.update({ ...WALK, state: 'crouch-walk', speed: 2 }, 0.1);
    expect(boneSnapshot(soldier)).not.toEqual(crouched);
    // Legs swing about the crouched thigh angle, not about standing.
    const thigh = new THREE.Euler().setFromQuaternion(rig.bone('upper-leg-left')!.quaternion, 'XYZ');
    expect(thigh.x).toBeLessThan(-0.9);
    driver.update({ ...IDLE, state: 'idle' }, 1 / 60);
    expect(boneSnapshot(soldier)).toEqual(crouched);
    rig.setPose('standing');
    expect(boneSnapshot(soldier)).toEqual(boneSnapshot(createHumanoidSoldier('remote')));
  });

  it('is the prone pose with a gait on it, and idle prone is exactly the prone pose (T-2.41)', () => {
    const soldier = createHumanoidSoldier('remote');
    const rig = requireRig(soldier);
    const driver = createLocomotionPoseDriver(rig);
    rig.setPose('prone');
    const prone = boneSnapshot(soldier);
    driver.update({ ...WALK, state: 'prone', speed: 1 }, 0.1);
    expect(boneSnapshot(soldier)).not.toEqual(prone);
    driver.update({ ...IDLE, state: 'idle' }, 1 / 60);
    expect(boneSnapshot(soldier)).toEqual(prone);
    rig.setPose('standing');
    expect(boneSnapshot(soldier)).toEqual(boneSnapshot(createHumanoidSoldier('remote')));
  });

  it('returns to the exact factory rest after walking, on both rigs, at any frame rate', () => {
    for (const make of [createHumanoidSoldier, createHumanoidPlaceholder]) {
      const a = make('local');
      const b = make('local');
      const da = createLocomotionPoseDriver(a);
      const db = createLocomotionPoseDriver(b);
      for (let i = 0; i < 60; i += 1) da.update(WALK, 1 / 60);
      for (let i = 0; i < 30; i += 1) db.update(WALK, 1 / 30);
      expect(da.phase).toBeCloseTo(db.phase, 10);
      const snapA = boneSnapshotLoose(a);
      const snapB = boneSnapshotLoose(b);
      for (let i = 0; i < snapA.length; i += 1) {
        for (let k = 0; k < 4; k += 1) expect(Math.abs(snapA[i]!.q[k]! - snapB[i]!.q[k]!)).toBeLessThan(1e-9);
      }
      da.update(IDLE, 1 / 60);
      expect(boneSnapshotLoose(a)).toEqual(boneSnapshotLoose(make('local')));
    }
  });

  it('registers a rig on both factories\' roots, and only there', () => {
    expect(rigOf(createHumanoidSoldier('local'))?.kind).toBe('skinned');
    expect(rigOf(createHumanoidPlaceholder('local'))?.kind).toBe('grey-box');
    expect(rigOf(new THREE.Object3D())).toBeNull();
    // The grey box has no knees; the contract says so rather than pretending.
    const grey = requireRig(createHumanoidPlaceholder('remote'));
    expect(grey.bone('lower-leg-left')).toBeNull();
    expect(grey.bone('upper-leg-left')?.name).toBe('leg-left');
    expect(grey.style.kneeBend).toBe(0);
  });
});

/** Bones the rig has, whichever rig it is. */
function boneSnapshotLoose(root: THREE.Object3D) {
  const rig = requireRig(root);
  const out: { name: string; p: number[]; q: number[] }[] = [];
  for (const name of HUMANOID_BONES) {
    const bone = rig.bone(name);
    if (bone) out.push({ name, p: bone.position.toArray(), q: bone.quaternion.toArray() });
  }
  return out;
}
