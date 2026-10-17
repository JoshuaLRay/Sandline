/** U-234: real input against the built or published WIP; no teleport/test controller. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://127.0.0.1:4174/';
const url = new URL('?preview-qalat&review-map', base).href;
const vite = process.argv[2] ? null : spawn('pnpm', ['--filter', '@sandline/client', 'exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], { stdio: 'ignore' });
type State = { joined: boolean; disconnectReason: string | null; world: string; revision: number; boxes: number; position: { x: number; y: number; z: number };
  slot: number; roster: { human: boolean }[]; magazine: { ammo: number }; firstPerson: boolean;
  orders: { order: string }[]; frozen: boolean; calls: number };
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
try {
  const deadline = Date.now() + 20000;
  while (true) {
    try { if ((await fetch(base)).ok) break; } catch { /* Starting. */ }
    if (Date.now() > deadline || (vite && vite.exitCode !== null)) throw new Error('Preview server unavailable');
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  page.setDefaultTimeout(30000);
  const errors: string[] = [];
  page.on('pageerror', (error) => { errors.push(error.message); console.error(error.message); });
  page.on('crash', () => console.error('[preview] browser renderer crashed'));
  const read = (): Promise<State> => page.evaluate(() =>
    (window as unknown as { __sandlineQalatPreview: () => State }).__sandlineQalatPreview());
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start WIP playtest' }).waitFor({ timeout: 120000 });
  assert.equal(await page.evaluate('typeof window.__sandlineQalatPreviewFrame'), 'function', 'current preview capture build required');
  assert.match(await page.locator('#qalat-wip').innerText(), /Encounters, objectives, five caches/);
  await page.getByRole('button', { name: 'Start WIP playtest' }).click();
  await page.waitForFunction("document.body.dataset.playable === 'true'", undefined, { timeout: 60000 });
  const start = await read();
  console.log(`[preview] joined ${start.world}, ${start.boxes} boxes`);
  assert.equal(start.world, 'qalat-outpost-construction');
  assert.equal(start.revision, 2);
  assert.equal(start.boxes, 110509);
  assert.equal(start.roster.filter((s) => !s.human).length, 5);
  assert.equal(start.position.y, 8);
  // Match perf-frame.ts's explicit headless pointer-lock fixture. All game
  // actions still enter LocalInput and the real Session; no state is teleported.
  const pointer = (on: boolean) => page.evaluate(`(() => {
    const canvas = document.querySelector('canvas');
    const set = (element) => {
      Object.defineProperty(document, 'pointerLockElement', { get: () => element, configurable: true });
      document.dispatchEvent(new Event('pointerlockchange'));
    };
    canvas.requestPointerLock = () => { set(canvas); return Promise.resolve(); };
    document.exitPointerLock = () => set(null);
    Object.defineProperty(document, 'pointerLockElement', { get: () => ${on ? 'canvas' : 'null'}, configurable: true });
    document.dispatchEvent(new Event('pointerlockchange'));
  })()`);
  const mouse = (type: 'mousedown' | 'mouseup', button = 0) => page.evaluate(({ type, button }) =>
    window.dispatchEvent(new MouseEvent(type, { button, bubbles: true })), { type, button });
  await pointer(true);
  await page.keyboard.down('KeyW');
  await page.waitForFunction((origin) => {
    const current = (window as unknown as { __sandlineQalatPreview: () => State }).__sandlineQalatPreview().position;
    return Math.hypot(current.x - origin.x, current.z - origin.z) > 2;
  }, start.position, { timeout: 15000 });
  await page.keyboard.up('KeyW');
  const moved = await read();
  console.log(`[preview] moved to ${JSON.stringify(moved.position)}`);
  assert.ok(Math.hypot(moved.position.x - start.position.x, moved.position.z - start.position.z) > 1, 'normal movement must change feet position');
  await mouse('mousedown');
  await page.waitForFunction((ammo) =>
    (window as unknown as { __sandlineQalatPreview: () => State }).__sandlineQalatPreview().magazine.ammo < ammo,
  start.magazine.ammo, { timeout: 15000 });
  await mouse('mouseup');
  const fired = await read();
  assert.ok(fired.magazine.ammo < start.magazine.ammo, 'normal firing must spend authoritative ammo');
  await mouse('mousedown', 2); await page.waitForTimeout(300);
  await page.waitForFunction(() => (window as unknown as { __sandlineQalatPreview: () => State }).__sandlineQalatPreview().firstPerson);
  await mouse('mouseup', 2);
  console.log('[preview] firing and first-person aim passed');
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { movementY: 100, bubbles: true })));
  await page.keyboard.down('KeyQ');
  // As in perf-frame.ts: headless pointer lock supplies zero CDP deltas.
  // Dispatch relative mouse motion through the normal LocalInput handler.
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: 60, movementY: 0, bubbles: true })));
  await page.waitForTimeout(300);
  await page.locator('.order-wheel-item').first().waitFor({ state: 'visible' });
  console.log(`[preview] wheel choice: ${await page.locator('.order-wheel-centre').innerText()}`);
  await mkdir('artifacts/qalat-preview', { recursive: true });
  await page.keyboard.up('KeyQ');
  await page.waitForFunction(() => (window as unknown as { __sandlineQalatPreview: () => State }).__sandlineQalatPreview().orders.some((o) => o.order === 'hold'));
  console.log('[preview] squad accepted floor-aware hold order');
  await page.keyboard.press('Escape');
  if (await page.locator('#menu').getAttribute('data-mode') !== 'pause') await page.keyboard.press('Escape');
  await pointer(false);
  console.log(`[preview] pause mode: ${await page.locator('#menu').getAttribute('data-mode')}`);
  const connection = await read();
  console.log(`[preview] connection before takeover: ${connection.joined}, ${connection.disconnectReason}`);
  assert.equal(connection.joined, true, connection.disconnectReason ?? 'session must stay joined');
  const take = page.getByRole('button', { name: 'Take control', exact: true }).first();
  await take.scrollIntoViewIfNeeded();
  assert.ok(await take.evaluate((button) => {
    const r = button.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit === button || button.contains(hit);
  }), 'soldier takeover button must be exposed');
  await take.evaluate((button) => (button as HTMLButtonElement).click());
  console.log(`[preview] takeover activated, menu ${await page.locator('#menu').getAttribute('data-mode')}`);
  await page.waitForFunction(() => (window as unknown as { __sandlineQalatPreview: () => State }).__sandlineQalatPreview().slot !== 0);
  const switched = await read();
  console.log(`[preview] switched to soldier slot ${switched.slot}, ${switched.calls} draws`);
  assert.equal(switched.roster.filter((s) => !s.human).length, 5);
  assert.ok(switched.calls < 300, 'preview draw-call budget');
  console.log('[preview] controls verified; preparing rendered frame');
  // Restore the native API after the headless input fixture.
  await page.evaluate(() => {
    Reflect.deleteProperty(document.querySelector('canvas')!, 'requestPointerLock');
    Reflect.deleteProperty(document, 'exitPointerLock');
    Reflect.deleteProperty(document, 'pointerLockElement');
    document.exitPointerLock();
    if (document.fullscreenElement) void document.exitFullscreen();
  });
  await page.waitForFunction('document.fullscreenElement === null && document.pointerLockElement === null');
  console.log('[preview] capture platform settled');
  await page.evaluate(() => (window as unknown as { __sandlineQalatPreviewFreeze: () => void }).__sandlineQalatPreviewFreeze());
  console.log('[preview] rendered frame requested');
  await page.waitForFunction(() => (window as unknown as { __sandlineQalatPreview: () => State }).__sandlineQalatPreview().frozen);
  console.log('[preview] rendered frame ready');
  const frame = await page.evaluate(() => (window as unknown as { __sandlineQalatPreviewFrame: () => string | null }).__sandlineQalatPreviewFrame());
  assert.ok(frame !== null, 'real rendered frame required');
  assert.ok(frame.startsWith('data:image/png;base64,'), 'PNG canvas frame required');
  await writeFile('artifacts/qalat-preview/playing.png', Buffer.from(frame.split(',')[1]!, 'base64'));
  assert.deepEqual(errors, []);
  const buildStamp = await page.locator('#build-stamp').textContent() ?? '';
  const expectedSha = process.env['SANDLINE_EXPECT_SHA'];
  const publishedSha = buildStamp.split(' ')[0] ?? '';
  if (expectedSha) assert.ok(publishedSha.length >= 7 && expectedSha.startsWith(publishedSha), `unexpected published build: ${buildStamp}`);
  const label = await page.locator('#qalat-wip').innerText();
  const result = { url, buildStamp, label, start, moved, fired, switched, bundleHash: await page.getAttribute('body', 'data-preview-bundle'), errors };
  await writeFile('artifacts/qalat-preview/evidence.json', JSON.stringify(result, null, 2) + '\n');
  console.log(`PASS Qalat WIP: actual ${start.boxes} boxes, normal movement, firing, first person, order wheel, five bots and soldier switching; ${switched.calls} draws`);
} finally { await browser?.close(); vite?.kill('SIGTERM'); }
