/** Exact-scene road captures including U-165 ridge furniture, the escorted R5 hold and U-168's two road↔ridge stairs. */
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
  { name: 'v2-eye-to-mg-nest', position: [88, 31.55, 210], target: [-22, 9.15, 222], label: 'V2 bay standing eye · visible MG breastwork under the built lip and canopy; feet fan kept 0.3 m above rock', probe: false },
  { name: 'toll-office', position: [-4, 9.55, 118], target: [12, 9.55, 128], label: 'Toll office interior · open 4 m east door, closed north wall · standing eye y9.55', probe: false },
  { name: 'frontage-mg', position: [-23, 9.55, 222.8], target: [-28, 9.55, 180], label: 'AF1 MG nest · A-C06 at the head of the west leg · standing eye y9.55', probe: false },
  { name: 'depot-frontage', position: [-35, 9.55, 199], target: [-38.5, 9.55, 200.4], label: 'West-leg depot frontage · closed loading recesses · standing eye y9.55', probe: false },
  { name: 'cap-x-ingress', position: [16, 9.55, 332], target: [70, 9.55, 336], label: 'CAP-X · production tank at (70,8,336) under occupied R7b bridge; ridge deck y16 / underside y14', probe: false, tank: { x: 70, y: 8, z: 336, yaw: 0 } },
  { name: 'x0-motor-pool', position: [96, 9.55, 444], target: [114, 9.55, 432], label: 'X0 · exact motor pool, y14 rock canopy and offset six-metre returns · standing eye y9.55', probe: false },
  { name: 'x1-retaining-turn', position: [114, 9.55, 432], target: [96, 9.55, 444], label: 'X1 · screened return through the retaining dogleg · standing eye y9.55', probe: false },
  { name: 'x-bridge-reservation', position: [70, 9.55, 336], target: [84, 9.55, 338], label: 'Service road y8 · built x66..74/z330..342 bridge overhead, flat deck y16 / underside y14', probe: false },
  { name: 'v3-x5-silhouette', position: [66, 27.55, 286], target: [54, 11.2, 334], label: 'V3 bay standing eye · X5 turret-height silhouette through the stepped lip opening; X0 remains hidden', probe: false },
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
    // U-167: the whole built scene now that the V3 bay is open.
    { name: `${eye.name}-x4-hidden`, position: eye.position, target: [84, 9.55, 338],
      label: `${eye.name} · X4 production hull/turret probe hidden by the built scene`, probe: false,
      tank: { x: 84, y: 8, z: 338, yaw: 0 }, expectedTankVisible: false },
    { name: `${eye.name}-x5-visible`, position: eye.position, target: [54, 9.55, 334],
      label: `${eye.name} · X5 production hull/turret probe visible at the western mouth in the built scene`, probe: false,
      tank: { x: 54, y: 8, z: 334, yaw: 0 }, expectedTankVisible: true },
  ]),
  // Standing eyes at each ridge node, followed by free views and underside proofs.
  ...[
    { name: 'ridge-r0-mouth', feet: [46, 8, 65.9], target: [78, 15.55, 96], label: 'D0→R0 · the ridge stair mouth beside the court and its first flights' },
    { name: 'ridge-r1-landing', feet: [78, 14, 96], target: [64, 21.55, 128], label: 'R1 landing y14 · climb to the R2 saddle beside the open shepherd hut' },
    { name: 'ridge-r2-saddle', feet: [64, 20, 128], target: [80, 27.55, 168], label: 'R2 lower saddle y20 · climb past the built V1 bay' },
    { name: 'ridge-r3-shelf', feet: [80, 26, 168], target: [94, 31.55, 210], label: 'R3 combat shelf y26 · final climb to the Eagle shelf' },
    { name: 'ridge-r4-eagle', feet: [94, 30, 210], target: [86, 31.55, 248], label: 'R4 Eagle shelf y30 · level saddle to R5 beside the built V2 bay' },
    { name: 'ridge-r5-saddle', feet: [86, 30, 248], target: [72, 27.55, 286], label: 'R5 saddle y30 · descent to the R6 survey post' },
    { name: 'ridge-r6-survey', feet: [72, 26, 286], target: [70, 21.55, 322], label: 'R6 y26 · descent to R7 beside the built V3 bay' },
    { name: 'ridge-r7-landing', feet: [70, 20, 321.5], target: [70, 17.55, 336], label: 'R7 landing y20 · eye 0.5 m south of named node for full-foot support; 0.30 m treads descend to bridge' },
    { name: 'ridge-r7b-deck', feet: [70, 16, 336], target: [70, 13.55, 350], label: 'R7b bridge deck y16 · full 8 m width between parapets; R8 descent beyond the flat deck' },
    { name: 'ridge-r8-landing', feet: [70, 12, 350], target: [56, 9.55, 370], label: 'R8 landing y12 · sheltered 8×4 m pad, final 20 risers to R9' },
    { name: 'ridge-r9-gate', feet: [56, 8, 370], target: [56, 9.55, 374], label: 'R9 y8 · east-gate approach capped until U-116' },
  ].map((v) => ({ name: v.name, position: [v.feet[0]!, v.feet[1]! + 1.55, v.feet[2]!], target: v.target,
    label: `${v.label} · standing eye`, probe: false, feetY: v.feet[1]! })),
  { name: 'ridge-r7-mouth', position: [98, 56, 300], target: [70, 16, 336], label: 'Free view · R7 landing, built R7b bridge and R8/R9 descent over the tank road', probe: false },
  { name: 'ridge-overview', position: [190, 150, 110], target: [76, 20, 230], label: 'Free overview · furnished R0–R9 ridge, V1–V3 bays, F3 and service bridge; east-gate cap remains', probe: false },
  { name: 'bridge-under-tank', position: [72, 9.55, 327], target: [70, 10.5, 336], label: 'Tank road standing eye · production hull/turret at (70,8,336) beneath the built bridge', probe: false, tank: { x: 70, y: 8, z: 336, yaw: 0 }, expectedTankVisible: true },
  { name: 'r8-underside', position: [77, 9.55, 349], target: [70, 11.4, 350], label: 'Tank road standing eye · R8 landing floor y12 / underside y11.4, 0.2 m above full turret envelope', probe: false },
  ...[
    { name: 'ridge-hut-interior', feet: [86, 14, 102], target: [89.5, 15, 102], label: 'Shepherd hut y14 · four sacks against east wall, open west face and no roof walkway' },
    { name: 'ridge-hut-spur', feet: [81, 14, 100], target: [87, 15.55, 102], label: 'R1 landing · 4 m flat spur to the shepherd hut west opening' },
    { name: 'ridge-survey-interior', feet: [82, 26, 286], target: [80, 29.3, 281], label: 'Broken survey post y26 · missing west wall and two beams above standing clearance' },
    { name: 'ridge-r3-cover', feet: [80, 26, 174], target: [84, 26.8, 170], label: 'R3 low rock · exact 4 m north-south cover beside the full-width route' },
    { name: 'ridge-r6-cover', feet: [72, 26, 288], target: [76, 26.8, 286], label: 'R6 low wall · exact 5 m north-south cover beside the full-width route' },
    { name: 'ridge-r5-hold', feet: [95.8, 30, 238], target: [94, 31.2, 238], label: 'R5 inland escorted hold · built high rock stops the shell and attenuates ordinary blast damage' },
    { name: 'ridge-r5-exposed', feet: [91, 30, 238], target: [94, 31.2, 238], label: 'R5 outside cover · ordinary tank blast danger remains when leaving the hold' },
    { name: 'ridge-r7-cover', feet: [70, 20, 321.5], target: [82, 21.5, 320], label: 'R7 high rock · exact 4 m north-south cover in its inland recess' },
  ].map((v) => ({ name: v.name, position: [v.feet[0]!, v.feet[1]! + 1.55, v.feet[2]!], target: v.target,
    label: `${v.label} · standing eye`, probe: false, feetY: v.feet[1]! })),
  ...[
    // U-167: each bay from its standing anchor toward a mandatory target, and from behind.
    { name: 'bay-v1-anchor', feet: [58, 20, 128], target: [-4, 10.45, 126], label: 'V1 bay anchor · lip 1.0 m, canopy 1.70 m, toward the truck fan target' },
    { name: 'bay-v1-rear', feet: [63, 20, 128], target: [57.2, 21.2, 128], label: 'V1 bay from its open rear · rock lip, canopy and side returns' },
    { name: 'bay-v2-anchor', feet: [88, 30, 210], target: [26, 8.5, 232], label: 'V2 bay anchor · toward the C12-U crossing approach' },
    { name: 'bay-v3-anchor', feet: [66, 26, 286], target: [16, 8.5, 332], label: 'V3 bay anchor · toward A8 through the stepped lip' },
    { name: 'bay-v3-rear', feet: [71, 26, 286], target: [65.2, 27, 288], label: 'V3 bay from its open rear · lip strata step down to the north' },
  ].map((v) => ({ name: v.name, position: [v.feet[0]!, v.feet[1]! + 1.55, v.feet[2]!], target: v.target,
    label: `${v.label} · standing eye`, probe: false, feetY: v.feet[1]! })),
  { name: 'bay-f3-fin', position: [100, 44, 228], target: [69, 30, 267], label: 'Free view · F3 blind-spot fin to y36 between V2 and the compound', probe: false },
  ...[
    { name: 'c12-l-road-mouth', feet: [12, 8, 128], target: [28, 9.55, 134], label: 'C12-L road mouth · removed cap, four-metre shepherd stair toward R2' },
    { name: 'c12-l-landing-1', feet: [28, 8, 134], target: [40, 13.55, 140], label: 'C12-L first 4×4 m landing · ascent through carved road rock' },
    { name: 'c12-l-landing-2', feet: [40, 12, 140], target: [54, 17.55, 140], label: 'C12-L middle landing y12 · ten-riser flights and rest landings' },
    { name: 'c12-l-landing-3', feet: [54, 16, 140], target: [64, 21.55, 128], label: 'C12-L upper landing y16 · carved west-side join to R2' },
    { name: 'c12-u-road-mouth', feet: [26, 8, 232], target: [40, 9.55, 218], label: 'C12-U road mouth · four-metre quarry stair toward R5' },
    { name: 'c12-u-landing-1', feet: [40, 8, 218], target: [62, 15.55, 216], label: 'C12-U first 4×4 m landing · ascent through carved road rock' },
    { name: 'c12-u-landing-2', feet: [62, 14, 216], target: [78, 21.55, 224], label: 'C12-U landing y14 · ten-riser flights, level rests and 2.2 m rock walls' },
    { name: 'c12-u-landing-3', feet: [78, 20, 224], target: [66, 25.55, 244], label: 'C12-U landing y20 · protected stair turn below the ridge' },
    { name: 'c12-u-landing-4', feet: [66, 24, 244], target: [86, 31.55, 248], label: 'C12-U upper landing y24 · carved west-side join to R5' },
  ].map((v) => ({ name: v.name, position: [v.feet[0]!, v.feet[1]! + 1.55, v.feet[2]!], target: v.target,
    label: `${v.label} · standing eye`, probe: false, feetY: v.feet[1]! })),
  { name: 'c12-l-overview', position: [12, 70, 165], target: [40, 14, 137], label: 'Free view · exact C12-L spine, landings and carved road↔R2 connection', probe: false },
  { name: 'c12-u-overview', position: [20, 85, 260], target: [62, 20, 230], label: 'Free view · exact C12-U spine, landings and carved road↔R5 connection', probe: false },
];
const output = new URL('../../../artifacts/qalat-road-supports/', import.meta.url);
const world = loadLevel(JSON.parse(await readFile(new URL('level.json', output), 'utf8')));
// Eye-height evidence must represent a soldier who can actually stand there.
// Keep canonical camera exceptions explicit rather than moving accepted rocks.
for (const v of views.filter((v) => v.position[1] === 9.55 || 'feetY' in v)) {
  const [x, , z] = v.position, feetY = 'feetY' in v ? v.feetY : 8;
  if (blockedAt(x!, z!, .35, feetY, 0, 1.8, world.boxes)) throw new Error(`${v.name}: standing-eye anchor is inside collision geometry`);
  for (const dx of [-.35, 0, .35]) for (const dz of [-.35, 0, .35])
    if (supportUnder(x! + dx, z! + dz, .001, feetY + .05, world.boxes, 0) !== feetY)
      throw new Error(`${v.name}: standing-eye footprint is unsupported at intended feet y${feetY}`);
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
    console.log(`U-168 ${v.name}: ${stats.calls} draws, ${stats.triangles} triangles`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(new URL('captures.json', output), JSON.stringify({
    ...manifest, renderer: 'Three WebGL whitebox; exact generated boxes', antialias: true,
    viewport: [1440, 1000], views: measurements,
  }, null, 2) + '\n');
} finally { await browser?.close(); await server.close(); }
