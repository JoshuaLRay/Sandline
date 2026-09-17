/**
 * Client (T-0.06) — currently a LOCAL movement QA harness.
 *
 * This runs the same `stepCharacter` the authoritative server runs (T-1.12), at
 * the same fixed 30 Hz, driven by local input. No network yet: prediction and
 * reconciliation are T-1.14/T-1.15, and until they exist there is nothing
 * networked worth looking at.
 *
 * Its job right now is to make MOVEMENT FEEL judgeable, since the constants in
 * DEFAULT_MOVE_CONFIG are guesses and everything downstream (level scale, cover
 * spacing, encounter pacing, animation timing) is built on top of them.
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
  sin,
  stepCharacter,
  wireToTable,
} from '@sandline/shared';
import { LocalInput } from './input/LocalInput.ts';
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
scene.add(reference);

/* -- Player ---------------------------------------------------------------- */

const config: MoveConfig = { ...DEFAULT_MOVE_CONFIG };
const input = new LocalInput(renderer.domElement);

/** Camera pivot height: roughly the eyes of a 1.8 m soldier. */
const EYE_HEIGHT = 1.55;
/** Third-person arm length before pitch shortening. */
const CAMERA_DISTANCE = 5.5;

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
  scene.add(bot);
}

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
let last = performance.now();
let frames = 0;
let fpsAt = last;
let fps = 0;
let peakSpeed = 0;

function frame(): void {
  const now = performance.now();
  const steps = clock.advance((now - last) / 1000);
  last = now;

  for (let i = 0; i < steps; i++) {
    prevState = state;
    state = stepCharacter(state, input.sample(), TICK_SECONDS, config);
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

  if (input.firstPerson) {
    camera.position.set(rx, pivotY, rz);
    camera.lookAt(rx + dx * 10, pivotY + dy * 10, rz + dz * 10);
    player.visible = false;
  } else {
    player.visible = true;
    /**
     * Pull in at pitch extremes.
     *
     * At a steep angle the arm would otherwise bury the camera in the ground
     * looking down, or put the character between you and the sky looking up.
     * Shortening it keeps the view clear - a poor man's spring arm until the
     * real one with collision lands in M2 (E-2.1).
     */
    const dist = CAMERA_DISTANCE * (1 - 0.55 * Math.abs(input.pitchFraction));
    camera.position.set(rx - dx * dist, pivotY - dy * dist, rz - dz * dist);
    camera.lookAt(rx, pivotY, rz);
  }

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
        `${input.locked ? 'mouse captured - Esc to release' : 'CLICK to capture mouse'}`;
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') {
    state = createMoveState(0, 0, 0);
    prevState = state;
    peakSpeed = 0;
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
