/** U-149 road construction view of the exact generated box union (bent by U-159, closed by U-160's rock, furnished by U-161). */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const level = await (await fetch('/artifacts/qalat-road-supports/level.json')).json() as { boxes: unknown[] };
const surface = await (await fetch('/artifacts/qalat-road-supports/surface.json')).json() as {
  levelHash: string; positions: number[]; normals: number[]; colours: number[]; indices: number[];
};
const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(level)));
const levelHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
if (surface.levelHash !== levelHash) throw new Error('Stale road render surface; run pnpm gen:qalat-road-supports');

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
  a3: { position: [-37, 9.55, 142], target: [-28, 9.55, 210], label: 'A3 · U-159 west leg toward A4 · actual standing eye height y9.55' },
  a5: { position: [26, 9.55, 232], target: [30, 9.55, 270], label: 'A5 · actual standing eye height y9.55' },
  capX: { position: [16, 9.55, 332], target: [32, 9.55, 350], label: 'CAP-X · forecourt road only · actual standing eye height y9.55' },
  a2: { position: [12, 9.55, 128], target: [-37, 9.55, 142], label: 'A2 · U-160 A3 inside corner closes the toll fight · standing eye y9.55' },
  a6: { position: [30, 9.55, 270], target: [-18, 9.55, 302], label: 'A6 · U-160 A7 inside corner closes the frontage fight · standing eye y9.55' },
  topDown: { position: [34, 500, 214.99], target: [34, 8, 215], label: 'Top-down · north up; 3D shows spec +x (east) on the left, mirrored from plan.svg · road, rock and unchanged insertion' },
  overview: { position: [-230, 350, -110], target: [34, 8, 215], label: 'Free overview · road, U-160 rock and unchanged natural insertion' },
  probe: { position: [38, 11.2, 91], target: [32, 9.2, 101], label: 'CAP-A · standing capsule probe · unfinished soldier presentation', probe: true },
  toll: { position: [-4, 9.55, 118], target: [12, 9.55, 128], label: 'Toll office interior · open 4 m east door' },
  mg: { position: [-23, 9.55, 222.8], target: [-28, 9.55, 180], label: 'AF1 MG nest · A-C06 at the head of the west leg' },
  depot: { position: [-35, 9.55, 199], target: [-38.5, 9.55, 200.4], label: 'West-leg depot frontage · closed loading recesses' },
  v2: { position: [88, 31.55, 210], target: [-22, 9.15, 222], label: 'V2 bay standing eye (unbuilt ridge) · visible MG breastwork; original feet fan kept 0.3 m above rock' },
  ingress: { position: [16, 9.55, 332], target: [70, 9.55, 336], label: 'CAP-X · y8 service road; bridge reserved for U-140' },
  pool: { position: [96, 9.55, 444], target: [114, 9.55, 432], label: 'X0 · motor pool canopy and screened retaining dogleg' },
  turn: { position: [114, 9.55, 432], target: [96, 9.55, 444], label: 'X1 · screened return into motor pool' },
  bridge: { position: [70, 9.55, 336], target: [84, 9.55, 338], label: 'y8 service road below exact reserved bridge void' },
  v3: { position: [66, 27.55, 286], target: [54, 11.2, 334], label: 'V3 eye probe · X5 silhouette opening; shelf unbuilt' },
  returnCourt: { position: [44, 9.55, 58], target: [32, 9.55, 98], label: 'CAP-RETURN · court edge toward tank stop; store entrance beside retreat' },
  storeDoor: { position: [40, 9.55, 58], target: [50, 9.55, 58], label: 'D0 court toward store · 4 m connector and west door · y8 floor / y12 ceiling' },
  storeHolding: { position: [50, 9.55, 58], target: [44, 9.55, 58], label: 'D0 holding socket toward west exit · north/east stone walls screen X-stop · ordinary blast attenuation' },
  rocket01: { position: [42, 9.55, 103.4], target: [32, 10.8, 98], label: 'A-C01 · verified swept rocket toward X-stop' },
  rocket02: { position: [-6, 9.55, 121], target: [32, 10.8, 98], label: 'A-C02 · verified rocket through toll-office doorway toward X-stop' },
  rocket07: { position: [-3, 9.55, 214], target: [26, 10.8, 232], label: 'A-C07 · verified swept rocket toward A5' },
  rocket08: { position: [13, 9.55, 223], target: [26, 10.8, 232], label: 'A-C08 · verified swept rocket toward A5' },
  rocket11: { position: [2, 9.55, 330], target: [54, 10.8, 334], label: 'A-C11 · verified swept rockets toward X5 and A8' },
  rocket12: { position: [34.16, 9.55, 336.7], target: [54, 10.8, 334], label: 'A-C12 · verified swept rockets toward X5 and A8' },
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
