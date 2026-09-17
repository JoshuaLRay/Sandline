/**
 * Client bootstrap (T-0.06).
 *
 * Renders the shared simulation. The renderer is a VIEW — it owns no game
 * state, steps no physics and makes no gameplay decisions (ADR-004). Here it
 * runs the simulation locally just to prove the same `shared` code that runs on
 * the Node server also runs in a browser; in M1 this state arrives from the
 * server instead (T-1.13).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Clock, Simulation, TICK_SECONDS } from '@sandline/shared';

const stats = document.getElementById('stats') as HTMLElement;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1408);
scene.fog = new THREE.Fog(0x1a1408, 30, 90);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 500);
camera.position.set(12, 9, 14);

// T-0.06 asks for an orbit camera. It is also the only way to inspect the
// simulation before there is any player input (that arrives with T-1.11).
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2 - 0.05; // don't let the camera go underground
controls.minDistance = 4;
controls.maxDistance = 60;
controls.update();

// ADR-013: one cascaded shadow-mapped sun, no realtime GI. Baked sun and dust
// haze IS the target look, so the cheap option and the correct one coincide.
const sun = new THREE.DirectionalLight(0xffe9c4, 2.6);
sun.position.set(18, 26, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun, new THREE.HemisphereLight(0xa9c0ff, 0x6b5a3a, 0.7));

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.MeshStandardMaterial({ color: 0x9a8156, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
scene.add(new THREE.GridHelper(120, 60, 0x6b5a3a, 0x4a3f2a));

const sim = await Simulation.create();
const meshes = new Map<number, THREE.Mesh>();
const actorGeo = new THREE.CapsuleGeometry(0.35, 1.2, 4, 12);

// Six slots, always (ADR-001). Here they are all bots.
for (let slot = 0; slot < 6; slot++) {
  const eid = sim.spawnActor({ x: slot * 1.5 - 3.75, y: 3 + slot * 0.4, z: 0 });
  const mesh = new THREE.Mesh(
    actorGeo,
    new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.09 + slot * 0.02, 0.45, 0.55) }),
  );
  mesh.castShadow = true;
  scene.add(mesh);
  meshes.set(eid, mesh);
}

const clock = new Clock();
let last = performance.now();
let frames = 0;
let fpsAt = last;
let fps = 0;

function frame(): void {
  const now = performance.now();
  const steps = clock.advance((now - last) / 1000);
  last = now;
  for (let i = 0; i < steps; i++) sim.step();

  let i = 0;
  for (const e of sim.snapshot().entities) {
    const mesh = [...meshes.values()][i++];
    if (mesh) mesh.position.set(e.x, e.y, e.z);
  }

  frames++;
  if (now - fpsAt >= 500) {
    fps = Math.round((frames * 1000) / (now - fpsAt));
    frames = 0;
    fpsAt = now;
    stats.textContent =
      `tick ${clock.tick}  ${fps} fps  ${meshes.size} actors\n` +
      `isolated: ${crossOriginIsolated}  step ${(TICK_SECONDS * 1000).toFixed(1)}ms`;
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
