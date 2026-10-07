/** Reproducible actual WebGL views of U-138's isolated generated whitebox. */
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { insertionManifest } from './maps/qalatInsertion.ts';

const server = await createServer({ root: new URL('../../../', import.meta.url).pathname,
  configFile: false, server: { host: '127.0.0.1', port: 4174, strictPort: true } });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'log') console.log(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:4174/packages/tools/src/maps/insertion-review.html');
  try { await page.waitForFunction("document.body.dataset.ready === 'true'", undefined, { timeout: 60_000 }); }
  catch (error) {
    throw new Error(`Construction viewer did not start: ${errors.join('; ') || String(error)}`);
  }
  const views = [
    { name: 'spawn-north', position: [-2, 9.55, -6], target: [-12, 9.55, 18] },
    { name: 'western-sky', position: [-16, 9.55, -6], target: [0, 17, -2] },
    { name: 'second-bend', position: [-12, 9.55, 36], target: [12, 9.55, 44] },
    { name: 'decision-court', position: [28, 9.55, 58], target: [40, 9.55, 68] },
    { name: 'overview', position: [-74, 126, -100], target: [0, 8, 25] },
  ];
  const output = new URL('../../../artifacts/qalat-insertion/', import.meta.url);
  await mkdir(output, { recursive: true });
  const measurements = [];
  for (const v of views) {
    const stats = await page.evaluate((v) => (globalThis as unknown as {
      __insertionReview: (v: { position: number[]; target: number[] }) => { calls: number; triangles: number; boxCount: number; levelHash: string };
    }).__insertionReview(v), v);
    if (stats.calls >= 300 || stats.levelHash !== insertionManifest().levelHash) throw new Error(`${v.name}: stale geometry or draw budget overrun`);
    await page.screenshot({ path: new URL(`${v.name}.png`, output).pathname });
    measurements.push({ ...v, ...stats });
    console.log(`U-138 ${v.name}: ${stats.calls} draws, ${stats.triangles} triangles`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(new URL('captures.json', output), JSON.stringify({
    ...insertionManifest(), renderer: 'Three WebGL whitebox; exact generated boxes', antialias: true, viewport: [1440, 1000], views: measurements,
  }, null, 2) + '\n');
} finally { await browser?.close(); await server.close(); }
