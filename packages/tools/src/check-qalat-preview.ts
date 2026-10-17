/** U-234: real input against the built or published WIP; no teleport/test controller. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://127.0.0.1:4174/';
const url = new URL('?preview-qalat&review-map', base).href;
const vite = process.argv[2] ? null : spawn('pnpm', ['--filter', '@sandline/client', 'exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], { stdio: 'ignore' });
type State = { world: string; revision: number; boxes: number; position: { x: number; y: number; z: number };
  slot: number; roster: { human: boolean }[]; magazine: { ammo: number }; firstPerson: boolean;
  orders: { kind: string }[]; calls: number };
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
try {
  const deadline = Date.now() + 20000;
  while (true) {
    try { if ((await fetch(base)).ok) break; } catch { /* Starting. */ }
    if (Date.now() > deadline || (vite && vite.exitCode !== null)) throw new Error('Preview server unavailable');
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const read = (): Promise<State> => page.evaluate(() =>
    (window as unknown as { __sandlineQalatPreview: () => State }).__sandlineQalatPreview());
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start WIP playtest' }).waitFor({ timeout: 120000 });
  assert.match(await page.locator('#qalat-wip').innerText(), /Encounters, objectives, five caches/);
  await page.getByRole('button', { name: 'Start WIP playtest' }).click();
  await page.waitForFunction("document.body.dataset.playable === 'true'", undefined, { timeout: 60000 });
  const start = await read();
  assert.equal(start.world, 'qalat-outpost-construction');
  assert.equal(start.revision, 2);
  assert.equal(start.boxes, 110509);
  assert.equal(start.roster.filter((s) => !s.human).length, 5);
  assert.equal(start.position.y, 8);
  await page.mouse.click(800, 500);
  await page.waitForFunction('document.pointerLockElement !== null');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  const moved = await read();
  assert.ok(Math.hypot(moved.position.x - start.position.x, moved.position.z - start.position.z) > 1, 'normal movement must change feet position');
  await page.mouse.down(); await page.waitForTimeout(300); await page.mouse.up();
  await page.waitForTimeout(300);
  const fired = await read();
  assert.ok(fired.magazine.ammo < start.magazine.ammo, 'normal firing must spend authoritative ammo');
  await page.mouse.down({ button: 'right' }); await page.waitForTimeout(300);
  assert.equal((await read()).firstPerson, true);
  await page.mouse.up({ button: 'right' });
  await page.keyboard.down('KeyQ');
  await page.mouse.move(920, 500);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.order-wheel').isVisible(), true);
  await mkdir('artifacts/qalat-preview', { recursive: true });
  await page.screenshot({ path: 'artifacts/qalat-preview/orders.png' });
  await page.keyboard.up('KeyQ');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Take control', exact: true }).first().click();
  await page.waitForFunction(() => (window as unknown as { __sandlineQalatPreview: () => State }).__sandlineQalatPreview().slot !== 0);
  const switched = await read();
  assert.equal(switched.roster.filter((s) => !s.human).length, 5);
  assert.ok(switched.calls < 300, 'preview draw-call budget');
  await page.screenshot({ path: 'artifacts/qalat-preview/playing.png' });
  assert.deepEqual(errors, []);
  const result = { url, start, moved, fired, switched, bundleHash: await page.getAttribute('body', 'data-preview-bundle'), errors };
  await writeFile('artifacts/qalat-preview/evidence.json', JSON.stringify(result, null, 2) + '\n');
  console.log(`PASS Qalat WIP: actual ${start.boxes} boxes, normal movement, firing, first person, order wheel, five bots and soldier switching; ${switched.calls} draws`);
} finally { await browser?.close(); vite?.kill('SIGTERM'); }
