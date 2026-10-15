/** U-175: standing-eye review of the exact outpost and screened reserve shells. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

type View = { name: string; position: number[]; target: number[]; label: string; floorY: number; ceilingY: number | null };
const root = '/artifacts/qalat-outpost/';
const [level, surface, construction] = await Promise.all([
  fetch(`${root}level.json`).then((r) => r.json()) as Promise<{ boxes: unknown[]; floor: { halfWidth: number; halfDepth: number } }>,
  fetch(`${root}surface.json`).then((r) => r.json()) as Promise<{
    levelHash: string; renderHash: string; positions: number[]; normals: number[]; colours: number[]; indices: number[];
  }>,
  fetch(`${root}construction.json`).then((r) => r.json()) as Promise<{ levelHash: string; renderHash: string; decorations: unknown[] }>,
]);
const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(level)));
const levelHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
if (surface.levelHash !== levelHash || construction.levelHash !== levelHash)
  throw new Error('Stale outpost construction/render surface; run pnpm gen:qalat-outpost');
const renderDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([...level.boxes, ...construction.decorations])));
const renderHash = Array.from(new Uint8Array(renderDigest), (b) => b.toString(16).padStart(2, '0')).join('');
if (surface.renderHash !== renderHash || construction.renderHash !== renderHash)
  throw new Error('Stale outpost decoration/render surface; run pnpm gen:qalat-outpost');

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
// Keep every generated front face, including downward roof faces. These
// captures never clip roofs or substitute a cutaway scene for the collider.
const full = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
scene.add(full);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * level.floor.halfWidth, 2 * level.floor.halfDepth),
  new THREE.MeshLambertMaterial({ color: new THREE.Color().setRGB(.32, .34, .27),
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
floor.rotation.x = -Math.PI / 2; scene.add(floor);

// Independent anchors from the approved §8/§9 inner bounds and corridor
// spine. The south-gate view also reviews the open central court.
const views: View[] = [
  { name: 'south-gate-court', position: [32, 9.55, 359], target: [30, 9.55, 394], floorY: 8, ceilingY: null,
    label: 'South gate · standing inside the 8 m arch toward the central court and indirect prisoner approach' },
  { name: 'west-gate', position: [10, 9.55, 374], target: [26, 9.55, 378], floorY: 8, ceilingY: null,
    label: 'West gate · depot service entry beside the covered refuge' },
  { name: 'east-gate', position: [54, 9.55, 374], target: [34, 9.55, 382], floorY: 8, ceilingY: null,
    label: 'East gate · ridge entry across the court toward the west rooms' },
  { name: 'barracks', position: [20, 9.55, 365], target: [20, 9.55, 372], floorY: 8, ceilingY: 12,
    label: 'South barracks · solid south wall, covered interior and north court door' },
  { name: 'refuge', position: [16, 9.55, 380], target: [23, 9.55, 380], floorY: 8, ceilingY: 12.5,
    label: 'West refuge · solid roof and three closed faces around the escorted hold point' },
  { name: 'antechamber', position: [16, 9.55, 390], target: [16, 9.55, 402], floorY: 8, ceilingY: 12,
    label: 'Prison antechamber · fixed-open inner doorway gives the first cell view' },
  { name: 'cell', position: [16, 9.55, 402], target: [16, 10.6, 410], floorY: 8, ceilingY: 12,
    label: 'Prison records room · authored captive point under the solid roof and barred north window' },
  { name: 'radio', position: [48, 9.55, 400], target: [42, 9.55, 396], floorY: 8, ceilingY: 12,
    label: 'Radio room · west door and sill-height west window' },
  { name: 'reserve-bend', position: [20, 9.55, 426], target: [32, 9.55, 426], floorY: 8, ceilingY: 12,
    label: 'Reserve service bend · opaque return walls screen the short annex' },
  { name: 'reserve-room', position: [32, 9.55, 440], target: [32, 9.55, 432], floorY: 8, ceilingY: 12,
    label: 'North reserve room · covered holding room facing its south doorway' },
];

function view(name: string) {
  const v = views.find((item) => item.name === name);
  if (!v) throw new Error(`Unknown outpost capture ${name}`);
  camera.position.fromArray(v.position); controls.target.fromArray(v.target); controls.update();
  document.querySelector<HTMLParagraphElement>('#view-label')!.textContent = v.label;
  renderer.render(scene, camera);
  const hit = new THREE.Raycaster(camera.position, new THREE.Vector3(0, 1, 0)).intersectObject(full)[0];
  if (v.ceilingY !== null && (!hit || Math.abs(hit.point.y - v.ceilingY) > .0001))
    throw new Error(`${name}: rendered underside does not match ceiling ${v.ceilingY}`);
  return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    boxCount: level.boxes.length, levelHash, renderHash, renderedCeilingY: hit?.point.y ?? null };
}
for (const v of views) {
  const button = document.createElement('button'); button.textContent = v.name.toUpperCase();
  button.onclick = () => view(v.name); document.querySelector('#views')!.append(button);
}
(globalThis as unknown as { __outpostReview: { views: View[]; view: typeof view } }).__outpostReview = { views, view };
view('south-gate-court');
controls.addEventListener('change', () => renderer.render(scene, camera));
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); renderer.render(scene, camera);
});
document.body.dataset['ready'] = 'true';
