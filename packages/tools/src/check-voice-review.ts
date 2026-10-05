/// <reference lib="dom" />
/** Local HTTPS/browser proof with synthetic clips and a mock GitHub provider. Never touches Fly. */
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, webkit } from 'playwright';
import { VoiceIntake } from '../../server/src/voice/intake.ts';
import { VoiceReview } from '../../server/src/voice/review.ts';
import { VOICE_CONSENT_TEXT } from '@sandline/shared';

const temporary = mkdtempSync(join(tmpdir(), 'sandline-browser-review-'));
const output = join(process.cwd(), 'artifacts', 'voice-review');
mkdirSync(output, { recursive: true });
const key = join(temporary, 'key.pem');
const cert = join(temporary, 'cert.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
  '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-days', '1'], { stdio: 'ignore' });

let review: VoiceReview;
const intake = new VoiceIntake({ dir: join(temporary, 'submissions'), origin: 'https://joshualray.github.io', inviteKey: 'JRay' });
const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
  void (req.url?.startsWith('/voice-review') ? review : intake).handle(req, res);
});
try {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No HTTPS test port');
  const origin = `https://127.0.0.1:${address.port}`;
  const provider: typeof fetch = async (target) => Response.json(String(target).endsWith('/access_token')
    ? { access_token: 'local-fixture-token' } : { id: 127329846 });
  review = new VoiceReview({ intake, publicOrigin: origin, clientId: 'local-fixture-client', clientSecret: 'local-fixture-secret', fetch: provider });
  const formats = [
    { pass: 'hit-hurt', extension: 'wav', type: 'audio/wav', codec: 'pcm_s16le' },
    { pass: 'contact-normal', extension: 'webm', type: 'audio/webm', codec: 'libopus' },
    { pass: 'reload-normal', extension: 'm4a', type: 'audio/mp4', codec: 'aac' },
  ];
  for (const format of formats) execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-ar', '48000', '-c:a', format.codec, join(temporary, `sample.${format.extension}`)], { stdio: 'ignore' });
  const results: object[] = [];
  for (const [engine, browserType] of [['chromium', chromium], ['webkit', webkit]] as const) {
    const browser = await browserType.launch({ headless: true });
    try {
      const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1100, height: 900 } });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      // Replace GitHub's interactive approval with a fixture redirect. Server state/PKCE and browser cookies remain real.
      await context.route(`${origin}/voice-review/login`, async (route) => {
        const start = await context.request.get(route.request().url(), { maxRedirects: 0 });
        const state = new URL(start.headers()['location']!).searchParams.get('state');
        // WebKit's Playwright interception cannot fulfill a redirect response.
        await route.fulfill({ status: 200, contentType: 'text/html', headers: { 'set-cookie': start.headers()['set-cookie']! },
          body: `<meta http-equiv="refresh" content="0;url=${origin}/voice-review/callback?code=fixture&amp;state=${state}">` });
      });
      await page.goto(`${origin}/voice-review`);
      await page.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('Sign in as JoshuaLRay'));
      await page.getByRole('link', { name: 'Sign in with GitHub' }).click();
      await page.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('No voice submissions'));
      const created = await context.request.post(`${origin}/voice-submissions`, { data: {
        name: 'Browser fixture', invite: 'JRay', agree: true, consent: VOICE_CONSENT_TEXT,
      } });
      assert.equal(created.status(), 201);
      const submission = await created.json() as { id: string; token: string };
      for (const format of formats) {
        const uploaded = await context.request.put(`${origin}/voice-submissions/${submission.id}/${format.pass}`, {
          headers: { 'content-type': format.type, 'x-submission-token': submission.token },
          data: readFileSync(join(temporary, `sample.${format.extension}`)),
        });
        assert.equal(uploaded.status(), 200);
      }
      const finished = await context.request.post(`${origin}/voice-submissions/${submission.id}/finish`, {
        headers: { 'x-submission-token': submission.token },
      });
      assert.equal(finished.status(), 200);
      await page.getByRole('button', { name: 'Refresh recordings' }).click();
      await page.waitForFunction(() => document.querySelectorAll('audio').length >= 3);
      const playback: object[] = [];
      for (const format of formats) {
        const player = page.locator(`audio[src$="/${submission.id}/${format.pass}"]`);
        await player.evaluate(async (audio) => {
          await (audio as HTMLAudioElement).play();
        });
        await page.waitForFunction((pass) => {
          const audio = document.querySelector(`audio[src$="/${pass}"]`) as HTMLAudioElement;
          return audio.currentTime > 0 && Number.isFinite(audio.duration);
        }, format.pass);
        const state = await player.evaluate((element) => {
          const audio = element as HTMLAudioElement;
          audio.pause(); audio.currentTime = 1.5;
          return { duration: audio.duration, error: audio.error?.message ?? null };
        });
        assert.equal(state.error, null);
        assert.ok(state.duration > 2.5);
        await page.waitForFunction((pass) => {
          const audio = document.querySelector(`audio[src$="/${pass}"]`) as HTMLAudioElement;
          return !audio.seeking && Math.abs(audio.currentTime - 1.5) < .1;
        }, format.pass);
        playback.push({ format: format.extension, ...state, seek: 1.5 });
      }
      const download = page.locator(`a[href$="/${submission.id}/hit-hurt"]`);
      const downloaded = page.waitForEvent('download');
      await download.click();
      assert.equal((await downloaded).suggestedFilename(), 'hit-hurt.wav');
      await page.screenshot({ path: join(output, `${engine}-desktop.png`), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: join(output, `${engine}-mobile.png`), fullPage: true });
      await page.getByRole('button', { name: 'Sign out' }).click();
      await page.waitForFunction(() => document.querySelector('#status')?.textContent?.startsWith('Signed out'));
      assert.equal(await page.locator('audio').count(), 0);
      assert.equal((await context.request.get(`${origin}/voice-review/clips/${submission.id}/hit-hurt`)).status(), 401);
      assert.deepEqual(errors, []);
      results.push({ engine, playback, logout: 'revoked', overflow: false, pageErrors: errors });
      await context.close();
      rmSync(join(temporary, 'submissions', submission.id), { recursive: true, force: true });
    } finally { await browser.close(); }
  }
  writeFileSync(join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(temporary, { recursive: true, force: true });
}
