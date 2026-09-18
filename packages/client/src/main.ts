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
 * Covered today: movement (T-1.12) and weapons (T-1.17).
 *
 * This runs the same `stepCharacter` the authoritative server runs (T-1.12), at
 * the same fixed 30 Hz, driven by local input, and fires the same `tryFire` and
 * `shotDirections` the server will (T-1.17). No network yet: prediction and
 * reconciliation are T-1.14/T-1.15, and until they are wired in here there is
 * nothing networked worth looking at.
 *
 * Its job is to make FEEL judgeable, since the constants in
 * DEFAULT_MOVE_CONFIG and data/weapons.json are guesses and everything
 * downstream (level scale, cover spacing, encounter pacing, animation timing)
 * is built on top of them.
 *
 * KNOWN GAP: T-1.12 is partial. The plan specified a Rapier kinematic
 * controller with slope limits and step offset; this is pure math on a flat
 * plane. There is no collision — you will walk through scenery. Speed, jump arc,
 * gravity and turn rate are real; terrain behaviour is not implemented.
 */
import * as THREE from 'three';
import {
  Clock,
  DEFAULT_MOVE_CONFIG,
  type MoveConfig,
  TICK_SECONDS,
  cos,
  createMoveState,
  fromRadians,
  sin,
  stepCharacter,
  wireToTable,
} from '@sandline/shared';
import { LocalInput } from './input/LocalInput.ts';
import { solveArmLength } from './camera/followCamera.ts';
import { CombatQA, WEAPON_ORDER } from './weapons/CombatQA.ts';
import { createTuningPanel } from './ui/TuningPanel.ts';

/* -- Scene ----------------------------------------------------------------- */

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

/**
 * A field of distance posts every 10 m across the whole playable area.
 *
 * Judging "does this feel too fast" is impossible without a sense of scale, and
 * markers running in ONE direction only help until you turn. Posts on a grid
 * mean there is always something passing you, whichever way you run — which is
 * what actually communicates speed.
 */
const markerMat = new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.9 });
const tallMat = new THREE.MeshStandardMaterial({ color: 0xf0b429, roughness: 0.8 });
const postGeo = new THREE.BoxGeometry(0.18, 1.4, 0.18);
const tallGeo = new THREE.BoxGeometry(0.22, 2.6, 0.22);

for (let gx = -40; gx <= 40; gx += 10) {
  for (let gz = -40; gz <= 40; gz += 10) {
    if (gx === 0 && gz === 0) continue; // keep spawn clear
    // Every 20 m gets a taller, brighter post so distance stays countable.
    const major = gx % 20 === 0 && gz % 20 === 0;
    const post = new THREE.Mesh(major ? tallGeo : postGeo, major ? tallMat : markerMat);
    post.position.set(gx, (major ? 2.6 : 1.4) / 2, gz);
    post.castShadow = true;
    scene.add(post);
  }
}

/**
 * A 10 m sprint lane at spawn. Sprint from one end to the other and count
 * seconds: that turns "feels fast" into a number you can act on.
 */
const laneMat = new THREE.MeshStandardMaterial({ color: 0xc2532e, roughness: 1 });
for (const z of [-1.2, 1.2]) {
  const rail = new THREE.Mesh(new THREE.BoxGeometry(10, 0.05, 0.12), laneMat);
  rail.position.set(5, 0.03, z);
  scene.add(rail);
}

/** A 1.8 m reference figure: the only way to read speed and jump height. */
const reference = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.35, 1.1, 4, 12),
  new THREE.MeshStandardMaterial({ color: 0x8b6f47, roughness: 0.9 }),
);
reference.position.set(-3, 0.9, 3);
reference.castShadow = true;
reference.name = 'reference figure';
scene.add(reference);

/**
 * The firing range: targets at known distances straight ahead of spawn.
 *
 * Damage falloff (T-1.17) is a curve between two distances per weapon, and a
 * curve you cannot stand at three points of is just a pair of numbers in JSON.
 * These sit either side of the carbine's 22 m / 55 m falloff band and the
 * breacher's 6 m / 18 m one, so the drop-off is something you walk to rather
 * than read. Offset in x so they do not share a cell with a distance post.
 */
