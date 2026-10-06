import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { VOICE_CONSENT_TEXT } from '@sandline/shared';
import { VoiceIntake } from './intake.ts';

const ORIGIN = 'https://sandline.example';
const KEY = 'a-private-invitation-code-long-enough';
let server: Server | null = null;
let dir = '';
afterEach(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  server = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

async function setup(key = KEY, onFinished?: (submission: { id: string; name: string; clips: number }) => Promise<void>): Promise<string> {
  dir = mkdtempSync(join(tmpdir(), 'sandline-voice-'));
  const intake = new VoiceIntake({ dir, inviteKey: key, origin: ORIGIN, ...(onFinished ? { onFinished } : {}) });
  server = createServer((req, res) => void intake.handle(req, res));
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${address.port}`;
}

describe('private voice intake', () => {
  async function contributor(url: string): Promise<{ id: string; token: string }> {
    const response = await fetch(`${url}/voice-submissions`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Mia', invite: KEY, agree: true, consent: VOICE_CONSENT_TEXT }) });
    return response.json() as Promise<{ id: string; token: string }>;
  }

  it('immediately saves 24 separate takes, restores counts after restart and makes retries idempotent', async () => {
    const url = await setup();
    const { id, token } = await contributor(url);
    const headers = { origin: ORIGIN, 'x-submission-token': token, 'content-type': 'audio/webm' };
    const put = (n: number, fill = n) => fetch(`${url}/voice-submissions/${id}/lines/contact-shout/${n.toString(16).padStart(32, '0')}`, {
      method: 'PUT', headers, body: Buffer.alloc(1400, fill),
    });
    for (let n = 1; n <= 24; n += 1) expect((await put(n)).status).toBe(200);
    expect((await put(1)).status).toBe(200);
    expect((await put(1, 99)).status).toBe(409);
    const response = await fetch(`${url}/voice-submissions/${id}`, { headers });
    expect(response.status).toBe(200);
    const data = await response.json() as { complete: boolean; clips: { pass: string; line: string }[] };
    expect(data.complete).toBe(true); // No Finish request.
    expect(data.clips).toHaveLength(24);
    expect(data.clips.every((clip) => clip.line === 'contact-shout')).toBe(true);
    const restored = new VoiceIntake({ dir, inviteKey: KEY, origin: ORIGIN });
    expect(restored.reviewSubmissions().submissions[0]!.clips).toHaveLength(24);
    for (let n = 1; n <= 24; n += 1) {
      const key = `take-${n.toString(16).padStart(32, '0')}`;
      expect(readFileSync(restored.reviewClip(id, key)!.path)).toEqual(Buffer.alloc(1400, n));
    }
  });

  it('retains concurrent takes and automatically notifies without treating notification failures as lost audio', async () => {
    const notify = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const url = await setup(KEY, notify);
    const { id, token } = await contributor(url);
    const headers = { origin: ORIGIN, 'x-submission-token': token, 'content-type': 'audio/wav' };
    const put = (n: number) => fetch(`${url}/voice-submissions/${id}/lines/pain-grunt-hurt/${n.toString(16).padStart(32, '0')}`, {
      method: 'PUT', headers, body: Buffer.alloc(1400, n),
    });
    expect((await put(1)).status).toBe(200);
    expect(JSON.parse(readFileSync(join(dir, id, 'submission.json'), 'utf8')).complete).toBe(true);
    const results = await Promise.all([2, 3, 4, 5, 6].map(put));
    expect(results.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
    expect((await put(1)).status).toBe(200);
    const saved = JSON.parse(readFileSync(join(dir, id, 'submission.json'), 'utf8'));
    expect(Object.keys(saved.clips)).toHaveLength(6);
    expect(saved.notifiedAt).toBeDefined();
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('restricts contributor metadata and playback to their own token and validates line takes', async () => {
    const url = await setup();
    const a = await contributor(url);
    const b = await contributor(url);
    const take = '1'.repeat(32);
    const headers = { origin: ORIGIN, 'x-submission-token': a.token };
    const put = (line: string, type = 'audio/webm', bytes = 1400) => fetch(`${url}/voice-submissions/${a.id}/lines/${line}/${take}`, {
      method: 'PUT', headers: { ...headers, 'content-type': type }, body: Buffer.alloc(bytes, 42),
    });
    expect((await put('not-a-line')).status).toBe(400);
    expect((await put('open-fire-normal')).status).toBe(400);
    expect((await put('contact-shout', 'application/octet-stream')).status).toBe(400);
    expect((await put('contact-shout', 'audio/webm', 50)).status).toBe(400);
    expect((await put('contact-shout')).status).toBe(200);
    expect((await put('contact-left-shout')).status).toBe(409);
    const clipUrl = `${url}/voice-submissions/${a.id}/clips/take-${take}`;
    for (const path of [`${url}/voice-submissions/${a.id}`, clipUrl]) {
      for (const auth of ['', 'forged', b.token]) {
        expect((await fetch(path, { headers: { origin: ORIGIN, 'x-submission-token': auth } })).status).toBe(404);
      }
      expect((await fetch(path, { headers: { ...headers, origin: 'https://evil.example' } })).status).toBe(403);
    }
    const listing = await fetch(`${url}/voice-submissions/${a.id}`, { headers });
    const text = await listing.text();
    expect(listing.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(text).not.toContain('tokenHash'); expect(text).not.toContain(a.token); expect(text).not.toContain(dir);
    const audio = await fetch(clipUrl, { headers });
    expect(audio.headers.get('content-type')).toBe('audio/webm');
    expect(audio.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await audio.arrayBuffer())).toEqual(Buffer.alloc(1400, 42));
  });

  it('confirms Submit before a slow owner notification finishes and retains later uploads', async () => {
    let complete!: () => void;
    const notify = vi.fn(() => new Promise<void>((done) => { complete = done; }));
    const url = await setup(KEY, notify);
    const { id, token } = await contributor(url);
    const headers = { origin: ORIGIN, 'x-submission-token': token, 'content-type': 'audio/webm' };
    const put = (n: number) => fetch(`${url}/voice-submissions/${id}/lines/contact-shout/${n.toString(16).padStart(32, '0')}`, {
      method: 'PUT', headers, body: Buffer.alloc(1400, n),
    });
    try {
      expect((await put(1)).status).toBe(200);
      expect((await put(2)).status).toBe(200);
      expect(notify).toHaveBeenCalledTimes(1);
    } finally { complete(); }
    await vi.waitFor(() => expect(JSON.parse(readFileSync(join(dir, id, 'submission.json'), 'utf8')).notifiedAt).toBeDefined());
    expect(Object.keys(JSON.parse(readFileSync(join(dir, id, 'submission.json'), 'utf8')).clips)).toHaveLength(2);
  });
  it('rejects oversized takes and submission totals while preserving previously saved recordings', async () => {
    const url = await setup();
    const { id, token } = await contributor(url);
    const put = (n: number, size: number) => fetch(`${url}/voice-submissions/${id}/lines/roger-normal/${n.toString(16).padStart(32, '0')}`, {
      method: 'PUT', headers: { origin: ORIGIN, 'x-submission-token': token, 'content-type': 'audio/webm' }, body: Buffer.alloc(size, 42),
    });
    expect((await put(1, 1400)).status).toBe(200);
    const tooLarge = await put(2, 8 * 1024 * 1024 + 1);
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({ error: 'Recording is too large' });
    const path = join(dir, id, 'submission.json');
    const s = JSON.parse(readFileSync(path, 'utf8'));
    s.clips[`take-${'1'.padStart(32, '0')}`].bytes = 100 * 1024 * 1024;
    writeFileSync(path, JSON.stringify(s));
    expect((await put(3, 1400)).status).toBe(413);
    expect(Object.keys(JSON.parse(readFileSync(path, 'utf8')).clips)).toHaveLength(1);
    expect(readFileSync(join(dir, id, `take-${'1'.padStart(32, '0')}.webm`))).toEqual(Buffer.alloc(1400, 42));
  });

  it('notifies once when finished, persists completion and retries a failed delivery', async () => {
    const notify = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const url = await setup(KEY, notify);
    const created = await fetch(`${url}/voice-submissions`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Mia', invite: KEY, agree: true, consent: VOICE_CONSENT_TEXT }) });
    const { id, token } = await created.json() as { id: string; token: string };
    const headers = { origin: ORIGIN, 'x-submission-token': token };
    expect((await fetch(`${url}/voice-submissions/${id}/hit-hurt`, { method: 'PUT', headers: { ...headers, 'content-type': 'audio/webm' }, body: Buffer.alloc(1400) })).status).toBe(200);
    const finish = () => fetch(`${url}/voice-submissions/${id}/finish`, { method: 'POST', headers });
    expect((await finish()).status).toBe(503);
    expect(JSON.parse(readFileSync(join(dir, id, 'submission.json'), 'utf8')).complete).toBe(true);
    expect((await finish()).status).toBe(200);
    expect((await finish()).status).toBe(200);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith({ id, name: 'Mia', clips: 1 });
  });
  it('accepts JRay in any capitalization and still rejects a different code', async () => {
    const url = await setup('JRay');
    const send = (invite: string) => fetch(`${url}/voice-submissions`, {
      method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Mia', invite, agree: true, consent: VOICE_CONSENT_TEXT }),
    });
    for (const invite of ['JRay', 'jray', 'JRAY', 'jRaY']) expect((await send(invite)).status).toBe(201);
    expect((await send('JRay2')).status).toBe(400);
  });
  it('stores exact consent and script recordings, but requires invitation and bearer token', async () => {
    const url = await setup();
    const send = (body: object, origin = ORIGIN) => fetch(`${url}/voice-submissions`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const valid = { name: 'Mia', invite: KEY, agree: true, consent: VOICE_CONSENT_TEXT };
    expect((await send({ ...valid, agree: false })).status).toBe(400);
    expect((await send({ ...valid, invite: 'wrong' })).status).toBe(400);
    expect((await send(valid, 'https://other.example')).status).toBe(403);
    const created = await send(valid);
    expect(created.status).toBe(201);
    expect(created.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const { id, token } = await created.json() as { id: string; token: string };
    const put = (pass: string, auth = token, type = 'audio/webm') => fetch(`${url}/voice-submissions/${id}/${pass}`, {
      method: 'PUT', headers: { origin: ORIGIN, 'x-submission-token': auth, 'content-type': type }, body: Buffer.alloc(1400, 42),
    });
    expect((await put('hit-hurt', 'bad')).status).toBe(404);
    expect((await put('not-scripted')).status).toBe(400);
    expect((await put('hit-hurt', token, 'application/octet-stream')).status).toBe(400);
    expect((await put('hit-hurt')).status).toBe(200);
    const saved = JSON.parse(readFileSync(join(dir, id, 'submission.json'), 'utf8')) as { name: string; agreedAt: string; consent: string; complete: boolean; clips: Record<string, unknown> };
    expect(saved).toMatchObject({ name: 'Mia', consent: VOICE_CONSENT_TEXT, complete: false });
    expect(Date.parse(saved.agreedAt)).toBeGreaterThan(0);
    expect(readdirSync(join(dir, id))).toContain('hit-hurt.webm');
    expect((await fetch(`${url}/voice-submissions/${id}/hit-hurt`, { headers: { origin: ORIGIN } })).status).toBe(404);
    expect((await fetch(`${url}/voice-submissions/${id}/finish`, { method: 'POST', headers: { origin: ORIGIN, 'x-submission-token': token } })).status).toBe(200);
    expect((await put('hit-hurt')).status).toBe(409);
  });
});
