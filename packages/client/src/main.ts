/**
 * Client (T-0.06) — THE QA HOME for this project.
 *
 * Standing commitment, not a description of one task: whatever has been built
 * and can be felt, you can reach it here, and the deployed page tracks the
 * current state of the work. A task that adds something judgeable adds it to
 * this harness in the same change. A task whose output is headless (wire
 * formats, delta compression, clock sync) has nothing to add and should not
 * invent something.
 *
 * Covered today: movement (T-1.12), weapons (T-1.17), damage and respawn
 * (T-1.19), both camera views, and the netcode itself — prediction (T-1.14),
 * reconciliation (T-1.15), interpolation (T-1.16), lag compensation (T-1.18)
 * and the netgraph (T-1.23).
 *
 * This runs the same `stepCharacter` the authoritative server runs (T-1.12), at
 * the same fixed 30 Hz, driven by local input, and fires the same `tryFire` and
 * `shotDirections` the server does (T-1.17) — the same functions, not copies.
 * The session is real and in this page: see `LocalServer` for what that does
 * and does not model, and for the per-client link conditions T-1.24 needs.
 *
 * Its job is to make FEEL judgeable, since the constants in
 * DEFAULT_MOVE_CONFIG and data/weapons.json are guesses and everything
 * downstream (level scale, cover spacing, encounter pacing, animation timing)
 * is built on top of them.
 *
 * The world is solid (T-1.12): walls, crates, posts and rails stop the player
 * and stop shots, on the client and the server alike, from one shared list.
 * Flat ground and boxes only — no slopes or stairs beyond a 0.45 m step.
 */
import { showAssetShelf } from './assets/shelf.ts';
import { LevelPieces } from './assets/levelPieces.ts';
import { AssetLoader, gltfParser } from './assets/loader.ts';
import { loadDetailedSkin, loadFighterSkin } from './character/assetSoldier.ts';
import { loadWeaponAssets } from './weapons/weaponAssets.ts';
import * as THREE from 'three';
import {
  Clock,
  DEFAULT_MOVE_CONFIG,
  type MoveConfig,
  TICK_SECONDS,
  WEAPON_IDS,
  getWeapon,
  cos,
  RANGE_TARGETS,
  fromRadians,
  shotDirections,
  sin,
  DEFAULT_MUZZLE_RIG,
  type MuzzleStance,
  type ProjectileWorld,
  dirFromYawPitch,
  getProjectile,
  eyePosition,
  muzzlePosition,
  toRadians,
  wireToTable,
  zoneAt,
} from '@sandline/shared';
import { LocalInput } from './input/LocalInput.ts';
import { DEFAULT_CAMERA_CONFIG } from './camera/cameraConfig.ts';
import { type ClientLink, DEFAULT_LINK, type LinkConditions, LocalServer, type LocalServerOptions } from './net/LocalServer.ts';
import { type NavMesh, initNav } from '@sandline/server/nav';
import { NetClient, type ServerDetonation, type ServerShot } from './net/NetClient.ts';
import {
  HostUrlError,
  RemoteServer,
  type SessionSource,
  describeStatus,
  explainRejection,
  hostFromQuery,
  roomFromQuery,
  shareLink,
} from './net/RemoteServer.ts';
import { SparringPartner } from './net/SparringPartner.ts';
import { QaEnemies, QaSuppressor } from './net/qaEnemies.ts';
import { DEFAULT_WORLD_ID, buildTree, encounterFor, getWorld, type World, type WorldBox, type WorldBoxKind, boxCentre, requireWorld, supportUnder, surfaceAt } from '@sandline/shared';
import { createCameraSolve, solveCamera } from './camera/cameraSolve.ts';
import type { CameraCollider } from './camera/cameraColliders.ts';
import { CombatQA, WEAPON_ORDER } from './weapons/CombatQA.ts';
import { PROJECTILE_ORDER, ThrowQA } from './weapons/ThrowQA.ts';
import { PouchTrigger } from './weapons/pouchTrigger.ts';
import { ViewModel } from './weapons/viewModel.ts';
import { ScopeOverlay, scopedFov, scopedLookScale } from './ui/scopeOverlay.ts';
import { applyKick, createRecoil, recoverRecoil } from './weapons/recoil.ts';
import { SCORCH_REACH_M, WeaponEffects } from './weapons/effects.ts';
import { addImpulse, addShake, applyShake, blastShake, createShake, decayShake, suppressionJolt } from './camera/cameraShake.ts';
import { SuppressionOverlay } from './ui/suppressionLook.ts';
import { crosshairGapPx } from './ui/crosshair.ts';
import { createCameraPanel } from './ui/CameraPanel.ts';
import {
  HUMANOID_CROUCH_HIT_HEIGHT_M,
  HUMANOID_HIT_HEIGHT_M,
  HUMANOID_ROOT_LIFT_M,
  createHumanoidPlaceholder,
} from './character/humanoidPlaceholder.ts';
import { requireRig, rigOf } from './character/humanoidRig.ts';
import { FROM_THE_FRONT, hitReactionFrom, shooterDirection } from './character/hitReaction.ts';
import { createHumanoidSoldier, setSoldierPalette } from './character/humanoidSoldier.ts';
import { addKick, createKick, decayKick } from './character/weaponKick.ts';
import { createLocomotionPoseDriver } from './character/locomotionPose.ts';
import { createFootPlacementDriver } from './character/footPlacement.ts';
import { RemoteSoldiers } from './character/remoteSoldiers.ts';
import { classifyLocomotion, type LocomotionResult } from './character/locomotionState.ts';
import { AiDebugOverlay } from './ui/AiDebug.ts';
import { RESTART_KEY, missionLine } from './ui/missionHud.ts';
import { type AimSubject, OrderWheelView, buildMark, orderFromRelease } from './ui/OrderWheel.ts';
import { type MarkerVec, OrderMarkerOverlay, orderMarkers } from './ui/OrderMarkers.ts';
import { createNetgraph } from './ui/Netgraph.ts';
import { createNetworkPanel } from './ui/NetworkPanel.ts';
import { type LobbyChoice, createLobby, readStoredKey, readStoredName } from './ui/Lobby.ts';
import type { Panel } from './ui/Panel.ts';
import { createSquadPanel } from './ui/SquadPanel.ts';
import { isTextField } from './input/LocalInput.ts';
import { createTuningPanel } from './ui/TuningPanel.ts';
import { createWeaponPanel } from './ui/WeaponPanel.ts';
import { createProjectilePanel } from './ui/ProjectilePanel.ts';

/* -- Scene ----------------------------------------------------------------- */

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
// A hard shadow edge (T-2.32). The era could not afford to filter one, and a
// soft penumbra under a soldier is one of the two things — with a PBR
// material — that read as modern however the character is textured.
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1408);
scene.fog = new THREE.Fog(0x1a1408, 45, 130);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);

// ADR-013: one shadow-mapped sun, no realtime GI.
const sun = new THREE.DirectionalLight(0xffe9c4, 2.6);
sun.position.set(24, 34, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -60;
sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60;
sun.shadow.camera.bottom = -60;
scene.add(sun, new THREE.HemisphereLight(0xa9c0ff, 0x6b5a3a, 0.75));

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0x9a8156, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
scene.add(new THREE.GridHelper(200, 100, 0x8a7550, 0x6a5940));
/** T-3.09: the AI debug overlay, off until B. */
const aiDebug = new AiDebugOverlay(document.body);
/**
 * T-3.29: hold Q for the order wheel, tap F to mark. The wheel is the
 * picture of what `LocalInput` holds; the markers are the host's broadcast
 * orders and marks, never what this page sent.
 */
const orderWheel = new OrderWheelView(document.body);
const orderMarkerOverlay = new OrderMarkerOverlay(document.body);
scene.add(orderMarkerOverlay.object);
scene.add(aiDebug.object);

/**
 * THE WORLD, drawn from the shared list (T-1.12).
 *
 * Every solid thing here comes from the session's named world (T-3.02) —
 * for the range, the distance posts, the sprint-lane rails, the reference
 * figure and the cover in worlds/range.json. The
 * server collides players and shots with exactly that list, the predictor
 * collides the local player with it, and the camera arm stops on it — so
 * there is no longer a client-only decoration a soldier can walk through or a
 * shot can pass through. That was the case with every post until now, and it
 * is the gap note 16 in the handoffs kept pointing at.
 *
 * Two sets are built from the one list. `shootable` is what the aim converges
 * on and what predicted tracers end on; it is exactly what the server resolves
 * hits against, plus the ground as a backstop, so it holds every world box and
 * every player, and nothing else. `cameraScenery` is what the camera arm stops
 * on: the same boxes, never the players, or the camera lurches every time a
 * teammate walks behind you.
 */
const shootable: THREE.Object3D[] = [];
const cameraScenery: THREE.Object3D[] = [ground];
const cameraRaycaster = new THREE.Raycaster();
/** Reused every frame: the cast runs per frame and must not allocate. */
const cameraRayOrigin = new THREE.Vector3();
const cameraRayDirection = new THREE.Vector3();
const cameraCollider: CameraCollider = {
  cast(origin, direction, maxDistance) {
    cameraRaycaster.set(
      cameraRayOrigin.set(origin.x, origin.y, origin.z),
      cameraRayDirection.set(direction.x, direction.y, direction.z),
    );
    cameraRaycaster.near = 0;
    cameraRaycaster.far = maxDistance;
    return cameraRaycaster.intersectObjects(cameraScenery, false)[0]?.distance ?? null;
  },
};

const worldMaterials: Record<WorldBoxKind, THREE.Material> = {
  'post-minor': new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.9 }),
  'post-major': new THREE.MeshStandardMaterial({ color: 0xf0b429, roughness: 0.8 }),
  rail: new THREE.MeshStandardMaterial({ color: 0xc2532e, roughness: 1 }),
  figure: new THREE.MeshStandardMaterial({ color: 0x8b6f47, roughness: 0.9 }),
  cover: new THREE.MeshStandardMaterial({ color: 0x7a6a52, roughness: 0.95 }),
  blocker: new THREE.MeshStandardMaterial({ color: 0x5b4934, roughness: 0.9 }),
};
/** The box every world entry collides as. The figure also gets its capsule. */
const invisible = new THREE.MeshBasicMaterial({ visible: false });

/**
 * The world being drawn, collided with and shot at (T-3.02). The range until
 * a host names another in `JoinAck`; the lobby is drawn over it.
 */
let activeWorld: World = requireWorld(DEFAULT_WORLD_ID);

/** Static world plus the live session's replicated blocker boxes. */
function collisionBoxes(): readonly WorldBox[] {
  const boxes = live?.net.worldBoxes;
  return boxes && boxes.length > 0 ? boxes : activeWorld.boxes;
}

/** Every mesh the current world added, so the next world can take them away. */
const worldMeshes: THREE.Mesh[] = [];