const targets: THREE.Object3D[] = [reference];
const targetMat = new THREE.MeshStandardMaterial({ color: 0xcf6a4c, roughness: 0.85 });
const targetGeo = new THREE.CapsuleGeometry(0.35, 1.1, 6, 14);
for (const distance of [10, 20, 35, 55, 80, 95]) {
  const target = new THREE.Mesh(targetGeo, targetMat);
  target.position.set(2.5, 0.9, distance);
  target.castShadow = true;
  target.name = `range ${distance}m`;
  scene.add(target);
  targets.push(target);
}

/* -- Player ---------------------------------------------------------------- */

const config: MoveConfig = { ...DEFAULT_MOVE_CONFIG };
const input = new LocalInput(renderer.domElement);

/** Camera pivot height: roughly the eyes of a 1.8 m soldier. */
const EYE_HEIGHT = 1.55;
/** Third-person arm length before pitch shortening. */
const CAMERA_DISTANCE = 5.5;
/**
 * Over-the-shoulder offset.
 *
 * A centred third-person camera puts the character directly under the reticle,
 * so you aim at your own back and cannot see what you are shooting. Offsetting
 * the camera sideways is the standard fix and the reason every third-person
 * shooter looks over one shoulder.
 */
const SHOULDER_RIGHT = 0.85;
const SHOULDER_RIGHT_ADS = 0.55;
const SHOULDER_UP = 0.3;
/** Never let the camera sink below this. The ground plane is y = 0. */
const MIN_CAMERA_Y = 0.3;
/** ...and never collapse the arm entirely while doing it. */
const MIN_CAMERA_DISTANCE = 1.0;
const ARM_LIMITS = { minCameraY: MIN_CAMERA_Y, minDistance: MIN_CAMERA_DISTANCE };
const BASE_FOV = 60;
/** Narrowing the field of view IS the aim cue, in both first and third person. */
const ADS_FOV = 38;
/** How far the aim ray looks for something to converge on. */
const AIM_RANGE = 250;

let state = createMoveState(0, 0, 0);
let prevState = state;

const player = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.35, 1.1, 6, 16),
  new THREE.MeshStandardMaterial({ color: 0xf0b429, roughness: 0.6 }),
);
player.castShadow = true;
scene.add(player);

// A nose marker, so facing is readable — a capsule alone gives no yaw cue.
const nose = new THREE.Mesh(
  new THREE.BoxGeometry(0.12, 0.12, 0.45),
  new THREE.MeshStandardMaterial({ color: 0x2a2113 }),
);
player.add(nose);
nose.position.set(0, 0.45, 0.4);

// Five bot slots, stationary, for scale. ADR-001: the squad is always six.
for (let i = 1; i < 6; i++) {
  const bot = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.35, 1.1, 4, 12),
    new THREE.MeshStandardMaterial({ color: 0xb9a37a, roughness: 0.9 }),
  );
  bot.position.set(i * 1.6 - 6, 0.9, -4);
  bot.castShadow = true;
  bot.name = `squad slot ${i}`;
  scene.add(bot);
  targets.push(bot);
}

const combat = new CombatQA(scene, targets);

/* -- UI -------------------------------------------------------------------- */

const hud = document.getElementById('hud');
const stats = document.getElementById('stats');
document.body.appendChild(
  createTuningPanel(
    config,
    (v) => input.setSensitivity(v),
    (v) => input.setInvertY(v),
  ),
);

/* -- Loop ------------------------------------------------------------------ */

const clock = new Clock();
/** Reused so a held trigger does not allocate a vector per tick. */
const muzzle = new THREE.Vector3();
const aimRaycaster = new THREE.Raycaster();
const aimDirection = new THREE.Vector3();
const aimPoint = new THREE.Vector3();
/** Everything the reticle can converge on, ground included. */
const aimTargets: THREE.Object3D[] = [...targets, ground];
/**
 * Where the shot actually goes, in table angle units, recomputed each frame
 * from the camera. One frame behind the tick that consumes it, which at 60 fps
 * is 16 ms of aim lag - invisible here, and the alternative is computing the
 * camera twice per frame.
 */
