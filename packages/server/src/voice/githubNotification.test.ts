import { afterEach, expect, it, vi } from 'vitest';
import { githubVoiceNotification } from './githubNotification.ts';

afterEach(() => vi.unstubAllGlobals());

it('dispatches only the submission ID and count; rejects failed delivery', async () => {
  const send = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, status: 403 });
  vi.stubGlobal('fetch', send);
  const notify = githubVoiceNotification('private-token');
  const submission = { id: 'a'.repeat(32), name: 'Mia', clips: 2 };
  await notify(submission);
  const [url, init] = send.mock.calls[0]!;
  expect(url).toBe('https://api.github.com/repos/JoshuaLRay/Sandline/dispatches');
  expect(JSON.parse(init.body)).toEqual({ event_type: 'voice-submission-finished', client_payload: { id: submission.id, clips: 2 } });
  await expect(notify(submission)).rejects.toThrow('403');
});