function buildScenery(world: World): void {
  for (const mesh of worldMeshes.splice(0)) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    for (const list of [shootable, cameraScenery]) {
      const at = list.indexOf(mesh);
      if (at >= 0) list.splice(at, 1);
    }
  }
  for (const box of world.boxes) {
    const c = boxCentre(box);
    // A kit piece's box (T-4.10) collides and takes rays but is not drawn: the piece's mesh is (`levelPieces`).
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(c.w, c.h, c.d),
      box.kind === 'figure' || box.piece !== undefined ? invisible : worldMaterials[box.kind],
    );
    mesh.position.set(c.x, c.y, c.z);
    mesh.castShadow = box.kind !== 'figure';
    mesh.name = box.id;
    scene.add(mesh);
    worldMeshes.push(mesh);
    shootable.push(mesh);
    cameraScenery.push(mesh);
    if (box.kind === 'figure') {
      /** The 1.8 m reference figure: the only way to read speed and jump height. */
      const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1, 4, 12), worldMaterials.figure);
      capsule.position.set(c.x, c.y, c.z);
      capsule.castShadow = true;
      capsule.name = 'reference figure (drawn)';
      scene.add(capsule);
      worldMeshes.push(capsule);
    }
  }
  void levelPieces.show(world, kitWanted);
}

/** T-4.15 blocker meshes are separate from static scenery because their state changes at runtime. */
const blockerMeshes = new Map<string, THREE.Mesh>();

function removeBlockerMesh(key: string, mesh: THREE.Mesh): void {
  scene.remove(mesh);
  mesh.geometry.dispose();
  for (const list of [shootable, cameraScenery]) {
    const at = list.indexOf(mesh);
    if (at >= 0) list.splice(at, 1);
  }
  blockerMeshes.delete(key);
}

function syncBlockers(net: NetClient | null): void {
  const wanted = new Set<string>();
  for (const blocker of net?.blockers ?? []) {
    if (!blocker.active) continue;
    blocker.boxes.forEach((box, index) => {
      const key = `${blocker.id}/${index}`;
      wanted.add(key);
      if (blockerMeshes.has(key)) return;
      const centre = boxCentre(box);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(centre.w, centre.h, centre.d), worldMaterials.blocker);
      mesh.position.set(centre.x, centre.y, centre.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `blocker ${blocker.id}`;
      scene.add(mesh);
      shootable.push(mesh);
      cameraScenery.push(mesh);
      blockerMeshes.set(key, mesh);
    });
  }
  for (const [key, mesh] of [...blockerMeshes]) if (!wanted.has(key)) removeBlockerMesh(key, mesh);
}
/** T-4.10: a level's kit pieces, drawn through the asset loader; `?kit` labels each one. */
const kitWanted = new URLSearchParams(location.search).has('kit');
/** The page's one asset loader (T-4.05): level pieces and the detailed soldier share its cache. */
const assetLoader = new AssetLoader({ renderer, parse: gltfParser({ renderer }) });
const levelPieces = new LevelPieces(scene, assetLoader);
buildScenery(activeWorld);
// T-4.05: `?assets` stands every asset the pipeline made in a row behind the spawn line.
if (new URLSearchParams(location.search).has('assets')) void showAssetShelf(scene, renderer);

/** Switch to the world a session named, redrawing only when it changed. */
function useWorld(world: World): void {
  if (world.id === activeWorld.id) return;
  activeWorld = world;
  buildScenery(world);
}

/**
 * The firing range: targets at known distances straight ahead of spawn.
 *
 * Damage falloff (T-1.17) is a curve between two distances per weapon, and a
 * curve you cannot stand at three points of is just a pair of numbers in JSON.
 * These sit either side of the carbine's 22 m / 55 m falloff band and the
 * breacher's 6 m / 18 m one, so the drop-off is something you walk to rather
 * than read. Offset in x so they do not share a cell with a distance post.
 */
const targets: THREE.Object3D[] = [];
const targetMat = new THREE.MeshStandardMaterial({ color: 0xcf6a4c, roughness: 0.85 });
const targetGeo = new THREE.CapsuleGeometry(0.35, 1.1, 6, 14);
for (const spec of RANGE_TARGETS) {
  const target = new THREE.Mesh(targetGeo, targetMat);
  // The shared list stores FEET; the capsule mesh is positioned by its centre.
  target.position.set(spec.x, spec.y + 0.9, spec.z);
  target.castShadow = true;
  target.name = `range ${spec.label}`;
  scene.add(target);
  targets.push(target);
  shootable.push(target);
}

/* -- Player ---------------------------------------------------------------- */

const config: MoveConfig = { ...DEFAULT_MOVE_CONFIG };
const input = new LocalInput(renderer.domElement);

/**
 * Camera constants live in a config object so the tuning panel can move them,
 * for the same reason DEFAULT_MOVE_CONFIG does: they are guesses, and the only
 * way to find the right ones is to change them while watching the result.
 */
const cam = { ...DEFAULT_CAMERA_CONFIG };
/** Reused every frame: the solve writes into it rather than allocating. */
const camSolve = createCameraSolve();
/** How far the aim ray looks for something to converge on. */
const AIM_RANGE = 250;


/**
 * The skinned soldier is the presentation (T-2.22); `?greybox` on the URL
 * draws the grey-box fixture instead, for diagnosing the rig contract from
 * parts that can be read off directly. Both register a rig on their root.
 */
const greyBox = new URLSearchParams(location.search).has('greybox');
const createSoldier = greyBox ? createHumanoidPlaceholder : createHumanoidSoldier;
const player = createSoldier('local');
const playerRig = requireRig(player);
const localPoseDriver = createLocomotionPoseDriver(playerRig);
/**
 * Foot placement (T-2.28). Created with the same config object the session
 * and the predictor share, so the movement panel's step height moves what the
 * feet will stand on with it, and reading the same world the controller
 * collides with.
 */
const localFeet = createFootPlacementDriver(playerRig, { world: () => collisionBoxes(), config });
scene.add(player);
/**
 * T-4.08: the squad wears the detailed soldier (`soldier-dcu`) once it has
 * loaded, swapped onto the live rig; until then, and with `?codesoldier` or
 * `?greybox`, the code-built one. Remote squad soldiers take it the next time
 * their palette is set, which is every frame.
 */
// T-4.36: the period weapons, generated, replace the code-built ones as they arrive; `?codeweapons` keeps the old ones.
if (!new URLSearchParams(location.search).has('codeweapons')) void loadWeaponAssets(assetLoader);
if (!greyBox && !new URLSearchParams(location.search).has('codesoldier')) {
  void loadDetailedSkin(assetLoader).then((skin) => {
    if (skin) setSoldierPalette(player, 'local');
  });
  // T-4.35: every enemy wears the fighter once it has loaded; remotes take it on their next palette set.
  void loadFighterSkin(assetLoader);
}

/**
 * Remote characters, created on demand from replicated entities.
 *
 * These used to be five capsules parked at fixed positions for scale. They are
 * now the other five slots of the authoritative session (ADR-001: six, always),
 * arriving over the wire and rendered at the interpolation delay. If they stand
 * still it is because nothing is driving them — not because they are scenery.
 * Since T-3.11 enemies are drawn by the same path in the enemy palette; see
 * `remoteSoldiers.ts`.
 */
const remotes = new RemoteSoldiers({
  scene,
  shootable,
  create: createSoldier,
  world: () => collisionBoxes(),
  config,
});

/** A signed wire angle (1024 per turn) in radians. */
function wireToRadians(wire: number): number {
  return (wire / 1024) * Math.PI * 2;
}

/**
 * The fire layer's kicks (T-2.26): ours from the predicted shot, each
 * remote's from the server's shot event by shooter. Both decay per frame.
 */
let kick = createKick();

/**
 * Grenades and rockets in the page (T-2.32).
 *
 * `throws` is the numbers — the pouch, the cooldown, the arc, the predicted
 * ghosts — and everything below it here is the picture: one mesh per
 * projectile, whether it is a ghost of our own or a replicated one somebody
 * else threw, and one line for the arc the thrower is aiming along.
 */
const throws = new ThrowQA();

/**
 * What is in the hands. The guns are 1-4 and the pouch 5-6, and a grenade or
 * a rocket is EQUIPPED like a gun and used with the trigger (`PouchTrigger`);
 * G stays a quick throw of the selected pouch item. The server hears every
 * switch (`net.equip`) so the rest of the squad sees the right thing held.
 */
let holdingPouch = false;
const pouchTrigger = new PouchTrigger();
/** The loadout index sent last, and to which client, so a switch is sent once. */
let equipSent: { net: NetClient; item: number } | null = null;
function loadoutItem(): number {
  return holdingPouch ? WEAPON_ORDER.length + throws.kind : combat.weaponIndex;
}
/** The loadout id in hand, for the models. */
function heldId(): string {
  return holdingPouch ? throws.def.id : combat.weapon.id;
}
function equipGun(index: number): void {
  combat.selectWeapon(index);
  holdingPouch = false;
  pouchTrigger.cancel();
}
function equipPouch(index: number): void {
  // Nothing to hold: an empty pouch slot stays on the gun, but is still
  // selected for G.
  throws.select(index);
  if (throws.count(index) <= 0) return;
  holdingPouch = true;
  pouchTrigger.cancel();
}

/** The weapon in hand in first person, drawn over the world. */
const viewModel = new ViewModel();
const scopeOverlay = new ScopeOverlay();

/** The world a projectile collides with: the session's boxes and the same floor. */
function projectileWorld(): ProjectileWorld {
  return { boxes: collisionBoxes(), groundY: config.groundY };
}

/**
 * One shape per projectile in the data, built once: a sphere for a grenade and
 * a stub of a cylinder for a rocket. No art (§7.5 rule 4) — the shapes are the
 * radius the collision actually uses, so what you see is what bounces.
 */
const PROJECTILE_SHAPES = PROJECTILE_ORDER.map((id, index) => {
  const def = getProjectile(id);
  return index === 0
    ? {
        geometry: new THREE.SphereGeometry(def.radiusM, 10, 8) as THREE.BufferGeometry,
        material: new THREE.MeshStandardMaterial({ color: 0x3e4b32, roughness: 0.7 }) as THREE.Material,
      }
    : {
        geometry: new THREE.CylinderGeometry(def.radiusM, def.radiusM * 0.6, 0.5, 8) as THREE.BufferGeometry,
        material: new THREE.MeshStandardMaterial({ color: 0x6a6157, roughness: 0.5, emissive: 0x2a1405 }) as THREE.Material,
      };
});

/** Live projectile meshes, keyed "p<netId>" for replicated and "g<id>" for ghosts. */
const projectileMeshes = new Map<string, THREE.Mesh>();

function projectileMesh(key: string, kind: number): THREE.Mesh {
  let mesh = projectileMeshes.get(key);
  if (!mesh) {
    const shape = PROJECTILE_SHAPES[kind] ?? PROJECTILE_SHAPES[0];
    mesh = new THREE.Mesh(shape?.geometry, shape?.material);
    mesh.castShadow = true;
    mesh.name = `projectile ${key}`;
    scene.add(mesh);
    projectileMeshes.set(key, mesh);
  }
  return mesh;
}

function dropProjectileMesh(key: string): void {
  const mesh = projectileMeshes.get(key);
  if (!mesh) return;
  scene.remove(mesh);
  projectileMeshes.delete(key);
}

