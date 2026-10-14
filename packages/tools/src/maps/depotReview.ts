/** U-170: review the actual enclosed basement inside the complete surface. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

type Room = { id: string; x: number; z: number; w: number; d: number; ceiling: number };
type View = { name: string; position: number[]; target: number[]; label: string; ceilingY: number };
const root = '/artifacts/qalat-depot/';
const [level, surface, construction] = await Promise.all([
  fetch(`${root}level.json`).then((r) => r.json()) as Promise<{ boxes: unknown[]; floor: { halfWidth: number; halfDepth: number } }>,
  fetch(`${root}surface.json`).then((r) => r.json()) as Promise<{
    levelHash: string; positions: number[]; normals: number[]; colours: number[]; indices: number[];
  }>,
  fetch(`${root}construction.json`).then((r) => r.json()) as Promise<{ levelHash: string; rooms: Room[] }>,
]);
const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(level)));
const levelHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
if (surface.levelHash !== levelHash || construction.levelHash !== levelHash)
  throw new Error('Stale depot construction/render surface; run pnpm gen:qalat-depot');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#222820');
scene.add(new THREE.HemisphereLight('#e5eff7', '#82715b', 2), new THREE.AmbientLight('#f0e6d3', 1.2));
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, .05, 900);
const controls = new OrbitControls(camera, renderer.domElement);
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute(surface.positions, 3));
geometry.setAttribute('normal', new THREE.Float32BufferAttribute(surface.normals, 3));
geometry.setAttribute('color', new THREE.Float32BufferAttribute(surface.colours, 3));
geometry.setIndex(surface.indices);
// Ordinary front faces retain the generated downward roof faces. No clipping,
// hidden roofs or cutaway geometry is used for an underground capture.
const full = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
scene.add(full);
// The world/nav backing plane is implicit in level data and absent from boxes.
const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * level.floor.halfWidth, 2 * level.floor.halfDepth),
  new THREE.MeshLambertMaterial({ color: new THREE.Color().setRGB(.32, .34, .27),
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
floor.rotation.x = -Math.PI / 2; scene.add(floor);

// Independent §7.2 outgoing centreline vertices, including B9's closed future
// stair interface. Intersect each ray with its room's inside wall face.
const onward: Record<string, [number, number]> = {
  B1: [-20, 96], B2: [-36, 136], B3: [-36, 188], B4: [8, 216], B5: [8, 250],
  B6: [30, 298], B7: [-14, 330], B8: [-8, 362], B9: [-8, 376],
};
const views: View[] = construction.rooms.map((r) => {
  const goal = onward[r.id];
  if (!goal) throw new Error(`No approved depot review direction for ${r.id}`);
  const dx = goal[0] - r.x, dz = goal[1] - r.z;
  const t = Math.min(dx ? r.w / 2 / Math.abs(dx) : Infinity, dz ? r.d / 2 / Math.abs(dz) : Infinity);
  return { name: r.id.toLowerCase(), position: [r.x, 1.55, r.z],
    target: [r.x + t * dx, 1.55, r.z + t * dz], ceilingY: r.ceiling,
    label: `${r.id} · floor 0 / ceiling ${r.ceiling} m · standing eye toward ${r.id === 'B9' ? 'closed U171 stair interface' : 'onward doorway'}` };
});
const vault = construction.rooms.find((r) => r.id === 'B6');
if (!vault || construction.rooms.length !== 9) throw new Error('Depot review requires every B1–B9 room');
views.push({ name: 'b6-ceiling', position: [vault.x, 1.55, vault.z], target: [vault.x, vault.ceiling, vault.z + .01],
  ceilingY: vault.ceiling, label: 'B6 · standing eye looking up at the solid y5.5 ceiling beneath the y8 road' });

function view(name: string) {
  const v = views.find((item) => item.name === name);
  if (!v) throw new Error(`Unknown depot capture ${name}`);
  camera.position.fromArray(v.position); controls.target.fromArray(v.target); controls.update();
  document.querySelector<HTMLParagraphElement>('#view-label')!.textContent = v.label;
  renderer.render(scene, camera);
  const hit = new THREE.Raycaster(camera.position, new THREE.Vector3(0, 1, 0)).intersectObject(full)[0];
  if (!hit || Math.abs(hit.point.y - v.ceilingY) > .0001)
    throw new Error(`${name}: rendered underside does not match ceiling ${v.ceilingY}`);
  return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    boxCount: level.boxes.length, levelHash, renderedCeilingY: hit.point.y };
}
for (const v of views) {
  const button = document.createElement('button'); button.textContent = v.name.toUpperCase();
  button.onclick = () => view(v.name); document.querySelector('#views')!.append(button);
}
(globalThis as unknown as { __depotReview: { views: View[]; view: typeof view } }).__depotReview = { views, view };
view('b1');
controls.addEventListener('change', () => renderer.render(scene, camera));
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); renderer.render(scene, camera);
});
document.body.dataset['ready'] = 'true';
