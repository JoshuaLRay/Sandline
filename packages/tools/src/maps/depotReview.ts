/** U-172: review exact furnished rooms, cues and covered endpoint stairs. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

type Room = { id: string; x: number; z: number; w: number; d: number; ceiling: number };
type View = { name: string; position: number[]; target: number[]; label: string; floorY: number; ceilingY: number | null; minClearance?: number };
const root = '/artifacts/qalat-depot/';
const [level, surface, construction] = await Promise.all([
  fetch(`${root}level.json`).then((r) => r.json()) as Promise<{ boxes: unknown[]; floor: { halfWidth: number; halfDepth: number } }>,
  fetch(`${root}surface.json`).then((r) => r.json()) as Promise<{
    levelHash: string; renderHash: string; positions: number[]; normals: number[]; colours: number[]; indices: number[];
  }>,
  fetch(`${root}construction.json`).then((r) => r.json()) as Promise<{ levelHash: string; renderHash: string; rooms: Room[]; decorations: unknown[] }>,
]);
const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(level)));
const levelHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
if (surface.levelHash !== levelHash || construction.levelHash !== levelHash)
  throw new Error('Stale depot construction/render surface; run pnpm gen:qalat-depot');
const renderDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([...level.boxes, ...construction.decorations])));
const renderHash = Array.from(new Uint8Array(renderDigest), (b) => b.toString(16).padStart(2, '0')).join('');
if (surface.renderHash !== renderHash || construction.renderHash !== renderHash)
  throw new Error('Stale depot decoration/render surface; run pnpm gen:qalat-depot');

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

// Independent §7.2 outgoing centreline vertices, including B9's covered exit
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
    target: [r.x + t * dx, 1.55, r.z + t * dz], floorY: 0, ceilingY: r.ceiling,
    label: `${r.id} · floor 0 / ceiling ${r.ceiling} m · standing eye toward ${r.id === 'B9' ? 'covered upward stair' : 'onward doorway'}` };
});
const vault = construction.rooms.find((r) => r.id === 'B6');
if (!vault || construction.rooms.length !== 9) throw new Error('Depot review requires every B1–B9 room');
views.push({ name: 'b6-ceiling', position: [vault.x, 1.55, vault.z], target: [vault.x, vault.ceiling, vault.z + .01],
  floorY: 0, ceilingY: vault.ceiling, label: 'B6 · standing eye looking up at the solid y5.5 ceiling beneath the y8 road' });

// Independent approved endpoint and rest anchors. Each flight has ten 0.40 m
// treads, a 2 m rest, then another ten treads. Keep the full roofs visible.
views.push(
  { name: 'b0-loading', position: [-2, 9.55, 68], target: [-2, 9.55, 76], floorY: 8,
    ceilingY: 12, label: 'B0 · loading vestibule at y8, covered descent ahead' },
  { name: 'b0-first-rest', position: [-2, 7.55, 81], target: [-2, 5.55, 85], floorY: 6,
    ceilingY: null, minClearance: 3.2, label: 'B0 first flight · 2 m rest at y6' },
  { name: 'b0-switchback', position: [3, 5.55, 86], target: [8, 5.55, 86], floorY: 4,
    ceilingY: null, minClearance: 3.2, label: 'B0 · broad 10 m switchback landing at y4' },
  { name: 'b0-second-rest', position: [8, 3.55, 91], target: [8, 1.55, 95], floorY: 2,
    ceilingY: null, minClearance: 3.2, label: 'B0 second flight · 2 m rest at y2 toward B1' },
  { name: 'b10-first-rest', position: [-8, 3.55, 381], target: [-8, 5.55, 385], floorY: 2,
    ceilingY: null, minClearance: 3.2, label: 'B10 first flight · 2 m rest at y2' },
  { name: 'b10-switchback', position: [-3, 5.55, 386], target: [2, 5.55, 386], floorY: 4,
    ceilingY: null, minClearance: 3.2, label: 'B10 · broad 10 m switchback landing at y4' },
  { name: 'b10-second-rest', position: [2, 7.55, 381], target: [2, 9.55, 377], floorY: 6,
    ceilingY: null, minClearance: 3.2, label: 'B10 second flight · 2 m rest at y6 toward west gate' },
  { name: 'b10-west-landing', position: [8, 9.55, 374], target: [2, 9.55, 376], floorY: 8,
    ceilingY: null, label: 'B10 · exact open 8×8 m west landing at (8,8,374)' },
);

// Furniture review anchors stay at standing eye on the actual y0 floor.
views.push(
  { name: 'b1-crate', position: [-2, 1.55, 96], target: [-6, .55, 98.4], floorY: 0,
    ceilingY: 3.6, label: 'B1 · full-size low crate at approved z98.4; centered west-door landing remains free' },
  { name: 'b1-pipe', position: [-2, 1.55, 96], target: [-2, 2.7, 90.07], floorY: 0,
    ceilingY: 3.6, label: 'B1 · blue service pipe on the closed wall; west landing stays clear' },
  { name: 'b3-cistern', position: [-36, 1.55, 147], target: [-36, 1.55, 166], floorY: 0,
    ceilingY: 5.5, label: 'B3 · dry channels, water stains, full-height piers and low cross-wall' },
  { name: 'b4-engines', position: [-18, 1.55, 190], target: [-18, 1.55, 207], floorY: 0,
    ceilingY: 4.5, label: 'B4 · inert diesel blocks flank the clear central aisle' },
  { name: 'b5-regroup', position: [9, 1.55, 228], target: [4, 1.55, 234], floorY: 0,
    ceilingY: 4, label: 'B5 · eight-metre regroup pocket beside the low bench and sealed service doors' },
  { name: 'b7-workbench', position: [-14, 1.55, 306], target: [-22, 1.55, 312], floorY: 0,
    ceilingY: 4, label: 'B7 · west workbench and two wall racks; open central regroup floor' },
  { name: 'b8-shelves', position: [-14, 1.55, 336], target: [-14, 1.55, 356], floorY: 0,
    ceilingY: 4, label: 'B8 · sixteen-metre shelves frame the onward lane and doorway' },
  { name: 'b9-arrow', position: [-8, 1.55, 370], target: [-2, 1.8, 371], floorY: 0,
    ceilingY: 3.6, label: 'B9 · painted upward arrow beside the covered exit stair' },
);

function view(name: string) {
  const v = views.find((item) => item.name === name);
  if (!v) throw new Error(`Unknown depot capture ${name}`);
  camera.position.fromArray(v.position); controls.target.fromArray(v.target); controls.update();
  document.querySelector<HTMLParagraphElement>('#view-label')!.textContent = v.label;
  renderer.render(scene, camera);
  const hit = new THREE.Raycaster(camera.position, new THREE.Vector3(0, 1, 0)).intersectObject(full)[0];
  if (v.ceilingY !== null && (!hit || Math.abs(hit.point.y - v.ceilingY) > .0001))
    throw new Error(`${name}: rendered underside does not match ceiling ${v.ceilingY}`);
  if (v.minClearance !== undefined && (!hit || hit.point.y - v.floorY < v.minClearance - .0001))
    throw new Error(`${name}: covered stair has less than ${v.minClearance} m rendered headroom`);
  return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    boxCount: level.boxes.length, levelHash, renderHash, renderedCeilingY: hit?.point.y ?? null };
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