/**
 * The arc, drawn once and rewritten in place.
 *
 * A fixed buffer with a draw range rather than `setFromPoints` every frame:
 * the preview updates at the display's rate for as long as the key is held,
 * and reallocating a geometry attribute sixty times a second to draw eighty
 * points is the one shape of garbage this harness has otherwise avoided
 * (T-2.10's pools exist for the same reason).
 */
const MAX_ARC_POINTS = 128;
const arcPositions = new Float32Array(MAX_ARC_POINTS * 3);
const arcGeometry = new THREE.BufferGeometry();
arcGeometry.setAttribute('position', new THREE.BufferAttribute(arcPositions, 3));
arcGeometry.setDrawRange(0, 0);
const arcLine = new THREE.Line(
  arcGeometry,
  new THREE.LineBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0.85 }),
);
arcLine.visible = false;
arcLine.frustumCulled = false;
scene.add(arcLine);

/** Where the arc says it will go off: a small ring on the ground, or in the air. */
const arcMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.22, 0.3, 16),
  new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
);
arcMarker.visible = false;
scene.add(arcMarker);

const throwOrigin = new THREE.Vector3();
/** The last blast this client drew, for the HUD. */
let lastBlast: { name: string; damage: number; targets: number } | null = null;
const projectileHeading = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Point a projectile along its flight. A sphere does not care; a rocket does. */
function pointAlong(mesh: THREE.Mesh, vx: number, vy: number, vz: number): void {
  const speed = Math.hypot(vx, vy, vz);
  if (speed < 1e-3) return;
  projectileHeading.set(vx / speed, vy / speed, vz / speed);
  // The cylinder's own axis is +Y, so that is the vector being turned.
  mesh.quaternion.setFromUnitVectors(UP, projectileHeading);
}

const combat = new CombatQA(scene, shootable);
/**
 * Muzzle flash and shells (T-2.10): pooled once here, never allocated on a
 * shot. Cosmetic, from the VISUAL muzzle, like the tracers.
 */
const effects = new WeaponEffects(scene);
/**
 * Recoil (T-2.08): a view offset the trigger kicks and every frame recovers.
 * Applied on the tick a shot resolves, so the NEXT shot fires along the
 * kicked view; recovered per frame, so the climb unwinds smoothly at any
 * frame rate. The server never sees any of it — only where the view points.
 */
let recoil = createRecoil();
/**
 * Camera shake (T-2.09): the jolt the picture takes on a shot. Separate from
 * recoil on purpose — recoil moves the aim, shake moves only what the eye
 * sees, and the aim ray never reads it.
 */
let shake = createShake();

/* -- Network --------------------------------------------------------------- */

/**
 * The session is chosen in the lobby, not at load (T-1.5.06).
 *
 * Until this task the page built its session at module scope — in-page by
 * default, remote with `?host=` — and there was no way to leave one or start
 * another without reloading. Now everything a session owns lives in
 * `live`, created by `startSession` and torn down by `leaveSession`, and the
 * frame loop renders the scene with or without one. The query parameters
 * still work, but they PRE-FILL the lobby: there is one way into a session.
 */
interface LiveSession {
  server: SessionSource;
  net: NetClient;
  local: LocalServer | null;
  remote: RemoteServer | null;
  sparring: SparringPartner | null;
  sparringLink: ClientLink | null;
  /** `?enemies` on the in-page session (T-3.11), else null. */
  qaEnemies: QaEnemies | null;
  /** `?suppress` on the in-page session (T-3.17), else null. */
  qaSuppressor: QaSuppressor | null;
  choice: LobbyChoice;
  /** The panel of link sliders, rebuilt per session: it binds to `local`. */
  networkPanel: Panel;
}
let live: LiveSession | null = null;

let presetHost: string | null = null;
let presetHostError: string | null = null;
try {
  presetHost = hostFromQuery(location.search, location.protocol);
} catch (e) {
  if (!(e instanceof HostUrlError)) throw e;
  presetHostError = e.message;
}
const presetRoom = roomFromQuery(location.search);

const link = { ...DEFAULT_LINK };
/**
 * The sparring partner's conditions are a SEPARATE object with separate
 * sliders. What you see of a remote player is governed by their link to the
 * server, not by yours, so one shared slider could never show you a teammate
 * lagging on an otherwise perfect connection — which is the commonest thing a
 * player actually reports, and the case T-1.24 has to be able to judge.
 */
const peerLink = { ...DEFAULT_LINK };

/**
 * Draw the authoritative result of a shot, from the server's own rewound
 * origin (B-01) rather than an approximation of where the shooter now is.
 *
 * That approximation — the shooter's CURRENT replicated position — used to be
 * the only origin available here, and it drifts from the true muzzle by
 * however far the shooter has moved since the round trip plus the
 * interpolation delay: for a strafing shooter, easily a metre or more. At
 * typical range that reads as a slightly crooked tracer; at close range the
 * same absolute drift is a large fraction of the distance to the target, and
 * the line can look like it left at a steep angle to the way the shooter was
 * actually facing. The server already resolves every shot from a rewound
 * origin (T-1.18); it now sends that same point instead of leaving the client
 * to guess one.
 */
const shotOrigin = new THREE.Vector3();
const shotEnd = new THREE.Vector3();
function onServerShot(net: NetClient, shot: ServerShot): void {
  shotEnd.set(shot.x, shot.y, shot.z);
  shotOrigin.set(shot.originX, shot.originY, shot.originZ);
  landImpact(net, shot);
  if (shot.shooterNetId !== net.netId) {
    // Their rifle kicks on their body (T-2.26): the server's event is the
    // first this client hears of the shot, and the weapon they hold is
    // replicated beside their reload.
    const held = net.remoteWeapon(shot.shooterNetId);
    const def = getWeapon(WEAPON_IDS[held.index] ?? WEAPON_IDS[0]);
    remotes.kick(shot.shooterNetId, (k) => addKick(k, def, false));
  }
  if (shot.shooterNetId === net.netId) {
    // Our own shot: the tracer is already drawn, so this only lands the hit
    // marker and the damage number.
    combat.drawServerShot(shotOrigin, shotEnd, shot.targetNetId, shot.damage, clock.tick * TICK_SECONDS);
    return;
  }
  /**
   * Someone else's shot. There is nothing to predict — we never saw their
   * trigger — so this is the one case where a tracer legitimately arrives on
   * the server's schedule, drawn from the point the server says it left.
   */
  combat.drawTracer(shotOrigin, shotEnd, clock.tick * TICK_SECONDS);
  combat.drawServerShot(shotOrigin, shotEnd, shot.targetNetId, shot.damage, clock.tick * TICK_SECONDS);
}

/**
 * Where the round stopped, from the SERVER'S point (T-2.11) — never from the
 * predicted tracer's end, which is only a picture. A scenery stop is a mark
 * and sparks on the face the point lies on; a max-range miss lies on no face
 * and gets nothing. A soldier hit flinches: ours in third person, theirs by
 * their replicated mesh.
 */
function landImpact(net: NetClient, shot: ServerShot): void {
  const now = clock.tick * TICK_SECONDS;
  if (shot.targetNetId === 0) {
    const surface = surfaceAt(shot, collisionBoxes());
    // The wire rounds the point to 1/64 m; the mark goes on the face itself.
    if (surface) effects.impact(surface.point, surface.normal, now);
    return;
  }
  const target = shot.targetNetId === net.netId ? player : remotes.get(shot.targetNetId);
  // A downed soldier is already on the ground; the flinch belongs to the upright.
  const targetDowned = shot.targetNetId === net.netId ? net.vitality !== 'alive' : net.remoteVitality(shot.targetNetId) !== 'alive';
  if (!target || targetDowned) return;
  /**
   * What the reaction is made of (T-2.27), all of it state this client
   * already has: where the shooter stood, in the TARGET'S frame, so the body
   * turns away from them; the impact's height up the hit capsule, read
   * against the same zone fractions the server scored the damage with; and
   * the damage itself. A shooter with no mesh yet — a shot from someone who
   * has not been interpolated — reads as a shot from the front.
   */
  const shooter = shot.shooterNetId === net.netId ? player : remotes.get(shot.shooterNetId);
  const from = shooter
    ? shooterDirection(shooter.position.x - target.position.x, shooter.position.z - target.position.z, target.rotation.y)
    : FROM_THE_FRONT;
  const crouched = rigOf(target)?.pose === 'crouched';
  const zone = zoneAt(
    shot.y,
    target.position.y - HUMANOID_ROOT_LIFT_M,
    crouched ? HUMANOID_CROUCH_HIT_HEIGHT_M : HUMANOID_HIT_HEIGHT_M,
  );
  effects.flinch(target, now, hitReactionFrom(shot.damage, zone, from));
}

/**
 * A blast, at the moment the render clock reaches the tick it went off on
 * (T-2.33) — `NetClient` holds it until then, because projectiles are drawn a
 * hundred milliseconds behind server time and a blast drawn on arrival goes
 * off in front of a grenade the player can still see in the air.
 *
 * Three things come out of one message: the picture at the server's point, the
 * jolt to this player's own camera scaled by how much of the blast reached
 * them, and a reaction on everybody it hurt, away from the blast — the T-2.27
 * layer, asked the same way a bullet asks it.
 */
function onServerDetonation(net: NetClient, event: ServerDetonation): void {
  const now = clock.tick * TICK_SECONDS;
  // The page's row for it: a tuned blast radius draws at the tuned size.
  const def = throws.defOf(event.kind);
  const centre = { x: event.x, y: event.y, z: event.z };

  /**
   * What the scorch goes on: the surface under the blast, if there is one
   * close enough below it. A rocket against a wall three metres up leaves no
   * ring on the floor beneath it.
   */
  const support = supportUnder(event.x, event.z, 0.15, event.y, collisionBoxes(), config.groundY);
  effects.blast(centre, def.blastRadiusM, event.y - support <= SCORCH_REACH_M ? support : null, now);

  // Our own camera, by what reached US. `net.simulated` is where the server
  // has this player; the blast was resolved against that, not against the
  // rendered position.
  const here = net.simulated;
  if (here) {
    const impulse = blastShake(
      def,
      centre,
      { x: here.x, y: here.y, z: here.z },
      here.crouched ? HUMANOID_CROUCH_HIT_HEIGHT_M : HUMANOID_HIT_HEIGHT_M,
      collisionBoxes(),
    );
    if (impulse.posM > 0) shake = addImpulse(shake, impulse.posM, impulse.rollRad);
  }

  for (const target of event.targets) {
    const mesh = target.netId === net.netId ? player : remotes.get(target.netId);
    const downed = target.netId === net.netId
      ? net.vitality !== 'alive'
      : net.remoteVitality(target.netId) !== 'alive';
    if (!mesh || downed) continue;
    /**
     * Staggered AWAY from the blast, in the target's own frame, by the same
     * arithmetic a bullet's reaction uses — the blast is simply the shooter.
     * A blast has no hit zone, so it is a torso hit: the body takes it, not
     * the head.
     */
    const from = shooterDirection(centre.x - mesh.position.x, centre.z - mesh.position.z, mesh.rotation.y);
    effects.flinch(mesh, now, hitReactionFrom(target.damage, 'torso', from));
  }

  lastBlast = {
    name: def.name,
    damage: event.targets.reduce((total, t) => total + t.damage, 0),
    targets: event.targets.length,
  };
}

