import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { VOICE_CONSENT_TEXT, type VoiceContributorSubmission } from '@sandline/shared';
import { VoiceIntake } from './intake.ts';
import { VoiceReview } from './review.ts';
import { SessionHost } from '../session/SessionHost.ts';

const ORIGIN = 'https://sandline-host.fly.dev';
let server: Server;
let dir: string;
let url: string;
let intake: VoiceIntake;
let review: VoiceReview;
let clock: number;
let owner: number;
let tokenFails: boolean;
let provider: ReturnType<typeof vi.fn<typeof fetch>>;

/** A decodable 100 ms PCM WAV, rather than bytes that merely pass the upload size limit. */
function wav(): Buffer {
  const bytes = Buffer.alloc(44 + 4800 * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(96000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let i = 0; i < 4800; i++) bytes.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 48000) * 2000), 44 + i * 2);
  return bytes;
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sandline-review-'));
  clock = Date.now(); owner = 127329846; tokenFails = false;
  intake = new VoiceIntake({ dir, inviteKey: 'JRay', origin: 'https://joshualray.github.io' });
  provider = vi.fn<typeof fetch>(async (target) => {
    if (String(target).endsWith('/access_token')) return Response.json(tokenFails ? { error: 'bad_code' } : { access_token: 'private-test-token' });
    return Response.json({ id: owner, login: owner === 127329846 ? 'JoshuaLRay' : 'another-user' });
  });
  review = new VoiceReview({ intake, publicOrigin: ORIGIN, clientId: 'test-client', clientSecret: 'private-test-secret', fetch: provider, now: () => clock });
  server = createServer((req, res) => void (req.url?.startsWith('/voice-review') ? review : intake).handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  url = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});
