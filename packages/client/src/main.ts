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
  DAMAGE,
  RANGE_TARGETS,
  fromRadians,
  shotDirections,
  sin,
  DEFAULT_MUZZLE_RIG,
  type MuzzleStance,
  eyePosition,
  muzzlePosition,
  toRadians,
  wireToTable,
} from '@sandline/shared';
import { LocalInput } from './input/LocalInput.ts';
import { DEFAULT_CAMERA_CONFIG } from './camera/cameraConfig.ts';
import { DEFAULT_LINK, LocalServer } from './net/LocalServer.ts';
import { NetClient } from './net/NetClient.ts';
import { solveArmLength } from './camera/followCamera.ts';
import { CombatQA, WEAPON_ORDER } from './weapons/CombatQA.ts';
import { createCameraPanel } from './ui/CameraPanel.ts';
import { createNetworkPanel } from './ui/NetworkPanel.ts';
import { createTuningPanel } from './ui/TuningPanel.ts';
import { createWeaponPanel } from './ui/WeaponPanel.ts';

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
/**
 * What a shot can stop on: what the aim ray converges against and what a
 * predicted tracer terminates on.
 *
 * ONLY WHAT THE SERVER CAN ACTUALLY HIT — the other players and the range
 * targets, plus the ground as a backstop. Decoration is deliberately absent,
 * and that boundary is the whole point.
 *
 * Getting this set wrong breaks aiming in two opposite ways, and this project
 * has now shipped both. Leave things OUT that the server can hit (the other
 * players were missing) and the aim ray finds nothing, falls back to a point
 * 250 m down the camera's line, and fires nearly parallel from an eye that sits
 * 0.85 m left and 0.3 m below the camera — every shot lands down and to the
 * left. Put things IN that the server cannot hit (the distance posts and the
 * scale figure were added) and the ray converges on decoration instead of on
 * the target: measured tracer lengths of 140, 92, 2.7, 140, 77 and 30 metres
 * across six consecutive shots while strafing, because the muzzle was sweeping
 * through a field of posts. The convergence distance then jumps around, so the
 * shot crosses the reticle's line at an arbitrary range — left of the reticle
 * nearer than the crossing, right of it beyond, which is exactly how it was
 * described.
 *
 * So the rule is not "everything solid". It is "exactly what the server
 * resolves hits against". Add a mesh here when, and only when, the server also
 * knows about it.
 */
const shootable: THREE.Object3D[] = [];

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
    // NOT shootable: decoration. The server has no world collision (T-1.12),
    // so a shot passes through a post exactly as the player does.
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
// Also decoration, and a 1.8 m one standing 3 m from spawn: the single worst
// thing for a shot to terminate on by accident.

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
/** How far the aim ray looks for something to converge on. */
const AIM_RANGE = 250;


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

/**
 * Remote characters, created on demand from replicated entities.
 *
 * These used to be five capsules parked at fixed positions for scale. They are
 * now the other five slots of the authoritative session (ADR-001: six, always),
 * arriving over the wire and rendered at the interpolation delay. If they stand
 * still it is because nothing is driving them — not because they are scenery.
 */
const remoteMeshes = new Map<number, THREE.Mesh>();
const remoteGeometry = new THREE.CapsuleGeometry(0.35, 1.1, 4, 12);
const remoteMaterial = new THREE.MeshStandardMaterial({ color: 0xb9a37a, roughness: 0.9 });

function remoteMesh(netId: number): THREE.Mesh {
  let mesh = remoteMeshes.get(netId);
  if (!mesh) {
    mesh = new THREE.Mesh(remoteGeometry, remoteMaterial);
    mesh.castShadow = true;
    mesh.name = `net ${netId}`;
    scene.add(mesh);
    remoteMeshes.set(netId, mesh);
    // Created on demand, so it has to join the list on demand too. Leaving
    // remote players out is what produced the down-and-left shots.
    shootable.push(mesh);
  }
  return mesh;
}