/**
 * The in-page session's WASM (Recast, T-3.01) must be ready before it can be
 * built. It is started at load, so by the time anyone clicks it has usually
 * long resolved; a remote session needs none of it.
 */
const navReady = initNav();

/**
 * `?enemies` (T-3.11): three riflemen downrange in the in-page session, two
 * of them patrolling — see `qaEnemies.ts`. Walking needs the range's navmesh
 * in the session, and the bake is a few hundred kB, so it is imported here,
 * on demand, and nowhere else in the page.
 */
const qaEnemiesWanted = new URLSearchParams(location.search).has('enemies');
/** `?suppress` (T-3.17): a rifleman firing past the player's camera — see `qaEnemies.ts`. */
const qaSuppressWanted = new URLSearchParams(location.search).has('suppress');
/**
 * `?world=greybox-01` (T-3.31): the named world the in-page session is built
 * with, the range when absent or unknown. The page draws whatever world the
 * session names in JoinAck, as it does for a host's `WORLD=`.
 */
/**
 * `?mission` (T-3.34): the grey-box mission in the page — its world (unless
 * `?world=` names another with an encounter), its encounter, paced by the
 * director, the objective and its HUD line, P to play again once it is over.
 * With `&squad` the bots fight beside you.
 */
const qaMissionWanted = new URLSearchParams(location.search).has('mission');
const qaWorld: World =
  getWorld(new URLSearchParams(location.search).get('world') ?? '') ??
  requireWorld(qaMissionWanted ? 'mission-01' : new URLSearchParams(location.search).has('kit') ? 'kit-gallery' : DEFAULT_WORLD_ID);
const qaEncounter = qaMissionWanted ? encounterFor(qaWorld.id) : undefined;
/**
 * `?squad` (T-3.29): the in-page bots run the committed `friendly` tree, with
 * the range's cover — they follow in formation, fight, and carry out what the
 * order wheel tells them. Needs the navmesh too; combine with `?enemies` for
 * something to attack.
 */
const qaSquadWanted = new URLSearchParams(location.search).has('squad');
const qaSquad: Promise<LocalServerOptions> = qaSquadWanted
  ? Promise.all([import('@sandline/server/brain'), import('@sandline/server/nav/baked')]).then(
      ([brain, baked]) => ({
        brainTree: buildTree('friendly', brain.createBrainRegistry()),
        cover: baked.bakedCoverFor(qaWorld.id),
      }),
    )
  : qaEncounter
    ? import('@sandline/server/nav/baked').then((baked) => ({ cover: baked.bakedCoverFor(qaWorld.id) }))
    : Promise.resolve({});
const qaNavMesh: Promise<NavMesh | null> = qaEnemiesWanted || qaSquadWanted || qaEncounter
  ? navReady.then(() => import('@sandline/server/nav/baked')).then((baked) => baked.loadWorldNavMesh(qaWorld.id))
  : Promise.resolve(null);

function chooseSession(choice: LobbyChoice): void {
  if (choice.kind === 'local') void Promise.all([navReady, qaNavMesh, qaSquad]).then(([, navMesh, squad]) => startSession(choice, navMesh, squad));
  else startSession(choice);
}

function startSession(choice: LobbyChoice, qaNav: NavMesh | null = null, squad: LocalServerOptions = {}): void {
  if (live) leaveSession(null);

  // One config object, shared by reference with both the session and the
  // predictor: the movement panel must move authority and prediction together.
  // (Remote: the host owns the authoritative config and this one only predicts,
  // so the movement panel moves prediction alone and will mispredict until the
  // host is restarted to match. Tuning is an in-page-session activity.)
  const local = choice.kind === 'local' ? new LocalServer(link, config, { ...(qaNav ? { navMesh: qaNav } : {}), ...squad, world: qaWorld, ...(qaEncounter ? { encounter: qaEncounter } : {}) }) : null;
  // The projectile panel's rows, as they stand, for this session from its first throw.
  if (local) PROJECTILE_ORDER.forEach((_, i) => local.tuneProjectile(i, throws.defOf(i)));
  const qaEnemies = local && qaNav && qaEnemiesWanted ? new QaEnemies(local) : null;
  // Slot netIds are 1..6 in slot order, so slot 1's soldier is netId 2.
  const qaSuppressor = local && qaSuppressWanted ? new QaSuppressor(local, 2) : null;
  const remote = choice.kind === 'remote' ? new RemoteServer(choice.host) : null;
  const server: SessionSource = local ?? (remote as RemoteServer);
  const net = new NetClient(server.transport, choice.kind === 'remote' ? choice.name : 'qa', config);
  net.onScriptMessage = (text) => {
    scriptNotice = text;
    scriptNoticeUntil = performance.now() + 5000;
  };
  net.onScriptCallout = (id) => {
    // E-2.7's recorded-callout player is still a later task; surface the cue
    // now so scripted missions are observable rather than silently dropping it.
    scriptNotice = `Radio: ${id}`;
    scriptNoticeUntil = performance.now() + 3000;
  };
  net.onShot = (shot) => onServerShot(net, shot);
  net.onDetonation = (event) => onServerDetonation(net, event);
  // T-3.09: B's overlay, carried across sessions; the wish is resent on JoinAck.
  net.onAiDebug = (report) => aiDebug.show(report);
  net.requestAiDebug(aiDebug.isEnabled);
  // A throw key released while there was no session to throw into is not a
  // throw waiting to happen: drain the latch rather than open with a grenade.
  input.consumeThrowRelease();
  // Nor is an order or a mark.
  input.consumeOrderRelease();
  input.consumeMarkPress();

  if (remote && choice.kind === 'remote') {
    /**
     * Handshake once the socket is usable, and again after every reconnect.
     *
     * `join()` at construction time would be sent into a socket that has not
     * finished opening, and `WsClientTransport` drops a send on a socket that is
     * not ready — so the Join would vanish and the page would wait forever for a
     * JoinAck nobody was ever asked for.
     *
     * A reconnect re-joins the ROOM we were in, not a fresh one: the host
     * keeps an emptied room alive for a grace period precisely so a dropped
     * player can come back to it (T-1.5.05). `roomJoined` remembers the code
     * the host answered with, so a "host a room" that reconnects does not host
     * a second one.
     */
    let roomJoined = choice.room;
    let joinedOnce = false;
    let rejoining = false;
    remote.onReady = () => {
      rejoining = joinedOnce;
      // The token survives the reset (T-4.18): offered back, it takes our own
      // slot and soldier again within the host's grace time.
      const resume = net.resumeToken;
      net.resetForRejoin();
      // The map only means something to a room being made (T-3.35 follow-up); a rejoin takes the room's.
      net.join(roomJoined, choice.key, roomJoined === '' ? choice.world : '', joinedOnce ? resume : '');
    };
    net.onJoined = (_slot, room) => {
      // Back in our own slot the soldier is where we left it; any other slot
      // is whatever body its bot was in (ADR-001): say which, or a new body reads as a teleport.
      if (rejoining) {
        rejoinNotice = net.resumed ? 'Connection dropped — reconnected to your soldier' : 'Connection dropped — rejoined the room in a new slot';
        rejoinNoticeUntil = performance.now() + REJOIN_NOTICE_MS;
      }
      rejoining = false;
      joinedOnce = true;
      if (net.world) useWorld(net.world);
      roomJoined = room;
      remote.markJoined();
      history.replaceState(null, '', shareLink(location.href, choice.host, room, __DEFAULT_HOST__));
    };
    net.onDisconnect = (reason, code) => {
      remote.noteRefusal(code, reason);
      // Back to the lobby with the reason on screen. A refusal is the one
      // thing a player must never have to infer from a frozen scene.
      leaveSession({ text: explainRejection(code, reason), tone: 'error' });
    };
  } else {
    // The in-page session names its world in JoinAck exactly as a host does.
    net.onJoined = () => {
      if (net.world) useWorld(net.world);
    };
    net.join();
  }

  /**
   * A second real client, so there is a remote player that MOVES. Stationary
   * capsules interpolate perfectly at any latency and so tell a tester nothing;
   * this is what makes the interpolation half of the netgraph mean something,
   * and what T-1.23's two-client acceptance asks for.
   *
   * ONLY when the session is in this page. Against a real host the other player
   * is a person in another tab — which is the thing the sparring partner has been
   * standing in for since T-1.23, and it would now be taking one of the six
   * slots away from a human to do it.
   */
  const sparringLink = local?.connect(peerLink) ?? null;
  const sparring = sparringLink ? new SparringPartner(sparringLink.transport) : null;

  const networkPanel = createNetworkPanel(
    [
      {
        label: 'Your link',
        conditions: link,
        onChange: (c) => local?.setConditions(c),
        hint: 'Your own round trip. Felt as correction on yourself and as delay between the trigger and the hit marker.',
      },
      {
        label: 'Sparring partner',
        conditions: peerLink,
        onChange: (c) => sparringLink?.setConditions(c),
        hint: 'The patrolling bot alone. Felt as rubber-banding and freezing on THEIR capsule while your own movement stays crisp.',
      },
    ],
    remote
      ? `Connected to ${remote.url}. The link is a real socket, so its conditions belong to the host: run it with LINK_LATENCY_MS, LINK_JITTER_MS and LINK_LOSS. Latency there applies each way, so 100 means a ~200 ms round trip.`
      : undefined,
  );
  panels.insertBefore(networkPanel.root, netgraph.root);

  live = { server, net, local, remote, sparring, sparringLink, qaEnemies, qaSuppressor, choice, networkPanel };
  lobby.hide();
  squadPanel.setVisible(true);
  player.visible = !input.firstPerson;
  simPrev = null;
  simCur = null;
}

/**
 * Tear the session down and show the lobby again.
 *
 * Every remote mesh goes with it: they are the other five slots of THAT
 * session, and the next one has its own. Leaving them would show the last
 * room's players standing in the new room, which is exactly the "someone is
 * here who is not" confusion the whole milestone exists to remove.
 */
function leaveSession(message: { text: string; tone: 'info' | 'error' } | null): void {
  const gone = live;
  live = null;
  scriptNotice = '';
  scriptNoticeUntil = 0;
  syncBlockers(null);
  aiDebug.clear();
  orderMarkerOverlay.clear();
  if (gone) {
    gone.net.leave();
    gone.remote?.close();
    gone.networkPanel.root.remove();
  }
  remotes.clear();
  combat.reset();
  effects.reset();
  playerRig.setPose('standing');
  localPoseDriver.reset();
  playerRig.aimAt(0, 0);
  kick = createKick();
  localFeet.reset();
  simPrev = null;
  simCur = null;
  player.visible = false;
  squadPanel.setVisible(false);
  if (document.pointerLockElement) document.exitPointerLock();
  lobby.show(message ?? undefined);
}

/* -- UI -------------------------------------------------------------------- */

const hud = document.getElementById('hud');
const stats = document.getElementById('stats');

