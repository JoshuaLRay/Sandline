/** Capture the exact U-170 basement inside the unchanged complete surface. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { blockedAt, loadLevel, supportUnder } from '@sandline/shared';
import { chromium } from 'playwright';
import { createServer } from 'vite';

type View = { name: string; position: number[]; target: number[]; label: string; ceilingY: number };
type Stats = { calls: number; triangles: number; boxCount: number; levelHash: string; renderedCeilingY: number };
type Review = { views: View[]; view: (name: string) => Stats };
const output = new URL('../../../artifacts/qalat-depot/', import.meta.url);
const [level, manifest] = await Promise.all([
  readFile(new URL('level.json', output), 'utf8').then((s) => JSON.parse(s)),
  readFile(new URL('construction.json', output), 'utf8').then((s) => JSON.parse(s)) as Promise<{ levelHash: string; task: string }>,
]);
const world = loadLevel(level);
const server = await createServer({ root: new URL('../../../', import.meta.url).pathname,
  configFile: false, server: { host: '127.0.0.1', port: 4176, strictPort: true } });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await server.listen();
  const executablePath = process.env['CHROMIUM_PATH'];
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}),
    args: ['--use-angle=swiftshader', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:4176/packages/tools/src/maps/depot-review.html');
  try { await page.waitForFunction("document.body.dataset.ready === 'true'", undefined, { timeout: 60_000 }); }
  catch (error) { throw new Error(`Depot viewer did not start: ${errors.join('; ') || String(error)}`); }
  const views = await page.evaluate(() => (globalThis as unknown as { __depotReview: Review }).__depotReview.views);
  const measurements = [];
  await mkdir(output, { recursive: true });
  for (const v of views) {
    const [x, eyeY, z] = v.position;
    if (eyeY !== 1.55 || blockedAt(x!, z!, .35, 0, 0, 1.8, world.boxes))
      throw new Error(`${v.name}: standing-eye anchor is inside collision geometry or above floor 0`);
    for (const dx of [-.35, 0, .35]) for (const dz of [-.35, 0, .35])
      if (supportUnder(x! + dx, z! + dz, .001, .05, world.boxes, 0) !== 0)
        throw new Error(`${v.name}: standing-eye footprint is unsupported at floor 0`);
    const stats = await page.evaluate((name) => (globalThis as unknown as { __depotReview: Review }).__depotReview.view(name), v.name);
    if (stats.calls >= 300 || stats.levelHash !== manifest.levelHash)
      throw new Error(`${v.name}: stale geometry or draw budget overrun`);
    await page.screenshot({ path: new URL(`${v.name}.png`, output).pathname });
    measurements.push({ ...v, ...stats });
    console.log(`${manifest.task} ${v.name}: ${stats.calls} draws, ${stats.triangles} triangles, ceiling y${stats.renderedCeilingY}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(new URL('captures.json', output), JSON.stringify({ ...manifest,
    renderer: 'Three WebGL whitebox; complete generated box union, downward ceiling faces and implicit world floor',
    antialias: true, viewport: [1440, 1000], ownerQualityVerdict: 'pending; whole-mission acceptance U-119', views: measurements,
  }, null, 2) + '\n');
} finally { await browser?.close(); await server.close(); }
