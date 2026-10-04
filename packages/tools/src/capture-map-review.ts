/** U-095: real production-rendered map views, captured in CI's Chromium. */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const url = 'http://127.0.0.1:4173/?mission&world=qalat-road&review-map';
const vite = spawn('pnpm', ['--filter', '@sandline/client', 'exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
try {
  const deadline = Date.now() + 20000;
  while (true) {
    try { if ((await fetch(url)).ok) break; } catch { /* Server starting. */ }
    if (Date.now() > deadline || vite.exitCode !== null) throw new Error('Map review preview did not start');
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto(url);
  await page.locator('#load-screen').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /Practise here/i }).click();
  await page.waitForFunction("document.body.dataset.playable === 'true'", undefined, { timeout: 30000 });
  await page.addStyleTag({ content: 'body > :not(canvas) { visibility: hidden !important; } canvas { visibility: visible !important; }' });
  await mkdir('artifacts/map-review', { recursive: true });
  const views = [
    { name: 'riverbed-ground', position: [-40, 1.7, 58], target: [-20, 1, 90] },
    { name: 'road-bank-ground', position: [8, 1.7, 106], target: [0, 0.7, 140] },
    { name: 'C12-S', position: [8, 1.7, 44], target: [28, 2, 44] },
    { name: 'C12-M', position: [8, 1.7, 104], target: [28, 3, 104] },
    { name: 'C12-N', position: [8, 1.7, 154], target: [28, 4.25, 154] },
    { name: 'west-bank-closed', position: [-40, 1.7, 68], target: [-28, 2, 80] },
    { name: 'flank-bottleneck', position: [-42, 1.7, 88], target: [-41, 1, 104] },
    { name: 'flank-west-gate', position: [-24, 1.7, 182], target: [-8, 1, 182] },
    { name: 'O1-support', position: [11.8, 2.7, 60], target: [0, 1, 60] },
    { name: 'O2-support', position: [11.8, 3.7, 112], target: [0, 1, 112] },
    { name: 'O3-support', position: [11.8, 4.95, 164], target: [0, 1, 164] },
    { name: 'terrace-lower-ground', position: [40, 2.7, 70], target: [40, 2.5, 92] },
    { name: 'terrace-upper-ground', position: [26, 4.95, 164], target: [20, 1.5, 182] },
    { name: 'compound-approach-steps', position: [40, 1.7, 188], target: [40, 3.25, 171] },
    { name: 'valley-overview', position: [130, 145, -35], target: [0, 0, 92] },
    { name: 'compound-and-north-gate', position: [68, 38, 140], target: [0, 0, 181] },
    { name: 'terraces-and-east-gate', position: [75, 25, 112], target: [25, 2, 157] },
    { name: 'compound-ground', position: [16, 1.7, 186], target: [-8, 1, 180] },
  ];
  const measurements: Record<string, unknown> = {};
  for (const view of views) {
    await page.evaluate((v) => (globalThis as unknown as { __sandlineMapReview: (view: { position: number[]; target: number[] }) => unknown }).__sandlineMapReview(v), view);
    await page.waitForTimeout(1000);
    const stats = await page.evaluate((v) => (globalThis as unknown as { __sandlineMapReview: (view: { position: number[]; target: number[] }) => { grid: boolean; calls: number; triangles: number } }).__sandlineMapReview(v), view);
    if (stats.grid) throw new Error('Default gameplay unexpectedly draws the diagnostic grid');
    if (stats.calls >= 300) throw new Error(`${view.name}: ${stats.calls} draw calls exceeds ADR-013`);
    measurements[view.name] = stats;
    await page.screenshot({ path: `artifacts/map-review/${view.name}.png` });
    console.log(`Captured ${view.name}: ${stats.calls} calls, ${stats.triangles} triangles, grid off`);
  }
  await page.goto(`${url}&grid`);
  await page.locator('#load-screen').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /Practise here/i }).click();
  await page.waitForFunction("document.body.dataset.playable === 'true'", undefined, { timeout: 30000 });
  await page.addStyleTag({ content: 'body > :not(canvas) { visibility: hidden !important; } canvas { visibility: visible !important; }' });
  const qa = await page.evaluate((v) => (globalThis as unknown as { __sandlineMapReview: (view: { position: number[]; target: number[] }) => { grid: boolean } }).__sandlineMapReview(v), views[0]!);
  if (!qa.grid) throw new Error('Explicit ?grid did not draw the QA grid');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'artifacts/map-review/qa-grid.png' });
  measurements['explicit-grid'] = qa;
  await writeFile('artifacts/map-review/measurements.json', JSON.stringify(measurements, null, 2) + '\n');
} finally { await browser?.close(); vite.kill('SIGTERM'); }