/**
 * One scrolling column for every panel. Three of them fixed to the same corner
 * would sit on top of each other, and each is individually collapsible so a
 * tester can keep only the one they are working in open.
 */
/**
 * The HUD collapses to its title bar rather than vanishing: H used to hide it
 * outright, which left no on-screen way to get it back.
 */
function toggleHud(): void {
  if (!hud) return;
  const collapsed = hud.classList.toggle('collapsed');
  hudToggle.textContent = collapsed ? '+' : '−';
  hudToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}
/**
 * Stamp the build into the title bar. Also into document.title, so it is
 * visible from a browser tab or a bookmark without opening the HUD.
 */
const buildStamp = document.createElement('em');
buildStamp.id = 'build-stamp';
buildStamp.textContent = `${__BUILD_SHA__} · ${__BUILD_TIME__}`;
buildStamp.title = `Built from commit ${__BUILD_SHA__} at ${__BUILD_TIME__}`;
hud?.querySelector('h1')?.append(buildStamp);
document.title = `SANDLINE ${__BUILD_SHA__}`;

const hudToggle = document.createElement('button');
hudToggle.type = 'button';
hudToggle.id = 'hud-toggle';
hudToggle.textContent = '−';
hudToggle.title = 'Collapse (H)';
hudToggle.addEventListener('click', toggleHud);
hud?.querySelector('h1')?.append(hudToggle);

const panels = document.createElement('div');
panels.id = 'panels';
const movementPanel = createTuningPanel(
  config,
  (v) => input.setSensitivity(v),
  (v) => input.setInvertY(v),
);
const weaponPanel = createWeaponPanel(combat);
/**
 * Grenade and rocket tuning: the page's rows, handed to the in-page session on
 * every edit so the server throws what the aim arc shows (a remote host keeps
 * its own data). The live session is looked up at edit time, and each new
 * in-page session is given the current rows when it starts.
 */
const projectilePanel = createProjectilePanel(throws);
throws.onTune = (index, def) => live?.local?.tuneProjectile(index, def);
const cameraPanel = createCameraPanel(cam);
const ZERO_STATS = {
  rttMs: 0,
  jitterMs: 0,
  snapshotGapRate: 0,
  snapshotBytes: 0,
  predictionErrorM: 0,
  interpAheadTicks: 0,
  tickDrift: 0,
  correctionRate: 0,
  drawCalls: 0,
  triangles: 0,
};
const netgraph = createNetgraph(() => {
  const render = renderer.info.render;
  if (!live) return { ...ZERO_STATS, drawCalls: render.calls, triangles: render.triangles };
  const n = live.net.stats;
  return {
    rttMs: n.rttMs,
    jitterMs: n.jitterMs,
    snapshotGapRate: n.snapshotGapRate,
    snapshotBytes: n.snapshotBytes,
    predictionErrorM: n.lastDivergence,
    interpAheadTicks: n.interpAheadTicks,
    tickDrift: n.tickDrift,
    correctionRate: n.reconciles === 0 ? 0 : n.corrections / n.reconciles,
    drawCalls: render.calls,
    triangles: render.triangles,
  };
});

/**
 * The link one player pastes to the other. Null on an in-page session, where
 * there is nothing to join.
 */
function currentShareLink(): string | null {
  if (!live || live.choice.kind !== 'remote' || live.net.room === '') return null;
  return shareLink(location.href, live.choice.host, live.net.room, __DEFAULT_HOST__);
}

const squadPanel = createSquadPanel({
  onLeave: () => leaveSession({ text: 'left the room', tone: 'info' }),
  link: currentShareLink,
});
squadPanel.setVisible(false);

const lobby = createLobby({
  defaultHost: __DEFAULT_HOST__,
  presetHost,
  presetHostError,
  presetRoom,
  name: readStoredName() || 'qa',
  key: readStoredKey(),
  pageProtocol: location.protocol,
  buildStamp: `${__BUILD_SHA__} · ${__BUILD_TIME__}`,
  onChoose: chooseSession,
});
document.body.appendChild(lobby.root);

panels.append(
  squadPanel.root,
  netgraph.root,
  movementPanel.root,
  weaponPanel.root,
  projectilePanel.root,
  cameraPanel.root,
);
document.body.appendChild(panels);

/* -- Loop ------------------------------------------------------------------ */

const clock = new Clock();
/** Reused so a held trigger does not allocate a vector per tick. */
const muzzle = new THREE.Vector3();
/**
 * The visual rig. `eyeHeight` tracks the camera's pivot so that first-person
 * ADS puts the muzzle exactly at the middle of the screen even after the camera
 * panel has been used. The AUTHORITATIVE trace origin does not track it — that
 * stays the shipped default, because where your bullets come from must not be a
 * camera preference.
 */
const rig = { ...DEFAULT_MUZZLE_RIG };
/** The visual weapon follows the same eased shoulder state as the camera. */
function updateMuzzleRig(): void {
  rig.shoulderRight = DEFAULT_MUZZLE_RIG.shoulderRight * camSolve.shoulderBlend;
}
/** Which point the weapon is held at, from the camera the player is using. */
function stance(): MuzzleStance {
  if (!input.firstPerson) return 'third';
  return input.ads ? 'ads' : 'hip';
}
const aimRaycaster = new THREE.Raycaster();
/** The UNSHAKEN camera position: shake must never move where the aim starts. */
const aimOrigin = new THREE.Vector3();
const aimDirection = new THREE.Vector3();
const aimPoint = new THREE.Vector3();
// The ground joins last; it is the backstop every downward shot lands on.
shootable.push(ground);
/**
 * Where the shot actually goes, in table angle units, recomputed each frame
 * from the camera. One frame behind the tick that consumes it, which at 60 fps
 * is 16 ms of aim lag - invisible here, and the alternative is computing the
 * camera twice per frame.
 */
let aimYaw = 0;
let aimPitch = 0;
/** The soldier the crosshair's ray hit first this frame, by netId; null if it hit none. */
let aimNetId: number | null = null;
/** What is under the crosshair, for an order or a mark. */
function aimSubject(net: NetClient): AimSubject {
  const id = aimNetId;
  const enemy = id !== null && net.remoteEnemy(id) !== null;
  const vitality = id === null ? 'alive' : net.remoteVitality(id);
  return {
    point: { x: aimPoint.x, y: aimPoint.y, z: aimPoint.z },
    netId: id,
    enemy: enemy && vitality !== 'dead',
    downedMate: id !== null && !enemy && vitality === 'downed',
  };
}
/** What the crosshair is on, for the stats: who an attack, a revive or a mark would name. */
function aimReadout(): string {
  const net = live?.net;
  if (!net || aimNetId === null) return 'aim: nobody';
  const who = net.remoteEnemy(aimNetId) ? 'enemy' : `slot ${net.remoteSlot(aimNetId) + 1}`;
  return `aim: ${who} ${aimNetId} (${net.remoteVitality(aimNetId)})`;
}
const crosshair = document.getElementById('crosshair');
const downedBanner = document.getElementById('downed');
/** How long the rejoin notice stays up, ms. */
const REJOIN_NOTICE_MS = 5000;
/** Until when the banner says the socket dropped and the host seated us again, and what it says. */
let rejoinNoticeUntil = 0;
let rejoinNotice = '';
/** T-3.34: the mission's one line, from the host's `Mission` message. */
const missionHud = document.getElementById('mission');
let scriptNotice = '';
let scriptNoticeUntil = 0;
/** Last gap written to the reticle, so the style is only touched on change. */
let crosshairGap = -1;

/**
 * T-3.17: being suppressed, on screen — a vignette and the colour draining,
 * from the replicated level alone, and a jolt each time the level jumps.
 */
const suppressionOverlay = new SuppressionOverlay(document.body);
/** The level the last frame saw, so a rise between snapshots jolts the camera once. */
let lastSuppression = 0;
/** Hip fire never reads as precise: the arms sit at least this far out. */
const HIP_GAP_MIN_PX = 26;
const ADS_GAP_MIN_PX = 4;
let last = performance.now();
let frames = 0;
let fpsAt = last;
let fps = 0;
let squadAt = 0;
let peakSpeed = 0;
let speed = 0;
/** The predicted state either side of the latest tick, for render interpolation. */
let simPrev: { x: number; y: number; z: number } | null = null;
let simCur: { x: number; y: number; z: number } | null = null;
let renderedPrev: { x: number; z: number } | null = null;
/**
 * Shots taken this frame's ticks whose flash and shell are still to be drawn
 * (B-02). The tick knows a shot happened; only the frame knows where the
 * muzzle is DRAWN, so the effects wait for it. Reused, never reallocated.
 */
const pendingShots: { shotIndex: number; carrierX: number; carrierZ: number }[] = [];
let pendingShotCount = 0;
/** The drawn muzzle's rig: the tick's, with the eye at the camera's pivot. */
const drawnRig = { ...DEFAULT_MUZZLE_RIG };
let locomotion: LocomotionResult = classifyLocomotion(
  { velocityX: 0, velocityZ: 0, grounded: true, crouched: false, downed: false, facingYaw: 0 },
  config,
);

const linkText = (c: LinkConditions): string =>
  `${c.latencyMs}ms  ${c.jitterMs}ms jitter  ${Math.round(c.lossRate * 100)}% loss`;

/**
 * Connection and prediction health, the numbers T-1.23 graphs.
 *
 * The connection line is first and is always present on a remote session. On a
 * loopback pair there was nothing to say — the session could not fail to be
 * there — but a socket can be refused, can drop, and can be retrying, and all
 * three look identical from a screen that has stopped moving.
 */
function netReadout(): string {
  if (!live) return 'in the lobby';
  const { net, remote, server } = live;
  const n = net.stats;
  const connection = remote ? `${describeStatus(remote.status, net.slot)}\n` : '';
  if (!n.joined) return connection || 'connecting...';
  const vitals =
    n.maxHealth === 0
      ? ''
      : n.vitality === 'alive'
        ? `health ${Math.round(n.health)}/${Math.round(n.maxHealth)}\n`
        : n.vitality === 'downed'
          ? `DOWNED  bleeding out ${n.vitalTimer}s  (immobile; a teammate can revive you)\n`
          : `DEAD  respawning in ${n.vitalTimer}s\n`;
  const rate = n.reconciles === 0 ? 0 : (n.corrections / n.reconciles) * 100;
  return (
    connection +
    vitals +
    `net ${n.netId}  tick ${n.serverTick}  remotes ${n.remotes}\n` +
    (remote
      ? `rtt ${n.rttMs.toFixed(0)}ms  jitter ${n.jitterMs.toFixed(0)}ms  (measured)\n`
      : `you   ${linkText(link)}\npeer  ${linkText(peerLink)}\n`) +
    `corrections ${rate.toFixed(1)}%  peak ${n.peakDivergence.toFixed(3)}m\n` +
    `snapshots ${n.snapshotsApplied}  missed ${n.missedBaselines}  in flight ${server.inFlight}`
  );
}

/** One line for the squad panel: where you are and how it is going. */
function squadStatus(): string {
  if (!live) return '';
  if (live.remote) return describeStatus(live.remote.status, live.net.slot);
  return `in-page session — slot ${live.net.slot + 1} of 6, you and a sparring bot`;
}

