/** Exact-scene road captures including U-162's first-X5 production capsule probes and U-163's ridge shelf. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { blockedAt, loadLevel, supportUnder } from '@sandline/shared';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { roadSupportManifest } from './maps/qalatRoadSupports.ts';

const manifest = roadSupportManifest();
const views = [
  { name: 'cap-d', position: [28, 9.55, 58], target: [32, 9.55, 72], label: 'Court approach · legal U-138 anchor; canonical CAP-D lies inside accepted reveal-toe rock', probe: false },
  { name: 'cap-a', position: [32, 9.55, 100], target: [12, 9.55, 128], label: 'CAP-A · actual standing eye height y9.55', probe: false },
  { name: 'a3-west-leg', position: [-37, 9.55, 142], target: [-28, 9.55, 210], label: 'A3 · U-159 west leg toward A4 · actual standing eye height y9.55', probe: false },
  { name: 'a5', position: [26, 9.55, 232], target: [30, 9.55, 270], label: 'A5 · actual standing eye height y9.55', probe: false },
  { name: 'cap-x-forecourt-road', position: [16, 9.55, 332], target: [32, 9.55, 350], label: 'CAP-X · forecourt road only · actual standing eye height y9.55', probe: false },
  { name: 'a2-toward-a3', position: [12, 9.55, 128], target: [-37, 9.55, 142], label: 'A2 · U-160 A3 inside corner closes the toll fight · standing eye y9.55', probe: false },
  { name: 'a6-toward-a7', position: [30, 9.55, 270], target: [-18, 9.55, 302], label: 'A6 · U-160 A7 inside corner closes the frontage fight · standing eye y9.55', probe: false },
  { name: 'top-down', position: [34, 500, 214.99], target: [34, 8, 215], label: 'Top-down · north up; 3D shows spec +x (east) on the left, mirrored from plan.svg · road, rock and unchanged insertion', probe: false },
  { name: 'overview', position: [-230, 350, -110], target: [34, 8, 215], label: 'Free overview · road, U-160 rock and unchanged natural insertion', probe: false },
  { name: 'cap-a-standing-probe', position: [38, 11.2, 91], target: [32, 9.2, 101], label: 'CAP-A · standing capsule probe · unfinished soldier presentation', probe: true },
  { name: 'v2-eye-to-mg-nest', position: [88, 31.55, 210], target: [-22, 9.15, 222], label: 'V2 bay standing eye · visible MG breastwork; feet fan kept 0.3 m above rock · permanent solids, temporary bay cap hidden until U-141', probe: false, permanent: true },
  { name: 'toll-office', position: [-4, 9.55, 118], target: [12, 9.55, 128], label: 'Toll office interior · open 4 m east door, closed north wall · standing eye y9.55', probe: false },
  { name: 'frontage-mg', position: [-23, 9.55, 222.8], target: [-28, 9.55, 180], label: 'AF1 MG nest · A-C06 at the head of the west leg · standing eye y9.55', probe: false },
  { name: 'depot-frontage', position: [-35, 9.55, 199], target: [-38.5, 9.55, 200.4], label: 'West-leg depot frontage · closed loading recesses · standing eye y9.55', probe: false },
  { name: 'cap-x-ingress', position: [16, 9.55, 332], target: [70, 9.55, 336], label: 'CAP-X · y8 service road under reserved bridge; bridge remains U-140', probe: false },
  { name: 'x0-motor-pool', position: [96, 9.55, 444], target: [114, 9.55, 432], label: 'X0 · exact motor pool, y14 rock canopy and offset six-metre returns · standing eye y9.55', probe: false },
  { name: 'x1-retaining-turn', position: [114, 9.55, 432], target: [96, 9.55, 444], label: 'X1 · screened return through the retaining dogleg · standing eye y9.55', probe: false },
  { name: 'x-bridge-reservation', position: [70, 9.55, 336], target: [84, 9.55, 338], label: 'Service road y8 · exact x66..74/z330..342 bridge void, underside y14 reserved; deck unbuilt', probe: false },
  { name: 'v3-x5-silhouette', position: [66, 27.55, 286], target: [54, 11.2, 334], label: 'V3 eye probe · X5 turret-height silhouette opening; X0 remains hidden · permanent solids, temporary bay cap hidden until U-141', probe: false, permanent: true },
  { name: 'cap-return', position: [44, 9.55, 58], target: [32, 9.55, 98], label: 'CAP-RETURN · court edge and tank stop · store entrance beside the retreat · standing eye y9.55', probe: false },
  { name: 'weigh-station-door', position: [40, 9.55, 58], target: [50, 9.55, 58], label: 'D0 court toward store · 4 m connector and west door · y8 floor / y12 ceiling · standing eye y9.55', probe: false },
  { name: 'weigh-station-holding', position: [50, 9.55, 58], target: [44, 9.55, 58], label: 'D0 holding socket toward west exit · north/east stone walls screen X-stop · ordinary blast attenuation · standing eye y9.55', probe: false },
  { name: 'rocket-ac01', position: [42, 9.55, 103.4], target: [32, 10.8, 98], label: 'A-C01 southern firing choice · real swept rocket reaches X-stop · standing eye y9.55', probe: false },
  { name: 'rocket-ac02', position: [-6, 9.55, 121], target: [32, 10.8, 98], label: 'A-C02 southern choice beside truck in toll office · rocket clears doorway and fin to X-stop · standing eye y9.55', probe: false },
  { name: 'rocket-ac07', position: [-3, 9.55, 214], target: [26, 10.8, 232], label: 'A-C07 switchback choice · real swept rocket reaches A5 · standing eye y9.55', probe: false },
  { name: 'rocket-ac08', position: [13, 9.55, 223], target: [26, 10.8, 232], label: 'A-C08 switchback choice · real swept rocket reaches A5 · standing eye y9.55', probe: false },
  { name: 'rocket-ac11', position: [2, 9.55, 330], target: [54, 10.8, 334], label: 'A-C11 forecourt choice · real swept rocket reaches X5 and A8 · standing eye y9.55', probe: false },
  { name: 'rocket-ac12', position: [34.16, 9.55, 336.7], target: [54, 10.8, 334], label: 'A-C12 forecourt choice · real swept rocket reaches X5 and A8 · standing eye y9.55', probe: false },
  ...[
    { name: 'ac11', position: [2, 9.55, 330] },
    { name: 'ac12', position: [34.16, 9.55, 336.7] },
    { name: 'v3', position: [66, 27.55, 286] },
  ].flatMap((eye) => [
    // U-163: permanent solids only, as in the screening proofs; temporary ridge caps hidden.
    { name: `${eye.name}-x4-hidden`, position: eye.position, target: [84, 9.55, 338],
      label: `${eye.name} · X4 production hull/turret probe hidden by permanent built solids (temporary ridge caps hidden)`, probe: false,
      tank: { x: 84, y: 8, z: 338, yaw: 0 }, expectedTankVisible: false, permanent: true },
    { name: `${eye.name}-x5-visible`, position: eye.position, target: [54, 9.55, 334],
      label: `${eye.name} · X5 production hull/turret probe visible at the western mouth (temporary ridge caps hidden; U-141 opens V3)`, probe: false,
      tank: { x: 54, y: 8, z: 334, yaw: 0 }, expectedTankVisible: true, permanent: true },
  ]),
  // U-163: standing eyes at each ridge node toward the next, and a free overview.
  ...[
    { name: 'ridge-r0-mouth', feet: [46, 8, 65.9], target: [78, 15.55, 96], label: 'D0→R0 · the ridge stair mouth beside the court and its first flights' },
    { name: 'ridge-r1-landing', feet: [78, 14, 96], target: [64, 21.55, 128], label: 'R1 landing y14 · climb to the R2 saddle; hut site rock until U-165' },
    { name: 'ridge-r2-saddle', feet: [64, 20, 128], target: [80, 27.55, 168], label: 'R2 lower saddle y20 · climb behind the shelf edge; V1 bay front capped for U-141' },
    { name: 'ridge-r3-shelf', feet: [80, 26, 168], target: [94, 31.55, 210], label: 'R3 combat shelf y26 · final climb to the Eagle shelf' },
    { name: 'ridge-r4-eagle', feet: [94, 30, 210], target: [86, 31.55, 248], label: 'R4 Eagle shelf y30 · level saddle to R5; V2 bay front capped for U-141' },
    { name: 'ridge-r5-saddle', feet: [86, 30, 248], target: [72, 27.55, 286], label: 'R5 saddle y30 · descent to the R6 survey post' },
    { name: 'ridge-r6-survey', feet: [72, 26, 286], target: [70, 21.55, 322], label: 'R6 y26 · descent to R7; V3 bay front capped for U-141' },
  ].map((v) => ({ name: v.name, position: [v.feet[0]!, v.feet[1]! + 1.55, v.feet[2]!], target: v.target,
    label: `${v.label} · standing eye`, probe: false, feetY: v.feet[1]! })),
  { name: 'ridge-r7-mouth', position: [98, 56, 300], target: [70, 16, 326], label: 'Free view · R7 landing y20 over the X4 apron; hanging caps close the bridge mouth until U-164', probe: false },
  { name: 'ridge-overview', position: [190, 150, 110], target: [76, 20, 200], label: 'Free overview · U-163 R0–R7 ridge shelf, barrier rock and temporary caps', probe: false },
];
const output = new URL('../../../artifacts/qalat-road-supports/', import.meta.url);
const world = loadLevel(JSON.parse(await readFile(new URL('level.json', output), 'utf8')));
// Eye-height evidence must represent a soldier who can actually stand there.
// Keep canonical camera exceptions explicit rather than moving accepted rocks.
for (const v of views.filter((v) => v.position[1] === 9.55 || 'feetY' in v)) {
  const [x, , z] = v.position, feetY = 'feetY' in v ? v.feetY : 8;
  if (blockedAt(x!, z!, .35, feetY, 0, 1.8, world.boxes)) throw new Error(`${v.name}: standing-eye anchor is inside collision geometry`);
  if (supportUnder(x!, z!, .35, feetY + .05, world.boxes, 0) !== feetY) throw new Error(`${v.name}: standing-eye anchor is unsupported at intended feet y${feetY}`);
}
const server = await createServer({ root: new URL('../../../', import.meta.url).pathname,
  configFile: false, server: { host: '127.0.0.1', port: 4175, strictPort: true } });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:4175/packages/tools/src/maps/road-support-review.html');
  try { await page.waitForFunction("document.body.dataset.ready === 'true'", undefined, { timeout: 60_000 }); }
  catch (error) { throw new Error(`Road support viewer did not start: ${errors.join('; ') || String(error)}`); }
  await mkdir(output, { recursive: true });
  const measurements = [];
  for (const v of views) {
    const stats = await page.evaluate((v) => (globalThis as unknown as {
      __roadSupportReview: (v: { position: number[]; target: number[]; label: string; probe: boolean;
        tank?: { x: number; y: number; z: number; yaw: number }; permanent?: boolean }) => {
        calls: number; triangles: number; boxCount: number; levelHash: string; tankPixels?: number;
      };
    }).__roadSupportReview(v), v);
    if (stats.calls >= 300 || stats.levelHash !== manifest.levelHash) throw new Error(`${v.name}: stale geometry or draw budget overrun`);
    if ('expectedTankVisible' in v && (v.expectedTankVisible ? (stats.tankPixels ?? 0) < 10 : stats.tankPixels !== 0))
      throw new Error(`${v.name}: unexpected hull/turret visibility (${stats.tankPixels} changed pixels)`);
    await page.screenshot({ path: new URL(`${v.name}.png`, output).pathname });
    measurements.push({ ...v, ...stats });
    console.log(`U-163 ${v.name}: ${stats.calls} draws, ${stats.triangles} triangles`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(new URL('captures.json', output), JSON.stringify({
    ...manifest, renderer: 'Three WebGL whitebox; exact generated boxes', antialias: true,
    viewport: [1440, 1000], views: measurements,
  }, null, 2) + '\n');
} finally { await browser?.close(); await server.close(); }