async function startLogin(): Promise<{ state: string; cookie: string }> {
  const start = await fetch(`${url}/voice-review/login`, { redirect: 'manual' });
  const authorization = new URL(start.headers.get('location')!);
  expect(authorization.origin).toBe('https://github.com');
  expect(authorization.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/voice-review/callback`);
  expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
  expect(start.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=Lax');
  return { state: authorization.searchParams.get('state')!, cookie: start.headers.get('set-cookie')!.split(';')[0]! };
}
async function finishLogin(start: { state: string; cookie: string }): Promise<Response> {
  return fetch(`${url}/voice-review/callback?code=test-code&state=${start.state}`, { headers: { cookie: start.cookie }, redirect: 'manual' });
}
async function signIn(): Promise<string> {
  const callback = await finishLogin(await startLogin());
  expect(callback.headers.get('location')).toBe('/voice-review');
  const cookie = callback.headers.getSetCookie().find((v) => v.startsWith('__Host-sandline-voice-owner='))!.split(';')[0]!;
  expect(cookie).toMatch(/^__Host-sandline-voice-owner=[a-f0-9]{64}$/);
  return cookie;
}
async function submission(finish = true): Promise<{ id: string; token: string }> {
  const created = await fetch(`${url}/voice-submissions`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Contributor', invite: 'JRay', agree: true, consent: VOICE_CONSENT_TEXT }) });
  const { id, token } = await created.json() as { id: string; token: string };
  expect((await fetch(`${url}/voice-submissions/${id}/hit-hurt`, { method: 'PUT', headers: { 'content-type': 'audio/wav', 'x-submission-token': token }, body: wav() })).status).toBe(200);
  if (finish) expect((await fetch(`${url}/voice-submissions/${id}/finish`, { method: 'POST', headers: { 'x-submission-token': token } })).status).toBe(200);
  return { id, token };
}
describe('owner voice review', () => {
  it('shares the actual game host port with uploads and health checks while protecting review reads', async () => {
    const host = new SessionHost({ port: 0, autoTick: false, voiceIntake: intake, voiceReview: review,
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } });
    try {
      const port = await host.start();
      const base = `http://127.0.0.1:${port}`;
      expect(await (await fetch(`${base}/voice-review`)).text()).toContain('Saved voice recordings');
      expect((await fetch(`${base}/voice-review/submissions`)).status).toBe(401);
      expect((await fetch(`${base}/healthz`)).status).toBe(200);
      expect((await fetch(`${base}/voice-submissions`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Contributor', invite: 'JRay', agree: true, consent: VOICE_CONSENT_TEXT }) })).status).toBe(201);
    } finally { await host.stop(); }
  });
  it('protects listing and media from anonymous visitors, invite codes and contributor tokens', async () => {
    const s = await submission();
    for (const headers of [{}, { 'x-submission-token': s.token }, { authorization: 'Bearer JRay' }, { cookie: '__Host-sandline-voice-owner=forged' }]) {
      expect((await fetch(`${url}/voice-review/submissions`, { headers })).status).toBe(401);
      expect((await fetch(`${url}/voice-review/clips/${s.id}/hit-hurt`, { headers })).status).toBe(401);
    }
    expect((await fetch(`${url}/voice-submissions/${s.id}/hit-hurt`)).status).toBe(404);
  });
  it('rejects mismatched, missing, expired and replayed OAuth state before contacting GitHub', async () => {
    const start = await startLogin();
    for (const cookie of ['', '__Host-sandline-voice-state=' + 'f'.repeat(64)]) {
      const response = await fetch(`${url}/voice-review/callback?code=test&state=${start.state}`, { headers: { cookie }, redirect: 'manual' });
      expect(response.headers.get('location')).toBe('/voice-review?error=login');
    }
    expect(provider).not.toHaveBeenCalled();
    await finishLogin(start);
    const count = provider.mock.calls.length;
    expect((await finishLogin(start)).headers.get('location')).toBe('/voice-review?error=login');
    expect(provider).toHaveBeenCalledTimes(count);
    const expired = await startLogin(); clock += 10 * 60 * 1000 + 1;
    expect((await finishLogin(expired)).headers.get('location')).toBe('/voice-review?error=login');
  });
  it('rejects a non-owner account and failed exchange without exposing provider errors or secrets', async () => {
    owner = 42;
    const denied = await finishLogin(await startLogin());
    expect(denied.headers.get('location')).toBe('/voice-review?error=owner');
    expect(denied.headers.get('set-cookie')).not.toContain('sandline-voice-owner');
    tokenFails = true;
    expect((await finishLogin(await startLogin())).headers.get('location')).toBe('/voice-review?error=login');
    const page = await (await fetch(`${url}/voice-review`)).text();
    expect(page).not.toContain('private-test');
  });
  it('lists finished and unfinished submissions without tokens or private file paths', async () => {
    const s = await submission();
    await submission(false);
    const cookie = await signIn();
    const response = await fetch(`${url}/voice-review/submissions`, { headers: { cookie } });
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(text).not.toContain(s.token); expect(text).not.toContain('tokenHash'); expect(text).not.toContain(dir);
    const data = JSON.parse(text);
    expect(data.total).toBe(2);
    expect(data.submissions.map((v: { complete: boolean }) => v.complete).sort()).toEqual([false, true]);
    expect(data.submissions[0].clips).toEqual([{ pass: 'hit-hurt', bytes: wav().length, type: 'audio/wav' }]);
    expect((await fetch(`${url}/voice-review/submissions?offset=-1`, { headers: { cookie } })).status).toBe(400);
    expect((await fetch(`${url}/voice-review/submissions?offset=50`, { headers: { cookie } })).status).toBe(200);
  });
  it('plays original WAV bytes and supports HEAD and byte ranges for seeking', async () => {
    const { id } = await submission();
    const cookie = await signIn();
    const clip = `${url}/voice-review/clips/${id}/hit-hurt`;
    const full = await fetch(clip, { headers: { cookie } });
    expect(full.headers.get('content-type')).toBe('audio/wav');
    expect(Buffer.from(await full.arrayBuffer())).toEqual(wav());
    const head = await fetch(clip, { method: 'HEAD', headers: { cookie } });
    expect(head.headers.get('content-length')).toBe(String(wav().length)); expect(await head.text()).toBe('');
    for (const [range, start, end] of [['bytes=44-99', 44, 99], ['bytes=44-', 44, wav().length - 1], ['bytes=-100', wav().length - 100, wav().length - 1]] as const) {
      const response = await fetch(clip, { headers: { cookie, range } });
      expect(response.status).toBe(206);
      expect(response.headers.get('content-range')).toBe(`bytes ${start}-${end}/${wav().length}`);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(wav().subarray(start, end + 1));
    }
    for (const range of ['bytes=999999-', 'bytes=100-20', 'bytes=-0', 'bytes=0-3,5-9', 'invalid']) {
      const response = await fetch(clip, { headers: { cookie, range } });
      expect(response.status).toBe(416); expect(response.headers.get('content-range')).toBe(`bytes */${wav().length}`);
    }
  });
  it('reviews separate line takes with prompts through the existing owner-only streaming route', async () => {
    const s = await submission(false);
    const take = 'c'.repeat(32);
    expect((await fetch(`${url}/voice-submissions/${s.id}/lines/roger-normal/${take}`, { method: 'PUT',
      headers: { 'x-submission-token': s.token, 'content-type': 'audio/wav' }, body: wav() })).status).toBe(200);
    const path = `${url}/voice-review/clips/${s.id}/take-${take}`;
    expect((await fetch(path, { headers: { 'x-submission-token': s.token } })).status).toBe(401);
    const cookie = await signIn();
    const listing = await (await fetch(`${url}/voice-review/submissions`, { headers: { cookie } })).json() as { submissions: VoiceContributorSubmission[] };
    expect(listing.submissions[0]!.clips).toHaveLength(2);
    expect(listing.submissions[0]!.clips[1]).toMatchObject({ pass: `take-${take}`, line: 'roger-normal', type: 'audio/wav' });
    expect(Buffer.from(await (await fetch(path, { headers: { cookie } })).arrayBuffer())).toEqual(wav());
    expect((await (await fetch(`${url}/voice-review/app.js`)).text())).toContain('“Roger!”');
  });
  it('expires sessions, revokes logout and rejects cross-origin requests', async () => {
    const cookie = await signIn();
    expect((await fetch(`${url}/voice-review/submissions`, { headers: { cookie, origin: 'https://evil.example' } })).status).toBe(403);
    expect((await fetch(`${url}/voice-review/logout`, { method: 'POST', headers: { cookie } })).status).toBe(403);
    expect((await fetch(`${url}/voice-review/logout`, { method: 'POST', headers: { cookie, origin: ORIGIN } })).status).toBe(200);
    expect((await fetch(`${url}/voice-review/submissions`, { headers: { cookie } })).status).toBe(401);
    const expired = await signIn(); clock += 8 * 60 * 60 * 1000 + 1;
    expect((await fetch(`${url}/voice-review/submissions`, { headers: { cookie: expired } })).status).toBe(401);
  });
  it('rejects unknown passes, path traversal and symlinked metadata/audio without breaking other submissions', async () => {
    const { id } = await submission();
    const cookie = await signIn();
    expect((await fetch(`${url}/voice-review/clips/${id}/not-scripted`, { headers: { cookie } })).status).toBe(404);
    const metadata = join(dir, id, 'submission.json');
    const original = JSON.parse(readFileSync(metadata, 'utf8'));
    const modified = structuredClone(original); modified.clips['hit-hurt'].file = '../outside.wav';
    writeFileSync(metadata, JSON.stringify(modified));
    expect((await fetch(`${url}/voice-review/clips/${id}/hit-hurt`, { headers: { cookie } })).status).toBe(404);
    writeFileSync(metadata, JSON.stringify(original));
    const audio = join(dir, id, 'hit-hurt.wav'); rmSync(audio); symlinkSync(metadata, audio);
    expect((await fetch(`${url}/voice-review/clips/${id}/hit-hurt`, { headers: { cookie } })).status).toBe(404);
    mkdirSync(join(dir, 'a'.repeat(32))); writeFileSync(join(dir, 'a'.repeat(32), 'submission.json'), 'invalid json');
    const data = await (await fetch(`${url}/voice-review/submissions`, { headers: { cookie } })).json() as { total: number; submissions: { clips: unknown[] }[] };
    expect(data.total).toBe(1); expect(data.submissions[0]!.clips).toEqual([]);
  });
  it('serves a responsive review page with native controls, empty/error states and a restrictive CSP', async () => {
    const page = await fetch(`${url}/voice-review`);
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(await page.text()).toContain('Sign in with GitHub');
    expect((await (await fetch(`${url}/voice-review/app.js`)).text())).toContain('audio.controls=true');
    const cookie = await signIn();
    expect(await (await fetch(`${url}/voice-review/submissions`, { headers: { cookie } })).json()).toEqual({ total: 0, submissions: [] });
  });
});
