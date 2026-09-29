import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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
