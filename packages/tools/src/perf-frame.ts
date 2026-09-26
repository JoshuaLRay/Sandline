/**
 * T-5.04 frame-time harness.
 *
 * Runs the production client in Chromium on the slice mission with the squad
 * (`?mission&squad&perf`), dismisses the briefing, and plays two phases —
 * a walk-through (the player walks up the start while the view sweeps) and a
 * firefight (on towards the compound until the squad is in contact) —
 * reading `?perf`'s numbers (T-5.04 overlay) after each: frame time (median,
 * 95th percentile, worst), the frame rate, and the worst draw calls and
 * triangles. It asserts the draw budget (ADR-013's 300 calls) and a triangle
 * ceiling, and records frame time without asserting it: headless Chromium
 * draws in software, which is not the target hardware — the owner reads the
 * same overlay there. Writes `perf-frame.json` in the working directory.
 *
 * Run after `pnpm --filter @sandline/client build`: pnpm perf:frame
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4174;
const URL = `http://127.0.0.1:${PORT}/?mission&squad&perf`;
/** ADR-013. */
const DRAW_CALLS = 300;
/** A harness ceiling, not an ADR-013 number: six soldiers and ten enemies at the character budget, and the kit, with room. */
const TRIANGLES = 1_000_000;
const PHASE_SECONDS = { walk: 12, firefight: 20 };

interface Summary {
  frames: number;
  medianMs: number;
  p95Ms: number;
  worstMs: number;
  fps: number;
  drawCalls: number;
  triangles: number;
}

function startVite(): ChildProcess {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  return spawn(command, ['--filter', '@sandline/client', 'exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
}

async function waitForServer(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 20_000;
  let last = '';
  child.stderr?.on('data', (chunk) => {
    last += String(chunk);
  });
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vite exited ${child.exitCode}: ${last}`);
    try {
      if ((await fetch(URL)).ok) return;
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite did not become ready: ${last}`);
}

const vite = startVite();
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
let failed = false;
try {
  await waitForServer(vite);
  browser = await chromium.launch({
    headless: true,
    ...(process.env['PERF_CHROMIUM'] ? { executablePath: process.env['PERF_CHROMIUM'] } : {}),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.locator('#load-screen').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /Practise here/i }).click();
  await page.waitForFunction("document.body.dataset.playable === 'true'", undefined, { timeout: 120_000 });
  await page.waitForSelector('#briefing', { timeout: 20_000 }).catch(() => null);
  await page.keyboard.press('Enter');
  // The page steers by pointer lock; a headless page has none to give, so it is told it has.
  // Scripts go as text: a function handed to the page would carry tsx's helpers with it.
  await page.evaluate(`(() => {
    const canvas = document.querySelector('canvas');
    Object.defineProperty(document, 'pointerLockElement', { get: () => canvas, configurable: true });
    document.dispatchEvent(new Event('pointerlockchange'));
  })()`);
  const key = (code: string, type: 'keydown' | 'keyup') => page.evaluate(`window.dispatchEvent(new KeyboardEvent('${type}', { code: '${code}', bubbles: true }))`);
  const sweep = (dx: number) => page.evaluate(`document.dispatchEvent(new MouseEvent('mousemove', { movementX: ${dx}, bubbles: true }))`);
  const mouse = (type: 'mousedown' | 'mouseup') => page.evaluate(`window.dispatchEvent(new MouseEvent('${type}', { button: 0, bubbles: true }))`);
  const read = async () => (await page.evaluate('window.__sandlinePerf ?? null')) as Summary | null;
  const results: Record<string, Summary | null> = {};

  // Settle, then the walk-through: forward with the view swinging side to side.
  await page.waitForTimeout(2000);
  await page.evaluate('window.__sandlinePerfClear?.()');
  await key('KeyW', 'keydown');
  const walkEnd = Date.now() + PHASE_SECONDS.walk * 1000;
  for (let i = 0; Date.now() < walkEnd; i++) {
    await sweep(i % 20 < 10 ? 30 : -30);
    await page.waitForTimeout(100);
  }
  results['walk'] = await read();
  await page.evaluate('window.__sandlinePerfClear?.()');
  // The firefight: on up the lane with the squad until contact, firing in bursts.
  await key('ShiftLeft', 'keydown');
  const fightEnd = Date.now() + PHASE_SECONDS.firefight * 1000;
  for (let i = 0; Date.now() < fightEnd; i++) {
    if (i % 10 === 0) await mouse('mousedown');
    if (i % 10 === 4) await mouse('mouseup');
    await page.waitForTimeout(100);
  }
  await key('ShiftLeft', 'keyup');
  await key('KeyW', 'keyup');
  results['firefight'] = await read();

  const report = { url: URL, viewport: '1920x1080', renderer: 'headless Chromium, SwiftShader (software) — not target hardware', budget: { drawCalls: DRAW_CALLS, triangles: TRIANGLES }, results };
  writeFileSync('perf-frame.json', `${JSON.stringify(report, null, 2)}\n`);
  for (const [phase, s] of Object.entries(results)) {
    if (!s) {
      console.error(`${phase}: no numbers — is ?perf on the page?`);
      failed = true;
      continue;
    }
    console.log(`${phase}: ${s.fps.toFixed(1)} fps (median ${s.medianMs.toFixed(1)} ms, p95 ${s.p95Ms.toFixed(1)} ms, worst ${s.worstMs.toFixed(1)} ms over ${s.frames} frames); draw calls ${s.drawCalls}/${DRAW_CALLS}; triangles ${s.triangles}/${TRIANGLES}`);
    if (s.drawCalls > DRAW_CALLS) {
      console.error(`${phase}: ${s.drawCalls} draw calls, over ADR-013's ${DRAW_CALLS}`);
      failed = true;
    }
    if (s.triangles > TRIANGLES) {
      console.error(`${phase}: ${s.triangles} triangles, over the harness ceiling ${TRIANGLES}`);
      failed = true;
    }
  }
  console.log('frame time is recorded, not asserted: headless Chromium is not target hardware (wrote perf-frame.json)');
} finally {
  await browser?.close();
  vite.kill('SIGTERM');
}
if (failed) process.exit(1);