function frame(): void {
  syncBlockers(live?.net ?? null);
  const now = performance.now();
  const dt = (now - last) / 1000;
  const steps = clock.advance(dt);
  last = now;

  const net = live?.net ?? null;
  const server = live?.server ?? null;
  const sparring = live?.sparring ?? null;

  for (let i = 0; i < steps; i++) {
    const tickInput = input.sample();
    if (!net || !server) continue;

    /**
     * Weapons run on the tick, not the frame. RPM, reload and the spread seed
     * are all functions of simulation time and tick number (T-1.17), so firing
     * from the render loop would make cadence depend on frame rate and make the
     * spread a different pattern on every machine.
     */
    const tickNumber = clock.tick - steps + i + 1;

    /**
     * Speed is measured across the PREDICT STEP ALONE — before and after this
     * one call — rather than tick to tick.
     *
     * Between two ticks a reconcile can land, which snaps to authority and
     * replays every unacknowledged input at once. Differentiating across that
     * reports the replay as motion: at 200 ms it showed a 20 m/s peak for a
     * character whose sprint is 6.8. Nothing between these two lines but the
     * step the player's own input caused.
     */
    const beforeStep = net.simulated;
    net.tick(tickNumber, tickInput, input.pitchWire);
    sparring?.tick(tickNumber);
    const afterStep = net.simulated;
    // Keep both ends of the tick so rendering can interpolate across it.
    simPrev = beforeStep;
    simCur = afterStep;
    if (beforeStep !== null && afterStep !== null) {
      speed = Math.hypot(afterStep.x - beforeStep.x, afterStep.z - beforeStep.z) / TICK_SECONDS;
      if (speed > peakSpeed) peakSpeed = speed;
    }

    live?.qaEnemies?.step();
    live?.qaSuppressor?.step();
    server.step(now);

    const here = net.simulated;
    const tickYaw = wireToTable(input.yaw);
    const facingX = sin(tickYaw);
    const facingZ = cos(tickYaw);
    rig.eyeHeight = cam.eyeHeight;
    const m = here
      ? muzzlePosition(here.x, here.y, here.z, facingX, facingZ, stance(), rig)
      : { x: 0, y: cam.eyeHeight, z: 0 };
    muzzle.set(m.x, m.y, m.z);

    // Tell the server what is in hand: once per switch, and again after a join.
    const item = loadoutItem();
    if (!net.joined) {
      if (equipSent?.net === net) equipSent = null;
    } else if (equipSent?.net !== net || equipSent.item !== item) {
      net.equip(item);
      equipSent = { net, item };
    }

    const triggerEdge = input.consumeTriggerEdge();
    const triggerReleased = input.consumeTriggerRelease();
    const shot = combat.tick(tickNumber, tickNumber * TICK_SECONDS, {
      origin: muzzle,
      yaw: aimYaw,
      pitch: aimPitch,
      // Downed or dead: no weapon in hand. The server refuses the Fire
      // anyway; refusing here too keeps the predicted tracer honest.
      // Both hands on the wall during a vault (T-2.21); the server refuses too.
      // A grenade or a rocket in hand: the trigger is theirs, not the gun's.
      firing: !holdingPouch && input.firing && net.vitality === 'alive' && !net.simulated?.vault,
      triggerEdge: !holdingPouch && triggerEdge,
      ads: input.ads,
      // Prone fires (T-2.42), with the predicted stance as a cone input — the
      // replayed one, not the key, so it matches what the server resolves.
      prone: net.simulated?.prone ?? false,
      // T-3.16: the server widens a suppressed shot; the prediction widens with it.
      suppression: net.suppression,
    });
    // The local machine decides WHEN the trigger pulled; the server decides
    // what that shot hit. Both run the same cadence, so a shot the client
    // allows is normally one the server allows too.
    if (shot !== null) {
      // Sent at table resolution, so the server traces the exact angles this
      // client computed and the predicted tracer shares them without rounding.
      net.fire(tickNumber, aimYaw, aimPitch, combat.weaponIndex, input.ads);
      // Kick AFTER the shot is sent: this shot goes where the view pointed,
      // the next goes where the kick leaves it.
      recoil = applyKick(recoil, combat.weapon, combat.shotsFired, input.ads);
      input.setViewOffset(recoil.yaw, recoil.pitch);
      shake = addShake(shake, combat.weapon, input.ads);
      kick = addKick(kick, combat.weapon, input.ads);
      // The flash and shell are drawn from the frame's muzzle, not this
      // tick's (B-02): see where `pendingShots` is drained.
      const pending = pendingShots[pendingShotCount] ?? { shotIndex: 0, carrierX: 0, carrierZ: 0 };
      pendingShots[pendingShotCount] = pending;
      pendingShotCount += 1;
      pending.shotIndex = combat.shotsFired;
      pending.carrierX = beforeStep && afterStep ? (afterStep.x - beforeStep.x) / TICK_SECONDS : 0;
      pending.carrierZ = beforeStep && afterStep ? (afterStep.z - beforeStep.z) / TICK_SECONDS : 0;

      /**
       * Draw it NOW. The same seeded spread the server will compute — the seed
       * is (tick, entityId, shotIndex, pellet) and every term is already known
       * here — so the predicted streak and the authoritative one share an axis
       * without anything being sent to agree on it.
       */
      combat.predictShot(
        muzzle,
        shotDirections(combat.weapon, shot, net.netId, tickNumber, aimYaw, aimPitch),
        tickNumber * TICK_SECONDS,
      );
    }

    /**
     * The throw (T-2.32): aimed while the key is held, committed on the
     * release, and flown on the tick like everything else. The server decides
     * whether it happened; this is the picture of it leaving the hand, and the
     * same two refusals the server applies are applied here so the picture
     * cannot promise a grenade the server will refuse.
     */
    throws.tick(projectileWorld());
    const canThrow = net.vitality === 'alive' && !net.simulated?.vault;
    const pouch = pouchTrigger.update({
      holding: holdingPouch,
      kind: throws.def.kind,
      triggerEdge,
      triggerHeld: input.firing,
      triggerReleased,
      ads: input.ads,
      throwHeld: input.throwHeld,
      throwReleased: input.consumeThrowRelease(),
    });
    if (pouch.launch && canThrow && here) {
      const direction = dirFromYawPitch(aimYaw, aimPitch);
      const eye = eyePosition(here.x, here.y, here.z);
      const from = throws.origin(eye, direction, projectileWorld());
      if (throws.throwFrom(from, aimYaw, aimPitch, tickNumber * TICK_SECONDS) !== null) {
        net.throwProjectile(tickNumber, aimYaw, aimPitch, throws.kind);
        // The last one gone: back to the gun, as a shooter does.
        if (holdingPouch && throws.count() <= 0) equipGun(combat.weaponIndex);
      }
    }

    /**
     * Orders and marks (T-3.29), on the tick like the throw, from latches so a
     * flick between two samples still counts. The point is the converged aim
     * — the crosshair's own raycast — which has not moved while the wheel was
     * open, since the wheel takes the mouse.
     */
    const release = input.consumeOrderRelease();
    if (release) {
      const order = orderFromRelease(release, aimSubject(net));
      if (order) net.order(order);
    }
    if (input.consumeMarkPress()) net.mark(buildMark(aimSubject(net)));
  }

  server?.pump(now);
  net?.advanceClock(dt * 1000);
  sparring?.advanceClock(dt * 1000);

  if (recoil.pitch !== 0 || recoil.yaw !== 0) {
    recoil = recoverRecoil(recoil, combat.weapon, dt);
    input.setViewOffset(recoil.yaw, recoil.pitch);
  }
  shake = decayShake(shake, dt);
  // T-3.17: a near miss is a jump in the level; the jolt lands once, on the frame that sees it.
  const suppressionNow = net?.suppression ?? 0;
  const jolt = suppressionJolt(lastSuppression, suppressionNow);
  if (jolt.posM > 0) shake = addImpulse(shake, jolt.posM, jolt.rollRad);
  lastSuppression = suppressionNow;
  suppressionOverlay.render(suppressionNow);

  /**
   * Render BETWEEN ticks, exactly as the local harness did before it was
   * networked. The simulation runs at 30 Hz; without this the local player
   * moves in 30 Hz steps however fast the display refreshes, which reads as
   * the netcode being choppy when it is really just undersampled rendering.
   *
   * The predictor's own `renderPosition` cannot do this: it returns the
   * simulated state plus the decaying correction offset, and the simulated
   * state only changes on a tick. So take the OFFSET from it — which is what it
   * uniquely knows, and which must be decayed once per frame — and apply it to
   * a position interpolated across the tick.
   */
  const smoothed = net?.renderPosition(dt * 1000) ?? null;
  const sim = net?.simulated ?? null;
  let rx = 0;
  let ry = 0;
  let rz = 0;
  if (smoothed && sim && simPrev && simCur) {
    const a = clock.alpha;
    rx = simPrev.x + (simCur.x - simPrev.x) * a + (smoothed.x - sim.x);
    ry = simPrev.y + (simCur.y - simPrev.y) * a + (smoothed.y - sim.y);
    rz = simPrev.z + (simCur.z - simPrev.z) * a + (smoothed.z - sim.z);
  } else if (smoothed) {
    rx = smoothed.x;
    ry = smoothed.y;
    rz = smoothed.z;
  }

  // Classify the rendered result, not the input. This keeps presentation tied to
  // what the player actually sees after prediction, interpolation and correction.
  // T-2.19 drives the same pose system from that rendered result.
  if (renderedPrev && dt > 0) {
    locomotion = classifyLocomotion(
      {
        velocityX: (rx - renderedPrev.x) / dt,
        velocityZ: (rz - renderedPrev.z) / dt,
        grounded: sim?.grounded ?? true,
        crouched: input.crouching,
        prone: input.proning,
        downed: net !== null && net.vitality !== 'alive',
        facingYaw: input.yaw,
        // The predicted vault's clock, carried to the frame like the position.
        vaultProgress: sim?.vault ? Math.min(1, (sim.vault.elapsed + clock.alpha * TICK_SECONDS) / config.vaultSeconds) : null,
      },
      config,
    );
  }
  renderedPrev = { x: rx, z: rz };

  const localVitality = net?.vitality ?? 'alive';
  const localDowned = localVitality !== 'alive';
  // The pose first, then the gait on top of it (T-2.22): the driver composes
  // on the pose's base transforms, so the order is what makes a crouch-walk
  // the crouch with a gait on it.
  if (localDowned) {
    playerRig.setPose(localVitality === 'dead' ? 'dead' : 'downed');
    localPoseDriver.reset();
    playerRig.aimAt(0, 0);
  } else {
    // A vault is taken standing: the server refuses one from a crouch and
    // ignores the crouch key until the landing, so the pose does too.
    // Prone beats crouch, as it does in the controller (T-2.40).
    playerRig.setPose(sim?.vault ? 'standing' : input.proning ? 'prone' : input.crouching ? 'crouched' : 'standing');
    localPoseDriver.update(locomotion, dt);
    // The weapon layer (T-2.25, T-2.26): the body points its rifle where the
    // view points, recoil included, the rifle kicks with each shot, and a
    // reload is a curve of the weapon's own clock; it fades out through a vault.
    kick = decayKick(kick, dt);
    playerRig.setHeld(heldId());
    playerRig.hold({
      pitch: wireToRadians(input.pitch),
      weight: 1 - localPoseDriver.vaultWeight,
      kickBack: kick.back,
      kickUp: kick.up,
      reload: holdingPouch ? 0 : combat.reloadProgress((clock.tick + clock.alpha) * TICK_SECONDS),
    });
  }

  const downed = localDowned;

  // Remote characters at the interpolation delay (T-1.16), squad and enemy
  // alike (T-3.11): one rig, one pose driver, one weapon layer, one set of
  // feet. What differs is the paint, chosen from the entity's own components —
  // an `Enemy` component means the other side, and an enemy has no slot, so
  // it is in no roster and on no HUD. Anything the client no longer returns
  // has despawned, and everything drawn for it goes with it.
  remotes.update(net, dt);

  // T-3.29: the squad's orders and marks, where the soldiers they name are drawn.
  if (net) {
    const drawn = net.remotes();
    const bySlot = new Map<number, MarkerVec>();
    for (const [netId, at] of drawn) {
      const slot = net.remoteSlot(netId);
      if (slot >= 0) bySlot.set(slot, at);
    }
    const self = { x: rx, y: ry, z: rz };
    orderMarkerOverlay.show(
      orderMarkers(net.orders, net.marks, {
        slot: (slot) => (slot === net.slot ? self : bySlot.get(slot) ?? null),
        netId: (netId) => (netId === net.netId ? self : drawn.get(netId) ?? null),
      }),
    );
  }
  orderWheel.update(input.orderWheel);

  player.position.set(rx, ry + 0.9, rz);

  /**
   * Foot placement (T-2.28), last: the layer asks the world what is under
   * each foot, so it runs once the root is standing where the authoritative
   * state puts it. The root itself is untouched — only the legs under it.
   */
  localFeet.update(
    {
      feetY: ry,
      active: !localDowned && !sim?.vault && localPoseDriver.vaultWeight === 0,
    },
    dt,
  );

  /**
   * Projectiles (T-2.32): the replicated ones at the interpolation delay, like
   * every other thing the server owns, and our own predicted ghosts between
   * their ticks. A ghost and its twin are never both drawn — `bind` matches
   * them up, and `isGhosted` is how the twin knows to stay out of the picture
   * until the ghost is gone.
   */
  const seenProjectiles = new Set<string>();
  const liveProjectiles = net?.projectiles() ?? [];
  throws.bind(liveProjectiles, net?.slot ?? -1);
  for (const id of throws.takeRetired()) dropProjectileMesh(`g${id}`);
  for (const projectile of liveProjectiles) {
    if (throws.isGhosted(projectile.netId)) continue;
    const key = `p${projectile.netId}`;
    seenProjectiles.add(key);
    const mesh = projectileMesh(key, projectile.kind);
    mesh.position.set(projectile.x, projectile.y, projectile.z);
    pointAlong(mesh, projectile.vx, projectile.vy, projectile.vz);
  }
  for (const ghost of throws.ghosts) {
    const key = `g${ghost.id}`;
    seenProjectiles.add(key);
    const mesh = projectileMesh(key, ghost.kind);
    // Between ticks, like the local player: the ghost steps at 30 Hz and the
    // display does not.
    const a = clock.alpha;
    mesh.position.set(
      ghost.prev.x + (ghost.state.x - ghost.prev.x) * a,
      ghost.prev.y + (ghost.state.y - ghost.prev.y) * a,
      ghost.prev.z + (ghost.state.z - ghost.prev.z) * a,
    );
    pointAlong(mesh, ghost.state.vx, ghost.state.vy, ghost.state.vz);
  }
  for (const key of [...projectileMeshes.keys()]) {
    if (!seenProjectiles.has(key)) dropProjectileMesh(key);
  }

  /**
   * The arc, while the throw key is held: `projectileArc`'s own points, from
   * the eye along the converged aim, over the world the server will fly the
   * real one through. It is a promise the server keeps to within half a round
   * trip of the thrower's movement, and nothing else.
   */
  const aiming = pouchTrigger.aiming && net?.vitality === 'alive' && !sim?.vault && throws.count() > 0;
  arcLine.visible = aiming;
  arcMarker.visible = false;
  if (aiming) {
    const world = projectileWorld();
    const direction = dirFromYawPitch(aimYaw, aimPitch);
    const eye = eyePosition(rx, ry, rz);
    const from = throws.origin(eye, direction, world);
    throwOrigin.set(from.x, from.y, from.z);
    const arc = throws.arc(from, aimYaw, aimPitch, world);
    const count = Math.min(arc.points.length, MAX_ARC_POINTS);
    for (let i = 0; i < count; i += 1) {
      const point = arc.points[i];
      if (!point) break;
      arcPositions[i * 3] = point.x;
      arcPositions[i * 3 + 1] = point.y;
      arcPositions[i * 3 + 2] = point.z;
    }
    arcGeometry.setDrawRange(0, count);
    (arcGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    arcGeometry.computeBoundingSphere();
    const end = arc.detonation ?? arc.impact?.point ?? null;
    if (end) {
      arcMarker.visible = true;
      arcMarker.position.set(end.x, end.y + 0.02, end.z);
      // Laid flat wherever the arc ends, which for a thrown grenade is the
      // ground it has rolled to rest on and for a rocket is the wall it stops
      // against — a ring hanging in the air is the honest picture of an arc
      // whose fuse runs out mid-flight.
      arcMarker.rotation.set(-Math.PI / 2, 0, 0);
    }
  }

  /**
   * Camera (T-2.01). The pivot, shoulder and arm arithmetic lives in
   * `cameraSolve.ts`, where a test can reach it; what remains here is the
   * Three.js bookkeeping — the Euler, the field-of-view ease, and assignment.
   */
  solveCamera(
    {
      x: rx,
      y: ry,
      z: rz,
      yawWire: input.viewYaw,
      pitchWire: input.pitch,
      pitchFraction: input.pitchFraction,
      ads: input.ads,
      // A downed soldier is forced into third person (B-05): there is no
      // weapon in hand for a first-person view to promise anything about.
      firstPerson: input.firstPerson && !downed,
      shoulderSide: input.shoulderSide,
      downed,
      prone: input.proning && !downed && !sim?.vault,
      // Same gate as the rig's pose: a vault is taken standing.
      crouched: input.crouching && !downed && !sim?.vault,
    },
    cam,
    camSolve,
    dt,
    cameraCollider,
  );
  player.rotation.y = Math.atan2(camSolve.forward.x, camSolve.forward.z);
  updateMuzzleRig();
  // After the arm and its collision, before the camera is placed: the aim
  // below reads `camSolve.position`, which this leaves alone.
  applyShake(camSolve, shake, cam.shakeScale);

  const ads = input.ads;

  // Field of view IS the aim cue. Eased rather than snapped so it reads as
  // shouldering a weapon instead of a hard cut. Through a scope in first
  // person the same ease carries on to the scope's field, and the look
  // slows with the zoom so the reticle can be laid on a head at range.
  const scopeFov = input.firstPerson && !downed && !holdingPouch ? combat.weapon.scopeFovDeg : undefined;
  const targetFov = scopeFov === undefined ? camSolve.fov : scopedFov(cam.baseFov, scopeFov, camSolve.adsBlend);
  input.setLookScale(scopeFov === undefined ? 1 : scopedLookScale(cam.baseFov, targetFov));
  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov = targetFov;
    camera.updateProjectionMatrix();
  }
  if (crosshair) {
    crosshair.classList.toggle('ads', ads);
    // No weapon in hand while downed: nothing for a reticle to promise.
    crosshair.classList.toggle('hidden', downed);
    // Aimed in first person the weapon's own sights are the aim (their post
    // tip is the screen's centre), so the crosshair gets out of their way.
    crosshair.classList.toggle('sighted', ads && input.firstPerson && !holdingPouch);
  }
  if (missionHud) {
    const mission = missionLine(net?.mission ?? null);
    const notice = performance.now() < scriptNoticeUntil ? scriptNotice : '';
    const text = [mission, notice].filter((x) => x.length > 0).join(' — ');
    if (missionHud.textContent !== text) missionHud.textContent = text;
    missionHud.classList.toggle('shown', text.length > 0);
  }
  if (downedBanner) {
    const stats = net?.stats;
    const timer = stats?.vitalTimer ?? 0;
    let text = '';
    if (localVitality === 'dead') {
      // Dead is not downed: nobody can revive a body, and the timer is the respawn's.
      text = timer > 0 ? `KILLED — back in ${timer}s` : 'KILLED';
    } else if (downed) {
      if ((stats?.reviverSlot ?? -1) >= 0) {
        const name = net?.roster[stats?.reviverSlot ?? -1]?.name || 'A teammate';
        text = `DOWNED — ${name} is reviving you ${Math.round(stats?.reviveProgress ?? 0)}% — ${timer}s`;
      } else {
        text = `DOWNED — bleeding out ${timer}s — wait for a teammate to revive you`;
      }
    } else if (performance.now() < rejoinNoticeUntil) {
      text = rejoinNotice;
    } else if ((net?.reviveTargetNetId ?? 0) > 0) {
      const targetNetId = net?.reviveTargetNetId ?? 0;
      const name = net?.roster[net?.remoteSlot(targetNetId) ?? -1]?.name || 'teammate';
      text = `Hold E to revive ${name} ${Math.round(net?.remoteReviveProgress(targetNetId) ?? 0)}%`;
    }
    if (downedBanner.textContent !== text) downedBanner.textContent = text;
    downedBanner.classList.toggle('shown', text.length > 0);
  }
  // Every value in the camera panel describes where the arm puts the camera
  // relative to a character you cannot see in first person.
  cameraPanel.setVisible(!input.firstPerson);

  /**
   * Orient from the angles directly rather than with `lookAt`.
   *
   * `lookAt` builds a basis by crossing the view direction with world up, which
   * degenerates as the view approaches vertical — and the pitch limit is now 89
   * degrees, so the view gets there. Setting a YXZ Euler is exact at every
   * pitch: yaw is the Y term, pitch the X term, and roll is the shake's
   * (T-2.09) — zero unless a shot is ringing. The +PI turns the camera's
   * default -Z gaze onto the +Z forward this project uses.
   */
  camera.rotation.set(
    toRadians(camSolve.pitchAngle),
    toRadians(camSolve.yawAngle) + Math.PI,
    camSolve.shake.roll,
    'YXZ',
  );

  // The shake rides on top of the solved position and nowhere else: the aim
  // ray below is cast from `camSolve.position`, which it never touches.
  camera.position.set(
    camSolve.position.x + camSolve.shake.x,
    camSolve.position.y + camSolve.shake.y,
    camSolve.position.z + camSolve.shake.z,
  );
  // Your own character is the one thing the first-person camera sits inside.
  // Downed forces third person (B-05), so the body stays visible then too.
  player.visible = !input.firstPerson || downed;

  /**
   * Converge the shot on what the reticle covers.
   *
   * Measured from the EYE, which is where the server traces from — not from the
   * visual muzzle. Aiming along the camera angles would land shots beside the
   * crosshair in third person, where the camera is off the shoulder; aiming
   * from the visual muzzle would make the shot depend on which view you are
   * using. Find what the reticle is actually over, then aim the eye at THAT.
   *
   * This is the second time this convergence has been put in. It came out with
   * the dynamic third-person reticle, which moved the crosshair to wherever the
   * eye's ray landed instead; that reticle read as jitter (it lagged the view
   * by a frame) and has been replaced with a fixed centre reticle whose GAP
   * shows the inaccuracy. A fixed centre reticle without convergence is the
   * down-and-left bug all over again, so the two go together.
   */
  aimDirection.set(camSolve.direction.x, camSolve.direction.y, camSolve.direction.z).normalize();
  aimOrigin.set(camSolve.position.x, camSolve.position.y, camSolve.position.z);
  aimRaycaster.set(aimOrigin, aimDirection);
  aimRaycaster.far = AIM_RANGE;
  const [reticleHit] = aimRaycaster.intersectObjects(shootable, false);
  aimNetId = reticleHit ? remotes.netIdOf(reticleHit.object) : null;
  if (reticleHit) {
    aimPoint.copy(reticleHit.point);
  } else {
    aimPoint.copy(aimOrigin).addScaledVector(aimDirection, AIM_RANGE);
  }
  // Prone traces from a prone eye (T-2.42), so converge from there too.
  const eye = eyePosition(rx, ry, rz, DEFAULT_MUZZLE_RIG, sim?.prone ?? false);
  aimDirection.set(aimPoint.x - eye.x, aimPoint.y - eye.y, aimPoint.z - eye.z).normalize();

  /**
   * The reticle stays at the centre and its gap follows the cone: wide while
   * hip firing, wider as bloom builds, tight while aiming down sights. The
   * cone is the same one the weapon actually fires with (`CombatQA`), so what
   * the arms enclose is where pellets can land.
   */
  if (crosshair) {
    const cone = crosshairGapPx(combat.coneDegrees(ads, sim?.prone ?? false, net?.suppression ?? 0), camera.fov, innerHeight);
    const gap = Math.round(Math.max(ads ? ADS_GAP_MIN_PX : HIP_GAP_MIN_PX, cone));
    if (gap !== crosshairGap) {
      crosshairGap = gap;
      crosshair.style.setProperty('--gap', `${gap}px`);
    }
    // T-3.29: what an attack, a revive or a mark would name, on the reticle itself.
    const subject = net ? aimSubject(net) : null;
    const over = subject?.enemy ? 'enemy' : subject?.downedMate ? 'downed' : subject?.netId != null ? 'soldier' : '';
    if (crosshair.dataset['aim'] !== over) crosshair.dataset['aim'] = over;
  }

  /**
   * Rounded ONCE, straight to the resolution the wire now carries (1/4096).
   * The previous path rounded to 1/4096 and then shifted down to 1/1024, and a
   * shift truncates — so the aim was biased consistently to one side by up to
   * a quarter of a degree rather than merely quantized.
   */
  aimYaw = fromRadians(Math.atan2(aimDirection.x, aimDirection.z));
  aimPitch = fromRadians(Math.asin(Math.max(-1, Math.min(1, aimDirection.y))));

  frames++;
  if (now - fpsAt >= 250) {
    fps = Math.round((frames * 1000) / (now - fpsAt));
    frames = 0;
    fpsAt = now;
    if (stats) {
      stats.textContent =
        `${speed.toFixed(2)} m/s   peak ${peakSpeed.toFixed(2)}\n` +
        `${net?.simulated?.vault ? `vaulting  ${(net.simulated.vault.elapsed * 1000).toFixed(0)}ms` : net?.simulated?.grounded ?? true ? 'grounded' : `airborne  y ${ry.toFixed(2)}`}\n` +
        `tick ${clock.tick}   ${fps} fps${clock.dropped ? `   dropped ${clock.dropped}` : ''}\n` +
        `${input.firstPerson ? 'first person  (V for third)' : 'third person  (V swaps shoulder, RMB aims into first)'}\n` +
        `locomotion ${locomotion.state}  ${locomotion.direction}  ${Math.round(locomotion.normalizedSpeed * 100)}%   rig ${playerRig.kind}\n` +
        `pose step ${localPoseDriver.step.toFixed(3)} rad  peak ${localPoseDriver.peakStep.toFixed(3)}\n` +
        `feet at ${rx.toFixed(1)},${rz.toFixed(1)}  L ${localFeet.offset('left').toFixed(2)}  R ${localFeet.offset('right').toFixed(2)}` +
        `  hips ${localFeet.drop.toFixed(2)}  step ${localFeet.step.toFixed(3)}\n` +
        `${input.locked ? `mouse captured - Esc to release${input.immersive ? '  (fullscreen, shortcuts locked out)' : ''}` : 'CLICK to capture mouse'}\n` +
        `${aimReadout()}\n` +
        `\n${combat.readout(clock.tick * TICK_SECONDS, input.ads)}\n` +
        `${throws.readout(clock.tick * TICK_SECONDS)}` +
        `${lastBlast ? `\nlast blast ${lastBlast.name}  ${lastBlast.damage.toFixed(0)} dmg on ${lastBlast.targets}` : ''}\n` +
        `${effects.readout()}\n` +
        `\n${netReadout()}`;
    }
  }

  const effectsNow = clock.tick * TICK_SECONDS + clock.alpha * TICK_SECONDS;
  combat.fade(effectsNow);
  /**
   * The flash and shell come from the muzzle as DRAWN this frame (B-02) — the
   * rendered position, interpolated between ticks, and the camera's own pivot
   * height — not the tick-end muzzle the shot was taken from. In first person
   * the two differ by up to a tick of movement straight along the view axis
   * when running forward or backward, and the aimed muzzle sits a few
   * centimetres in front of the eye: a flash placed from the tick's muzzle
   * landed in front of the near plane on some frames and behind it on others,
   * so every round blinked a screen-filling sprite on or off. That was the
   * run-and-fire strobe. The hit is still traced from the tick's eye; this is
   * only where the picture of the shot is drawn.
   */
  if (live) {
    drawnRig.shoulderRight = rig.shoulderRight;
    drawnRig.eyeHeight = input.firstPerson && !downed ? camSolve.position.y - ry : cam.eyeHeight;
    const fwdX = camSolve.forward.x;
    const fwdZ = camSolve.forward.z;
    const drawn = muzzlePosition(rx, ry, rz, fwdX, fwdZ, stance(), drawnRig);
    for (let i = 0; i < pendingShotCount; i += 1) {
      const pending = pendingShots[i]!;
      // The shell comes to rest at the feet: whatever the character stands on.
      effects.fire(drawn, fwdX, fwdZ, ry, pending.shotIndex, effectsNow, {
        x: pending.carrierX,
        y: 0,
        z: pending.carrierZ,
      });
    }
    effects.followMuzzle(drawn, fwdX, fwdZ);
  }
  pendingShotCount = 0;
  effects.update(effectsNow);
  netgraph.sample();
  if (live && now - squadAt >= 250) {
    squadAt = now;
    squadPanel.update(live.net.roster, live.net.slot, live.net.room, squadStatus());
  }

  // T-4.07: choose each static placement's LOD from this frame's camera before drawing.
  levelPieces.update(camera);
  renderer.render(scene, camera);
  aiDebug.render(camera, innerWidth, innerHeight);
  orderMarkerOverlay.render(camera, innerWidth, innerHeight);
  /**
   * The weapon in hand in first person, over the world. Hidden whenever the
   * body is shown instead (third person, downed) and through a vault, when
   * both hands are on the wall.
   */
  viewModel.update({
    visible: input.firstPerson && !downed && !!net && !sim?.vault,
    held: heldId(),
    ads: input.ads && !holdingPouch,
    winding: aiming && holdingPouch && throws.def.kind === 'thrown',
    kickBack: kick.back,
    kickUp: kick.up,
    reload: holdingPouch ? 0 : combat.reloadProgress((clock.tick + clock.alpha) * TICK_SECONDS),
    speed,
    dt,
    aspect: camera.aspect,
    scoped: !holdingPouch && combat.weapon.scopeFovDeg !== undefined,
  });
  viewModel.render(renderer);
  scopeOverlay.set(viewModel.scoped);
  requestAnimationFrame(frame);
}
player.visible = false;
lobby.show();
requestAnimationFrame(frame);

