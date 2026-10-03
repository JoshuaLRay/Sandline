/** U-095: real production-rendered map views, captured in CI's Chromium. */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
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
    { name: 'road-bank-ground', position: [19, 2.7, 106], target: [0, 0.7, 140] },
    { name: 'terrace-lower-ground', position: [40, 2.7, 70], target: [40, 2.5, 92] },
    { name: 'terrace-upper-ground', position: [26, 4.95, 164], target: [20, 1.5, 182] },
    { name: 'compound-approach-steps', position: [40, 1.7, 188], target: [40, 3.25, 171] },
    { name: 'valley-overview', position: [130, 145, -35], target: [0, 0, 92] },
    { name: 'compound-and-north-gate', position: [68, 38, 140], target: [0, 0, 181] },
    { name: 'terraces-and-east-gate', position: [75, 25, 112], target: [25, 2, 157] },
  ];
  for (const view of views) {
    await page.evaluate((v) => {
      const hook = (globalThis as unknown as { __sandlineMapReview: (view: { position: number[]; target: number[] }) => void }).__sandlineMapReview;
      hook(v);
    }, view);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `artifacts/map-review/${view.name}.png` });
    console.log(`Captured ${view.name}`);
  }
} finally { await browser?.close(); vite.kill('SIGTERM'); }