const combat = new CombatQA(scene, shootable);

/* -- Network --------------------------------------------------------------- */

const link = { ...DEFAULT_LINK };
// One config object, shared by reference with both the session and the
// predictor: the movement panel must move authority and prediction together.
const server = new LocalServer(link, config);
const net = new NetClient(server.transport, 'qa', config);
net.join();

/**
 * Draw the authoritative result of a shot. The muzzle is derived from the
 * shooter's own replicated position, so a remote player's tracer leaves their
 * barrel rather than the world origin.
 */
const shotOrigin = new THREE.Vector3();
const shotEnd = new THREE.Vector3();
net.onShot = (shot) => {
  shotEnd.set(shot.x, shot.y, shot.z);
  if (shot.shooterNetId === net.netId) {
    // Our own shot: the tracer is already drawn, so this only lands the hit
    // marker and the damage number.
    shotOrigin.set(muzzle.x, muzzle.y, muzzle.z);
    combat.drawServerShot(shotOrigin, shotEnd, shot.targetNetId, shot.damage, clock.tick * TICK_SECONDS);
    return;
  }
  /**
   * Someone else's shot. There is nothing to predict — we never saw their
   * trigger — so this is the one case where a tracer legitimately arrives on
   * the server's schedule, drawn from their replicated position.
   */
  const mesh = remoteMeshes.get(shot.shooterNetId);
  if (mesh) shotOrigin.set(mesh.position.x, mesh.position.y - 0.9 + 1.05, mesh.position.z);
  else shotOrigin.set(shot.x, shot.y, shot.z);
  combat.drawTracer(shotOrigin, shotEnd, clock.tick * TICK_SECONDS);
  combat.drawServerShot(shotOrigin, shotEnd, shot.targetNetId, shot.damage, clock.tick * TICK_SECONDS);
};

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
  hudToggle.textContent = collapsed ? '+' : '\u2212';
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
hudToggle.textContent = '\u2212';
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
const cameraPanel = createCameraPanel(cam);
const networkPanel = createNetworkPanel({
  conditions: link,
  onChange: (c) => server.setConditions(c),
});
panels.append(networkPanel.root, movementPanel.root, weaponPanel.root, cameraPanel.root);
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
/** Which point the weapon is held at, from the camera the player is using. */
function stance(): MuzzleStance {
  if (!input.firstPerson) return 'third';
  return input.ads ? 'ads' : 'hip';
}
const aimRaycaster = new THREE.Raycaster();
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
const crosshair = document.getElementById('crosshair');
let last = performance.now();
let frames = 0;
let fpsAt = last;
let fps = 0;
let peakSpeed = 0;
let speed = 0;
/** The predicted state either side of the latest tick, for render interpolation. */
let simPrev: { x: number; y: number; z: number } | null = null;
let simCur: { x: number; y: number; z: number } | null = null;

/** Connection and prediction health, the numbers T-1.23 will graph. */
function netReadout(): string {
  const n = net.stats;
  if (!n.joined) return 'connecting...';
  const vitals =
    n.maxHealth === 0
      ? ''
      : n.health > 0
        ? `health ${Math.round(n.health)}/${Math.round(n.maxHealth)}\n`
        : `DOWN  respawning in ${Math.max(0, DAMAGE.respawnSeconds - n.downFor).toFixed(1)}s\n`;
  const rate = n.reconciles === 0 ? 0 : (n.corrections / n.reconciles) * 100;
  return (
    vitals +
    `net ${n.netId}  tick ${n.serverTick}  remotes ${n.remotes}\n` +
    `${link.latencyMs}ms  ${link.jitterMs}ms jitter  ${Math.round(link.lossRate * 100)}% loss\n` +
    `corrections ${rate.toFixed(1)}%  peak ${n.peakDivergence.toFixed(3)}m\n` +
    `snapshots ${n.snapshotsApplied}  missed ${n.missedBaselines}  in flight ${server.inFlight}`
  );
}

