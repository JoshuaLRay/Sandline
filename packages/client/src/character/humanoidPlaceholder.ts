import * as THREE from 'three';

export type HumanoidVariant = 'local' | 'remote';

/**
 * M2 gameplay character placeholder.
 *
 * The root remains a single invisible capsule because the QA aim/tracer
 * raycaster deliberately treats each player as one shootable object. The
 * visible soldier is built from child primitives. Keeping the gameplay-sized
 * capsule as the root is important: a ray aimed at a head, arm, or leg must
 * still converge on the same silhouette-sized target that the authoritative
 * server hitbox represents.
 */
export function createHumanoidPlaceholder(variant: HumanoidVariant): THREE.Mesh {
  const local = variant === 'local';

  // Gameplay/aim proxy: the same 0.35 m radius, 1.1 m body used by the
  // authoritative capsule hitbox. It is invisible so it does not double the
  // visible grey-box soldier.
  const hitboxMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const root = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1, 6, 12), hitboxMaterial);
  root.name = local ? 'humanoid local' : 'humanoid remote';
  root.castShadow = false;

  const skin = new THREE.MeshStandardMaterial({ color: 0xc99572, roughness: 0.9 });
  const uniform = new THREE.MeshStandardMaterial({ color: local ? 0x5f6748 : 0x6f7458, roughness: 0.95 });
  const gear = new THREE.MeshStandardMaterial({ color: 0x2f3329, roughness: 1 });
  const weapon = new THREE.MeshStandardMaterial({ color: 0x20231f, roughness: 0.8 });

  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.72, 0.34),
    new THREE.MeshStandardMaterial({ color: local ? 0x7b8068 : 0x686d5b, roughness: 0.85 }),
  );
  torso.name = 'torso';
  torso.castShadow = true;
  root.add(torso);

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
  pelvis.position.set(0, -0.25, 0);
  root.add(pelvis);

  for (const side of [-1, 1] as const) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.43, 4, 8), uniform);
    arm.name = side < 0 ? 'arm-left' : 'arm-right';
    arm.position.set(side * 0.43, 0.02, 0);
    arm.rotation.z = side * -0.12;
    root.add(arm);

    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.5, 4, 8), uniform);
    leg.name = side < 0 ? 'leg-left' : 'leg-right';
    leg.position.set(side * 0.17, -0.48, 0);
    root.add(leg);

    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.12, 0.38), gear);
    boot.name = side < 0 ? 'boot-left' : 'boot-right';
    boot.position.set(side * 0.17, -0.72, 0.08);
    root.add(boot);
  }

  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.52, 0.18), gear);
  backpack.name = 'backpack';
  backpack.position.set(0, -0.02, -0.25);
  root.add(backpack);

  const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.95), weapon);
  rifle.name = 'rifle';
  rifle.position.set(0.35, 0.02, 0.48);
  root.add(rifle);

  return root;
}
