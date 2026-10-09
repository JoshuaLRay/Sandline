/** U-149 support-only construction view of the exact generated box union. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const level = await (await fetch('/artifacts/qalat-road-supports/level.json')).json() as { boxes: unknown[] };
const surface = await (await fetch('/artifacts/qalat-road-supports/surface.json')).json() as {
  levelHash: string; positions: number[]; normals: number[]; colours: number[]; indices: number[];
};
const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(level)));
const levelHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
if (surface.levelHash !== levelHash) throw new Error('Stale road support render surface; run pnpm gen:qalat-road-supports');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#b7c6ca');
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, .05, 900);
const controls = new OrbitControls(camera, renderer.domElement);
scene.add(new THREE.HemisphereLight('#e5eff7', '#6b6151', 2));
const sun = new THREE.DirectionalLight('#ffedd1', 2.4);
sun.position.set(-60, 90, -50);
scene.add(sun);
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute(surface.positions, 3));
geometry.setAttribute('normal', new THREE.Float32BufferAttribute(surface.normals, 3));
geometry.setAttribute('color', new THREE.Float32BufferAttribute(surface.colours, 3));
geometry.setIndex(surface.indices);
scene.add(new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true })));

// A standing 1.8 m capsule measures human scale; this is an unfinished probe.
// It is hidden for eye-height evidence to avoid covering the CAP-A camera.
const probe = new THREE.Mesh(new THREE.CapsuleGeometry(.35, 1.1, 4, 8),
  new THREE.MeshLambertMaterial({ color: '#bb715a' }));
probe.position.set(32, 8.9, 100);
scene.add(probe);

type View = { position: number[]; target: number[]; label: string; probe?: boolean };
const views = {
  capD: { position: [28, 9.55, 58], target: [32, 9.55, 72], label: 'Court approach · legal U-138 anchor; canonical CAP-D lies inside accepted reveal-toe rock' },
  capA: { position: [32, 9.55, 100], target: [12, 9.55, 128], label: 'CAP-A · actual standing eye height y9.55' },
  a5: { position: [26, 9.55, 232], target: [30, 9.55, 270], label: 'A5 · actual standing eye height y9.55' },
  capX: { position: [16, 9.55, 332], target: [32, 9.55, 350], label: 'CAP-X · forecourt road only · actual standing eye height y9.55' },
  topDown: { position: [12, 370, 169.99], target: [12, 8, 170], label: 'Top-down · north up · support extents and unchanged natural insertion' },
  overview: { position: [-155, 280, -110], target: [12, 8, 145], label: 'Free overview · support extents and unchanged natural insertion' },
  probe: { position: [38, 11.2, 91], target: [32, 9.2, 101], label: 'CAP-A · standing capsule probe · unfinished soldier presentation', probe: true },
} satisfies Record<string, View>;

function view(v: View) {
  probe.visible = v.probe ?? false;
  document.querySelector<HTMLParagraphElement>('#view-label')!.textContent = v.label;
  camera.position.fromArray(v.position);
  controls.target.fromArray(v.target);
  controls.update();
  renderer.render(scene, camera);
  return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    boxCount: level.boxes.length, levelHash };
}
document.querySelectorAll<HTMLButtonElement>('button[data-view]').forEach((b) => {
  b.onclick = () => view(views[b.dataset['view'] as keyof typeof views]);
});
(globalThis as unknown as { __roadSupportReview: typeof view }).__roadSupportReview = view;
view(views.capD);
// Static captures need only a frame per change, avoiding a software-WebGL loop.
controls.addEventListener('change', () => renderer.render(scene, camera));
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.render(scene, camera);
});
document.body.dataset['ready'] = 'true';