function frame(): void {
  const now = performance.now();
  const dt = (now - last) / 1000;
  const steps = clock.advance(dt);
  last = now;

  for (let i = 0; i < steps; i++) {
    const tickInput = input.sample();

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
    const afterStep = net.simulated;
    // Keep both ends of the tick so rendering can interpolate across it.
    simPrev = beforeStep;
    simCur = afterStep;
    if (beforeStep !== null && afterStep !== null) {
      speed = Math.hypot(afterStep.x - beforeStep.x, afterStep.z - beforeStep.z) / TICK_SECONDS;
      if (speed > peakSpeed) peakSpeed = speed;
    }

    server.step(now);

    const here = net.simulated;
    const tickYaw = wireToTable(input.yaw);
    rig.eyeHeight = cam.eyeHeight;
    const m = here
      ? muzzlePosition(here.x, here.y, here.z, sin(tickYaw), cos(tickYaw), stance(), rig)
      : { x: 0, y: cam.eyeHeight, z: 0 };
    muzzle.set(m.x, m.y, m.z);

    const shot = combat.tick(tickNumber, tickNumber * TICK_SECONDS, {
      origin: muzzle,
      yaw: aimYaw,
      pitch: aimPitch,
      firing: input.firing,
      triggerEdge: input.consumeTriggerEdge(),
      ads: input.ads,
    });
    // The local machine decides WHEN the trigger pulled; the server decides
    // what that shot hit. Both run the same cadence, so a shot the client
    // allows is normally one the server allows too.
    if (shot !== null) {
      // Sent at table resolution, so the server traces the exact angles this
      // client computed and the predicted tracer shares them without rounding.
      net.fire(tickNumber, aimYaw, aimPitch, combat.weaponIndex, input.ads);

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
  }

  server.pump(now);
  net.advanceClock(dt * 1000);

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
  const smoothed = net.renderPosition(dt * 1000);
  const sim = net.simulated;
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

  // Remote characters at the interpolation delay (T-1.16).
  for (const [netId, sample] of net.remotes()) {
    const mesh = remoteMesh(netId);
    mesh.position.set(sample.x, sample.y + 0.9, sample.z);
    const remoteYaw = wireToTable(sample.yaw);
    mesh.rotation.y = Math.atan2(sin(remoteYaw), cos(remoteYaw));
  }

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

  const pivotY = ry + cam.eyeHeight;
  // View direction: horizontal component shrinks as pitch steepens.
  const dx = fx * cosP;
  const dy = sinP;
  const dz = fz * cosP;

  const ads = input.ads;

  // Field of view IS the aim cue. Eased rather than snapped so it reads as
  // shouldering a weapon instead of a hard cut.
  const targetFov = ads ? cam.adsFov : cam.baseFov;
  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, 12 * dt);
    camera.updateProjectionMatrix();
  }
  if (crosshair) crosshair.classList.toggle('ads', ads);
  // Every value in the camera panel describes where the arm puts the camera
  // relative to a character you cannot see in first person.
  cameraPanel.setVisible(!input.firstPerson);

  /**
   * Orient from the angles directly rather than with `lookAt`.
   *
   * `lookAt` builds a basis by crossing the view direction with world up, which
   * degenerates as the view approaches vertical — and the pitch limit is now 89
   * degrees, so the view gets there. Setting a YXZ Euler is exact at every
   * pitch: yaw is the Y term, pitch the X term, and roll is pinned at zero
   * instead of being solved for. The +PI turns the camera's default -Z gaze
   * onto the +Z forward this project uses.
   */
  camera.rotation.set(toRadians(pitchAngle), toRadians(yawAngle) + Math.PI, 0, 'YXZ');

  if (input.firstPerson) {
    camera.position.set(rx, pivotY, rz);
    player.visible = false;
  } else {
    player.visible = true;
    /**
     * Right is cross(forward, up), which for a Y-up right-handed system and a
     * yaw-only forward reduces to (-fz, 0, fx). Same handedness the strafe fix
     * established - getting it backwards here would put the camera over the
     * wrong shoulder and mirror the aim offset.
     */
    const shoulder = ads ? cam.shoulderRightAds : cam.shoulderRight;
    const focusX = rx - fz * shoulder;
    const focusY = pivotY + cam.shoulderUp;
    const focusZ = rz + fx * shoulder;

    let dist =
      cam.distance *
      (ads ? cam.adsDistanceScale : 1) *
      (1 - cam.pitchShorten * Math.abs(input.pitchFraction));

    /**
     * Floor clamp.
     *
     * Looking up swings the arm DOWN and behind, which used to push the camera
     * through the ground plane. Rather than stopping at the floor and letting
     * the view stay buried, shorten the arm to exactly the length that lands
     * the camera on cam.minCameraY: the camera then draws in toward the
     * character's feet as you keep looking up, which is what the eye expects.
     * The real spring arm with scene collision is still E-2.1 in M2.
     */
    dist = solveArmLength(dist, focusY, dy, cam);

    camera.position.set(focusX - dx * dist, focusY - dy * dist, focusZ - dz * dist);
  }

  /**
   * Converge the shot on what the reticle covers.
   *
   * Measured from the EYE, which is where the server traces from — not from the
   * visual muzzle. Aiming along the camera angles would land shots beside the
   * crosshair in third person, where the camera is off the shoulder; aiming
   * from the visual muzzle would make the shot depend on which view you are
   * using. Find what the reticle is actually over, then aim the eye at THAT.
   */
  aimDirection.set(dx, dy, dz).normalize();
  aimRaycaster.set(camera.position, aimDirection);
  aimRaycaster.far = AIM_RANGE;
  const [reticleHit] = aimRaycaster.intersectObjects(shootable, false);
  if (reticleHit) {
    aimPoint.copy(reticleHit.point);
  } else {
    aimPoint.copy(camera.position).addScaledVector(aimDirection, AIM_RANGE);
  }
  /**
   * Converge from the MUZZLE, not the character's centre: the muzzle sits at
   * the right hip, so a direction measured from the centre line would put the
   * shot a hip's width off the reticle at close range.
   */
  const eye = eyePosition(rx, ry, rz);
  aimDirection.set(aimPoint.x - eye.x, aimPoint.y - eye.y, aimPoint.z - eye.z).normalize();
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
        `${net.simulated?.grounded ?? true ? 'grounded' : `airborne  y ${ry.toFixed(2)}`}\n` +
        `tick ${clock.tick}   ${fps} fps${clock.dropped ? `   dropped ${clock.dropped}` : ''}\n` +
        `${input.firstPerson ? 'first person' : 'third person'}  (V to swap)\n` +
        `${input.locked ? 'mouse captured - Esc to release' : 'CLICK to capture mouse'}\n` +
        `\n${combat.readout(clock.tick * TICK_SECONDS, input.ads)}\n` +
        `\n${netReadout()}`;
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
  // T resets the local readouts only. Position is authoritative now, so
  // teleporting to spawn needs a server-side respawn — that is T-1.19.
  if (e.code === 'KeyT') {
    peakSpeed = 0;
    combat.reset();
  }
  // 1-4 pick a weapon. Switching is instant and reloads: a range, not a match.
  const slot = Number.parseInt(e.code.replace('Digit', ''), 10);
  if (e.code.startsWith('Digit') && slot >= 1 && slot <= WEAPON_ORDER.length) {
    combat.selectWeapon(slot - 1);
  }
  if (e.code === 'KeyH') toggleHud();
  // First/third person. A proper camera with collision is E-2.1 in M2; this is
  // enough to judge whether the movement reads differently from each view.
  if (e.code === 'KeyV') input.firstPerson = !input.firstPerson;
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
