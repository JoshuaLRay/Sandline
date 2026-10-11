/** Reproducible actual WebGL captures of U-149's isolated road support build, bent by U-159 and closed by U-160's rock, furnished by U-161. */
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
  { name: 'v2-eye-to-mg-nest', position: [88, 31.55, 210], target: [-22, 9.15, 222], label: 'V2 bay standing eye (unbuilt ridge) · visible MG breastwork; original feet fan kept 0.3 m above rock', probe: false },
  { name: 'toll-office', position: [-4, 9.55, 118], target: [12, 9.55, 128], label: 'Toll office interior · open 4 m east door, closed north wall · standing eye y9.55', probe: false },
  { name: 'frontage-mg', position: [-23, 9.55, 222.8], target: [-28, 9.55, 180], label: 'AF1 MG nest · A-C06 at the head of the west leg · standing eye y9.55', probe: false },
  { name: 'depot-frontage', position: [-35, 9.55, 199], target: [-38.5, 9.55, 200.4], label: 'West-leg depot frontage · closed loading recesses · standing eye y9.55', probe: false },
  { name: 'cap-x-ingress', position: [16, 9.55, 332], target: [70, 9.55, 336], label: 'CAP-X · y8 service road under reserved bridge; bridge remains U-140', probe: false },
  { name: 'x0-motor-pool', position: [96, 9.55, 444], target: [114, 9.55, 432], label: 'X0 · exact motor pool, y14 rock canopy and offset six-metre returns · standing eye y9.55', probe: false },
  { name: 'x1-retaining-turn', position: [114, 9.55, 432], target: [96, 9.55, 444], label: 'X1 · screened return through the retaining dogleg · standing eye y9.55', probe: false },
  { name: 'x-bridge-reservation', position: [70, 9.55, 336], target: [84, 9.55, 338], label: 'Service road y8 · exact x66..74/z330..342 bridge void, underside y14 reserved; deck unbuilt', probe: false },
  { name: 'v3-x5-silhouette', position: [66, 27.55, 286], target: [54, 11.2, 334], label: 'V3 eye probe on unbuilt shelf · X5 turret-height silhouette opening; X0 remains hidden', probe: false },
];
const output = new URL('../../../artifacts/qalat-road-supports/', import.meta.url);
const world = loadLevel(JSON.parse(await readFile(new URL('level.json', output), 'utf8')));
// Eye-height evidence must represent a soldier who can actually stand there.
// Keep canonical camera exceptions explicit rather than moving accepted rocks.
for (const v of views.filter((v) => v.position[1] === 9.55)) {
  const [x, , z] = v.position, feetY = 8;
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
      __roadSupportReview: (v: { position: number[]; target: number[]; label: string; probe: boolean }) => {
        calls: number; triangles: number; boxCount: number; levelHash: string;
      };
    }).__roadSupportReview(v), v);
    if (stats.calls >= 300 || stats.levelHash !== manifest.levelHash) throw new Error(`${v.name}: stale geometry or draw budget overrun`);
    await page.screenshot({ path: new URL(`${v.name}.png`, output).pathname });
    measurements.push({ ...v, ...stats });
    console.log(`U-151 ${v.name}: ${stats.calls} draws, ${stats.triangles} triangles`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(new URL('captures.json', output), JSON.stringify({
    ...manifest, renderer: 'Three WebGL whitebox; exact generated boxes', antialias: true,
    viewport: [1440, 1000], views: measurements,
  }, null, 2) + '\n');
} finally { await browser?.close(); await server.close(); }
