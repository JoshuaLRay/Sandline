/// <reference lib="dom" />
/** Real MediaRecorder, HTTP intake and playback with Chromium's synthetic microphone. Never touches Fly. */
import { strict as assert } from 'node:assert';
import { createServer as httpServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer as viteServer } from 'vite';
import { chromium } from 'playwright';
import { VoiceIntake } from '../../server/src/voice/intake.ts';

const temporary = mkdtempSync(join(tmpdir(), 'sandline-contributor-'));
const output = resolve('artifacts/voice-submission');
mkdirSync(output, { recursive: true });
let intake: VoiceIntake;
const server = httpServer((req, res) => void intake.handle(req, res));
const vite = await viteServer({ root: resolve('packages/client'), configFile: false, server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'voice-test-page', configureServer(dev) {
    dev.middlewares.use('/voice-test', (_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script type="module">
        import { showVoiceSubmission } from '/src/ui/VoiceSubmission.ts';
        showVoiceSubmission(document.body, '${api}');
      </script></body></html>`);
    });
  } }],
});
let api = '';
try {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing intake port');
  api = `http://127.0.0.1:${address.port}`;
  await vite.listen();
  const pageAddress = vite.httpServer!.address();
  if (!pageAddress || typeof pageAddress === 'string') throw new Error('Missing page port');
  const origin = `http://127.0.0.1:${pageAddress.port}`;
  intake = new VoiceIntake({ dir: join(temporary, 'submissions'), origin, inviteKey: 'JRay' });
  const browser = await chromium.launch({ headless: true, ...(process.env['CHROMIUM_PATH'] ? { executablePath: process.env['CHROMIUM_PATH'] } : {}),
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/voice-test`);
    await page.getByRole('textbox', { name: 'Your name or nickname' }).fill('Browser fixture');
    await page.getByLabel('Invitation code', { exact: true }).fill('JRay');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Agree and start', exact: true }).click();
    await page.getByRole('heading', { name: 'Lines for Browser fixture' }).waitFor();
    await page.screenshot({ path: join(output, 'desktop-lines.png') });
    await page.locator('[data-line="contact-shout"]').click();
    for (let n = 1; n <= 3; n += 1) {
      await page.getByRole('button', { name: 'Record', exact: true }).click();
      await page.getByRole('button', { name: 'Stop', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Submit', exact: true }).isEnabled(), false);
      // Wait for a real encoded chunk, not a mocked recording blob.
      await page.waitForTimeout(1100);
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      await page.getByRole('button', { name: 'Submit', exact: true }).click();
      await page.waitForFunction((count) => document.querySelector('[data-line="contact-shout"]')?.textContent?.includes(`${count} saved`), n);
    }
    assert.equal(intake.reviewSubmissions().submissions[0]!.clips.length, 3);
    assert.equal(intake.reviewSubmissions().submissions[0]!.complete, true);
    await page.reload();
    await page.getByRole('heading', { name: 'Lines for Browser fixture' }).waitFor();
    await page.locator('[data-line="contact-shout"]').click();
    assert.equal(await page.locator('.voice-play').count(), 3);
    await page.getByRole('button', { name: 'Listen to recording 1', exact: true }).click();
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio')!;
      return audio.currentTime > 0 && !audio.paused && !audio.error;
    });
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor();
    assert.equal(await page.locator('audio').evaluate((el) => {
      const audio = el as HTMLAudioElement;
      return audio.paused && !audio.controls;
    }), true);
    assert.equal(await page.getByRole('button', { name: 'Listen to recording 1', exact: true }).isEnabled(), false);
    await page.waitForTimeout(1100);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-line="contact-shout"]')?.textContent?.includes('4 saved'));
    await page.screenshot({ path: join(output, 'desktop-detail.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(output, 'mobile-detail.png') });
    await page.getByRole('button', { name: 'All lines', exact: true }).click();
    await page.screenshot({ path: join(output, 'mobile-lines.png') });
    assert.deepEqual(errors, []);
    const result = { recordings: 4, realMediaRecorder: true, realIntake: true, playbackAfterReload: true, playbackBlockedDuringRecording: true, desktop: '1100×900', mobile: '390×844', errors };
    writeFileSync(join(output, 'results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
} finally {
  await vite.close();
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(temporary, { recursive: true, force: true });
}