addEventListener('keydown', (e) => {
  // Typing in the lobby is not a hotkey.
  if (isTextField(e.target)) return;
  // R is reload, not reset: this is a shooter now and R is muscle memory.
  // Reset moved to T.
  // Nothing to reload with a grenade or a launcher in hand.
  if (e.code === 'KeyR' && !holdingPouch) combat.requestReload(clock.tick * TICK_SECONDS);
  // T resets the local readouts only. Position is authoritative now, so
  // teleporting to spawn needs a server-side respawn — that is T-1.19.
  if (e.code === 'KeyT') {
    peakSpeed = 0;
    localPoseDriver.resetPeak();
    localFeet.resetPeak();
    combat.reset();
  effects.reset();
    // The pouch is a range's, not a match's: T gives the grenades back too.
    for (const id of throws.takeRetired()) dropProjectileMesh(`g${id}`);
    throws.reset();
    for (const id of throws.takeRetired()) dropProjectileMesh(`g${id}`);
    lastBlast = null;
  }
  // 1-4 pick a weapon, 5-6 the pouch: each one EQUIPS, and the trigger uses
  // what is in hand. Switching is instant and reloads: a range, not a match.
  // While the order wheel is open the number keys pick who hears it (T-3.29).
  const slot = input.orderWheel ? -1 : Number.parseInt(e.code.replace('Digit', ''), 10);
  if (e.code.startsWith('Digit') && slot >= 1 && slot <= WEAPON_ORDER.length) {
    equipGun(slot - 1);
  }
  if (e.code.startsWith('Digit') && slot > WEAPON_ORDER.length && slot <= WEAPON_ORDER.length + PROJECTILE_ORDER.length) {
    equipPouch(slot - WEAPON_ORDER.length - 1);
  }
  if (e.code === 'KeyH') toggleHud();
  // P asks the host to start the mission again; it only does once the mission is over (T-3.34).
  if (e.code === RESTART_KEY && !e.repeat) live?.net.restartMission();
  // N for netgraph. It was G until T-2.32 needed G for the grenade, which is
  // the more valuable piece of muscle memory; H still hides the whole HUD.
  if (e.code === 'KeyN') netgraph.root.classList.toggle('collapsed');
  // B for brains (T-3.09): the AI debug overlay, asked of the host on demand.
  if (e.code === 'KeyB' && !e.repeat) {
    aiDebug.setEnabled(!aiDebug.isEnabled);
    live?.net.requestAiDebug(aiDebug.isEnabled);
  }
  // V is owned by LocalInput: in TPS it swaps shoulders; in FPS it exits FPS
  // and restores the stored TPS shoulder. ADS is the automatic FPS entry path.

});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
