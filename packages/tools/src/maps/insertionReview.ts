/** A diagnostic renderer of the exact generated collision, not a campaign map. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const level = await (await fetch('/artifacts/qalat-insertion/level.json')).json() as {
  boxes: unknown[]; squadStarts: { x: number; y: number; z: number }[];
};
const surface = await (await fetch('/artifacts/qalat-insertion/surface.json')).json() as {
  levelHash: string; positions: number[]; normals: number[]; colours: number[]; indices: number[];
};
const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(level)));
const levelHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
if (surface.levelHash !== levelHash) throw new Error('Stale construction render surface; run pnpm gen:qalat-insertion');
document.body.dataset['stage'] = 'geometry-loaded';
console.log('Construction geometry loaded');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#b7c6ca');
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, .05, 600);
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
const rocks = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
scene.add(rocks);
// Six explicitly labelled placement probes; they do not claim finished soldiers.
const starts = new THREE.InstancedMesh(new THREE.CapsuleGeometry(.35, 1.1, 4, 8), new THREE.MeshLambertMaterial({ color: '#627367' }), 6);
for (const [i, p] of level.squadStarts.entries()) starts.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y + .9, p.z));
scene.add(starts);
document.body.dataset['stage'] = 'scene-built';
console.log('Construction scene built');

const views = {
  spawn: { position: [-2, 9.55, -6], target: [-12, 9.55, 18] },
  court: { position: [28, 9.55, 58], target: [40, 9.55, 68] },
  overview: { position: [-74, 126, -100], target: [0, 8, 25] },
};
type View = { position: number[]; target: number[] };
function view(v: View) {
  camera.position.fromArray(v.position); controls.target.fromArray(v.target); controls.update();
  renderer.render(scene, camera);
  return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, boxCount: level.boxes.length, levelHash };
}
document.querySelectorAll<HTMLButtonElement>('button[data-view]').forEach((b) => { b.onclick = () => view(views[b.dataset['view'] as keyof typeof views]); });
(globalThis as unknown as { __insertionReview: typeof view }).__insertionReview = view;
view(views.spawn);
console.log('Construction first frame rendered');
document.body.dataset['stage'] = 'first-frame';
// Static construction review needs one frame per camera change. An unbounded
// render loop can starve automation on software WebGL runners.
controls.addEventListener('change', () => renderer.render(scene, camera));
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
  renderer.render(scene, camera);
});
document.body.dataset['ready'] = 'true';
