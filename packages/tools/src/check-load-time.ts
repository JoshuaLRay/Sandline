/**
 * T-4.06 time-to-playable CI probe.
 *
 * Runs the production Vite client in Chromium, throttles the whole page through
 * Chrome DevTools Protocol to 4 Mbit/s with 100 ms latency, chooses the
 * kit-authored mission in the normal lobby, and waits for main.ts to mark the
 * first rendered playable frame. The 30 s ceiling is ADR-013's.
 *
 * Run after `pnpm --filter @sandline/client build` and installing Chromium: pnpm check:load-time
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4173;
const URL = `http://127.0.0.1:${PORT}/?mission`;
const PLAYABLE_LIMIT_MS = 30_000;
const DOWNLOAD_BYTES_PER_SECOND = (4 * 1024 * 1024) / 8;
const UPLOAD_BYTES_PER_SECOND = (1 * 1024 * 1024) / 8;
const LATENCY_MS = 100;

function startVite(): ChildProcess {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  return spawn(command, [
    '--filter',
    '@sandline/client',
    'exec',
    'vite',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    String(PORT),
    '--strictPort',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
}

async function waitForServer(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 20_000;
  let last = '';
  child.stderr?.on('data', (chunk) => { last += String(chunk); });
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vite exited ${child.exitCode}: ${last}`);
    try {
      const response = await fetch(URL);
      if (response.ok) return;
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite did not become ready: ${last}`);
}

const vite = startVite();
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
try {
  await waitForServer(vite);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: LATENCY_MS,
    downloadThroughput: DOWNLOAD_BYTES_PER_SECOND,
    uploadThroughput: UPLOAD_BYTES_PER_SECOND,
    connectionType: 'cellular4g',
  });

  const started = Date.now();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.locator('#load-screen').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /Practise here/i }).click();
  await page.waitForFunction("document.body.dataset.playable === 'true'", undefined, { timeout: PLAYABLE_LIMIT_MS });
  const elapsed = Date.now() - started;

  console.log(
    `first playable frame: ${elapsed}/${PLAYABLE_LIMIT_MS} ms at 4 Mbit/s down, 1 Mbit/s up, ${LATENCY_MS} ms latency`,
  );
  if (elapsed >= PLAYABLE_LIMIT_MS) throw new Error(`playable took ${elapsed} ms, limit is <${PLAYABLE_LIMIT_MS} ms`);
} finally {
  await browser?.close();
  vite.kill('SIGTERM');
}
