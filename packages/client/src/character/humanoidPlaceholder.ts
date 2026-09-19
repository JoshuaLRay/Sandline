import * as THREE from 'three';

/**
 * M2 gameplay character placeholder.
 *
 * This is intentionally grey-box art: it gives camera, locomotion, aiming and
 * animation work a recognizable human silhouette without pretending to be the
 * production soldier asset that belongs in M4/M5. One factory keeps local and
 * remote soldiers on the same proportions while they are still placeholders.
 *
 * The root is a torso mesh rather than a Group so the existing QA raycaster can
 * keep treating a player as one hittable object. Limbs and equipment are
 * visual children of that same root.
 */
export type HumanoidVariant = 'local' | 'remote';

export function createHumanoidPlaceholder(variant: HumanoidVariant): THREE.Mesh {
  const local = variant === 'local';
  const root = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.72, 0.34),
    new THREE.MeshStandardMaterial({ color: local ? 0xf0b429 : 0xb9a37a, roughness: 0.85 }),
  );
  root.name = local ? 'humanoid local' : 'humanoid remote';
  root.castShadow = true;

  const skin = new THREE.MeshStandardMaterial({ color: 0xc99572, roughness: 0.9 });
  const uniform = new THREE.MeshStandardMaterial({ color: local ? 0x5f6748 : 0x6f7458, roughness: 0.95 });
  const gear = new THREE.MeshStandardMaterial({ color: 0x2f3329, roughness: 1 });
  const weapon = new THREE.MeshStandardMaterial({ color: 0x20231f, roughness: 0.8 });

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 10, 8), skin);
  head.name = 'head';
  head.position.set(0, 0.62, 0);
  root.add(head);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.52), gear);
  helmet.name = 'helmet';
  helmet.position.set(0, 0.69, 0);
  root.add(helmet);

  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.3), uniform);
  pelvis.name = 'pelvis';
  pelvis.position.set(0, -0.5, 0);
  root.add(pelvis);

  for (const side of [-1, 1] as const) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.43, 4, 8), uniform);
    arm.name = side < 0 ? 'arm-left' : 'arm-right';
    arm.position.set(side * 0.43, 0.02, 0);
    arm.rotation.z = side * -0.12;
    root.add(arm);

    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.5, 4, 8), uniform);
    leg.name = side < 0 ? 'leg-left' : 'leg-right';
    leg.position.set(side * 0.17, -0.9, 0);
    root.add(leg);

    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.12, 0.38), gear);
    boot.name = side < 0 ? 'boot-left' : 'boot-right';
    boot.position.set(side * 0.17, -1.2, 0.08);
    root.add(boot);
  }

  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.52, 0.18), gear);
  backpack.name = 'backpack';
  backpack.position.set(0, -0.02, -0.25);
  root.add(backpack);

  const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.95), weapon);
  rifle.name = 'rifle';
  rifle.position.set(0.35, 0.02, 0.48);
  rifle.rotation.x = Math.PI / 2;
  root.add(rifle);

  return root;
}