let aimYaw = 0;
let aimPitch = 0;
const crosshair = document.getElementById('crosshair');
let last = performance.now();
let frames = 0;
let fpsAt = last;
let fps = 0;
let peakSpeed = 0;

function frame(): void {
  const now = performance.now();
  const dt = (now - last) / 1000;
  const steps = clock.advance(dt);
  last = now;

  for (let i = 0; i < steps; i++) {
    prevState = state;
    state = stepCharacter(state, input.sample(), TICK_SECONDS, config);

    /**
     * Weapons run on the tick, not the frame. RPM, reload and the spread seed
     * are all functions of simulation time and tick number (T-1.17), so firing
     * from the render loop would make cadence depend on frame rate and make the
     * spread a different pattern on every machine.
     */
    const tickNumber = clock.tick - steps + i + 1;
    muzzle.set(state.x, state.y + EYE_HEIGHT, state.z);
    combat.tick(tickNumber, tickNumber * TICK_SECONDS, {
      origin: muzzle,
      yaw: aimYaw,
      pitch: aimPitch,
      firing: input.firing,
      triggerEdge: input.consumeTriggerEdge(),
      ads: input.ads,
    });
  }

  // Render BETWEEN ticks. Without this the 30 Hz simulation shows as stutter,
  // and stutter gets misread as bad movement feel — which would make this whole
  // QA pass measure the wrong thing.
  const a = clock.alpha;
  const rx = prevState.x + (state.x - prevState.x) * a;
  const ry = prevState.y + (state.y - prevState.y) * a;
  const rz = prevState.z + (state.z - prevState.z) * a;

  player.position.set(rx, ry + 0.9, rz);

  const yawAngle = wireToTable(input.yaw);
  const fx = sin(yawAngle);
  const fz = cos(yawAngle);
  player.rotation.y = Math.atan2(fx, fz);

  /**
   * Orbit camera around an eye-height pivot.
   *
   * The previous version only raised and lowered the camera, which is why
   * looking down felt cramped: the camera never actually pitched, it just
   * hovered. Now pitch defines a real view direction and the camera sits one
   * arm's length back along it.
   */
  const pitchAngle = wireToTable(((input.pitch % 1024) + 1024) % 1024);
  const sinP = sin(pitchAngle);
  const cosP = cos(pitchAngle);

  const pivotY = ry + EYE_HEIGHT;
  // View direction: horizontal component shrinks as pitch steepens.
  const dx = fx * cosP;
  const dy = sinP;
  const dz = fz * cosP;

  const ads = input.ads;

  // Field of view IS the aim cue. Eased rather than snapped so it reads as
  // shouldering a weapon instead of a hard cut.
  const targetFov = ads ? ADS_FOV : BASE_FOV;
  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, 12 * dt);
    camera.updateProjectionMatrix();
  }
  if (crosshair) crosshair.classList.toggle('ads', ads);

  if (input.firstPerson) {
    camera.position.set(rx, pivotY, rz);
    camera.lookAt(rx + dx * 10, pivotY + dy * 10, rz + dz * 10);
    player.visible = false;
  } else {
    player.visible = true;
    /**
     * Right is cross(forward, up), which for a Y-up right-handed system and a
     * yaw-only forward reduces to (-fz, 0, fx). Same handedness the strafe fix
     * established - getting it backwards here would put the camera over the
     * wrong shoulder and mirror the aim offset.
     */
    const shoulder = ads ? SHOULDER_RIGHT_ADS : SHOULDER_RIGHT;
    const focusX = rx - fz * shoulder;
    const focusY = pivotY + SHOULDER_UP;
    const focusZ = rz + fx * shoulder;

    let dist = CAMERA_DISTANCE * (ads ? 0.6 : 1) * (1 - 0.35 * Math.abs(input.pitchFraction));

    /**
     * Floor clamp.
     *
     * Looking up swings the arm DOWN and behind, which used to push the camera
     * through the ground plane. Rather than stopping at the floor and letting
     * the view stay buried, shorten the arm to exactly the length that lands
     * the camera on MIN_CAMERA_Y: the camera then draws in toward the
     * character's feet as you keep looking up, which is what the eye expects.
     * The real spring arm with scene collision is still E-2.1 in M2.
     */
    dist = solveArmLength(dist, focusY, dy, ARM_LIMITS);

    camera.position.set(focusX - dx * dist, focusY - dy * dist, focusZ - dz * dist);
    camera.lookAt(focusX + dx * 10, focusY + dy * 10, focusZ + dz * 10);
  }

  /**
   * Converge the shot on what the reticle covers.
   *
   * The muzzle is at the character's eye but the camera is off the shoulder, so
   * the two are not on one line and firing along the camera angles would land
   * shots beside the crosshair. Find what the reticle is actually over, then
   * aim the muzzle at THAT. Accurate at every distance rather than at one
   * calibrated range.
   */
  aimDirection.set(dx, dy, dz).normalize();
  aimRaycaster.set(camera.position, aimDirection);
  aimRaycaster.far = AIM_RANGE;
  const [reticleHit] = aimRaycaster.intersectObjects(aimTargets, false);
  if (reticleHit) {
    aimPoint.copy(reticleHit.point);
  } else {
    aimPoint.copy(camera.position).addScaledVector(aimDirection, AIM_RANGE);
  }
  aimDirection.set(aimPoint.x - rx, aimPoint.y - (ry + EYE_HEIGHT), aimPoint.z - rz).normalize();
  aimYaw = fromRadians(Math.atan2(aimDirection.x, aimDirection.z));
  aimPitch = fromRadians(Math.asin(Math.max(-1, Math.min(1, aimDirection.y))));

  const speed = Math.hypot(state.x - prevState.x, state.z - prevState.z) / TICK_SECONDS;
  if (speed > peakSpeed) peakSpeed = speed;

  frames++;
  if (now - fpsAt >= 250) {
    fps = Math.round((frames * 1000) / (now - fpsAt));
    frames = 0;
    fpsAt = now;
    if (stats) {
      stats.textContent =
        `${speed.toFixed(2)} m/s   peak ${peakSpeed.toFixed(2)}\n` +
        `${state.grounded ? 'grounded' : `airborne  y ${state.y.toFixed(2)}`}\n` +
        `tick ${clock.tick}   ${fps} fps${clock.dropped ? `   dropped ${clock.dropped}` : ''}\n` +
        `${input.firstPerson ? 'first person' : 'third person'}  (V to swap)\n` +
        `${input.locked ? 'mouse captured - Esc to release' : 'CLICK to capture mouse'}\n` +
        `\n${combat.readout(clock.tick * TICK_SECONDS, input.ads)}`;
    }
  }

  combat.fade(clock.tick * TICK_SECONDS + clock.alpha * TICK_SECONDS);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

addEventListener('keydown', (e) => {
  // R is reload, not reset: this is a shooter now and R is muscle memory.
  // Reset moved to T.
  if (e.code === 'KeyR') combat.requestReload(clock.tick * TICK_SECONDS);
  if (e.code === 'KeyT') {
    state = createMoveState(0, 0, 0);
    prevState = state;
    peakSpeed = 0;
    combat.reset();
  }
  // 1-4 pick a weapon. Switching is instant and reloads: a range, not a match.
  const slot = Number.parseInt(e.code.replace('Digit', ''), 10);
  if (e.code.startsWith('Digit') && slot >= 1 && slot <= WEAPON_ORDER.length) {
    combat.selectWeapon(slot - 1);
  }
  if (e.code === 'KeyH' && hud) hud.hidden = !hud.hidden;
  // First/third person. A proper camera with collision is E-2.1 in M2; this is
  // enough to judge whether the movement reads differently from each view.
  if (e.code === 'KeyV') input.firstPerson = !input.firstPerson;
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
