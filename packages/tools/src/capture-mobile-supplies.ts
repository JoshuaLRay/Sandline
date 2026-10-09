/** U-148: smoke the actual built mobile entry, including order/menu dismissal. */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const url = 'http://127.0.0.1:4174/?mobile&mission&world=greybox-01';
const vite = spawn('pnpm', ['--filter', '@sandline/client', 'exec', 'vite', 'preview',
  '--host', '127.0.0.1', '--port', '4174', '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
});
let ready = false;
vite.stdout.on('data', chunk => { if (String(chunk).includes('Local:')) ready = true; });
vite.stderr.on('data', () => { /* The exit code below reports preview startup failure. */ });
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
try {
  const deadline = Date.now() + 20_000;
  while (!ready) {
    if (vite.exitCode !== null) throw new Error(`Preview exited ${vite.exitCode}`);
    if (Date.now() > deadline) throw new Error('Preview did not start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true,
    ...(process.env['CHROMIUM_PATH'] ? { executablePath: process.env['CHROMIUM_PATH'] } : {}) });
  for (const [width, height] of [[360, 800], [820, 360]] as const) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.locator('#load-screen').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: /Practise here/ }).click();
    await page.waitForFunction("document.body.dataset.playable === 'true'");
    await page.locator('.mobile-quick-orders button').first().click();
    const cancelOrder = page.getByRole('button', { name: 'Cancel order placement', exact: true });
    await cancelOrder.waitFor({ state: 'visible' });
    await page.locator('.mobile-supply-trigger').click();
    await cancelOrder.waitFor({ state: 'hidden' });
    // Production-map cache placement remains U-117; this path must be honest.
    await page.getByText('Supply caches unavailable', { exact: true }).waitFor();
    await page.screenshot({ path: `docs/backlog/evidence/U-148-main-${width}.png` });
    await page.locator('.mobile-quick-orders button').first().click();
    await page.locator('.mobile-supply-panel').waitFor({ state: 'hidden' });
    await page.locator('.mobile-supply-trigger').click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('.mobile-supply').waitFor({ state: 'hidden' });
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`${width}x${height}: real main entry, unavailable caches, order disarming and menu dismissal passed`);
    await context.close();
  }
} finally {
  await browser?.close();
  if (vite.pid && process.platform !== 'win32') {
    try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* The preview may already have exited. */ }
  } else vite.kill('SIGTERM');
}
