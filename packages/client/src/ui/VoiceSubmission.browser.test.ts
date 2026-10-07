import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VOICE_RECORDING_LINES, type VoiceSavedClip } from '@sandline/shared';
import { showVoiceSubmission } from './VoiceSubmission.ts';

const HOST = 'wss://voice.example';
const ID = 'a'.repeat(32);
const TOKEN = 'b'.repeat(64);
const STORAGE_KEY = 'sandline.voice-submission.https://voice.example';
const saved = new Map<string, VoiceSavedClip>();
let failAfterSave = false;
const trackStop = vi.fn();
const microphone = { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream;

class Recorder {
  static isTypeSupported(type: string): boolean { return type === 'audio/webm'; }
  state = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start(): void { this.state = 'recording'; }
  stop(): void {
    this.state = 'inactive';
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob([new Uint8Array(1400)], { type: 'audio/webm' }) });
      this.onstop?.();
    });
  }
}

const response = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
  if (init?.method === 'POST') return response({ id: ID, token: TOKEN }, 201);
  if (init?.method === 'PUT') {
    const match = /\/lines\/([^/]+)\/([a-f0-9]{32})$/.exec(url)!;
    const pass = `take-${match[2]}`;
    const clip = { pass, line: match[1]!, bytes: 1400, type: 'audio/webm' };
    saved.set(pass, clip);
    if (failAfterSave) { failAfterSave = false; throw new Error('Connection lost'); }
    return response({ clip });
  }
  if (url.includes('/clips/')) return new Response(new Uint8Array(1400), { headers: { 'content-type': 'audio/webm' } });
  return response({ id: ID, name: 'Mia', agreedAt: '2026-10-06', complete: saved.size > 0, clips: [...saved.values()] });
});

const button = (text: string): HTMLButtonElement => [...document.querySelectorAll('button')].find((el) => el.textContent === text)!;
const record = (): HTMLButtonElement => document.querySelector('.voice-record')!;
const submit = (): HTMLButtonElement => document.querySelector('.voice-send')!;
const line = (id = 'contact-shout'): HTMLButtonElement => document.querySelector(`[data-line="${id}"]`)!;
const status = (): string => document.querySelector('.voice-status')!.textContent!;
const playButtons = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('.voice-play')];

async function start(): Promise<void> {
  showVoiceSubmission(document.body, HOST);
  document.querySelector<HTMLInputElement>('[aria-label="Your name or nickname"]')!.value = 'Mia';
  document.querySelector<HTMLInputElement>('[aria-label="Invitation code"]')!.value = 'JRay';
  document.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked = true;
  button('Agree and start').click();
  await vi.waitFor(() => expect(document.querySelector<HTMLElement>('.voice-lines')!.hidden).toBe(false));
}

async function take(): Promise<void> {
  record().click();
  await vi.waitFor(() => expect(record().textContent).toBe('Stop'));
  record().click();
  await vi.waitFor(() => expect(record().textContent).toBe('Record'));
}
async function send(): Promise<void> {
  submit().click();
  await vi.waitFor(() => expect(submit().textContent).toBe('Submit'));
}

beforeEach(() => {
  saved.clear();
  failAfterSave = false;
  fetchMock.mockClear();
  trackStop.mockClear();
  localStorage.removeItem(STORAGE_KEY);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('MediaRecorder', Recorder);
  vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(microphone);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  button('Back to game')?.click();
  document.body.replaceChildren();
  localStorage.removeItem(STORAGE_KEY);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('individual voice contributions', () => {
  it('lists every line with counts and opens quoted prompts, directions and one-step Submit', async () => {
    await start();
    expect(document.querySelectorAll('.voice-line')).toHaveLength(VOICE_RECORDING_LINES.length);
    expect(line().textContent).toContain('0 saved');
    line().click();
    expect(document.querySelector('blockquote')!.textContent).toBe('“Contact!”');
    expect(document.querySelector('.voice-direction')!.textContent).toContain('(shouted;');
    expect(submit().disabled).toBe(true);
    await take();
    expect(playButtons()).toHaveLength(1);
    expect(line().textContent).toContain('0 saved · 1 not submitted');
    await send();
    expect(line().textContent).toContain('1 saved');
    expect(document.querySelector('.voice-takes')!.textContent).toContain('Saved');
    expect(saved.size).toBe(1);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/finish'))).toBe(false);
    expect([...document.querySelectorAll('button')].some((el) => /Upload|Finish/.test(el.textContent!))).toBe(false);
    button('All lines').click();
    line('dying-sigh-hurt').click();
    expect(document.querySelector('.voice-direction')!.textContent).toContain('last breath');
  });

  it('keeps drafts while changing lines and retains 24 saved recordings across reopening', async () => {
    await start();
    line().click();
    await take();
    button('All lines').click();
    line('roger-normal').click();
    expect(playButtons()).toHaveLength(0);
    await take();
    button('All lines').click();
    line().click();
    expect(playButtons()).toHaveLength(1);
    await send();
    for (let i = 1; i < 24; i += 1) { await take(); await send(); }
    expect(line().textContent).toContain('24 saved');
    expect(line('roger-normal').textContent).toContain('0 saved · 1 not submitted');
    expect(playButtons()).toHaveLength(24);
    const list = document.querySelector<HTMLElement>('.voice-takes')!;
    expect(getComputedStyle(list).overflowY).toBe('auto');
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
    button('Back to game').click();
    showVoiceSubmission(document.body, HOST);
    await vi.waitFor(() => expect(line().textContent).toContain('24 saved'));
    expect(document.querySelector('h2')!.textContent).toBe('Lines for Mia');
    line().click();
    expect(playButtons()).toHaveLength(24);
    playButtons()[0]!.click();
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('/clips/'))).toBe(true));
    await vi.waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
  }, 15_000);

  it('retains failed submissions and retries the same take without an inflated saved count', async () => {
    await start();
    line().click();
    await take();
    failAfterSave = true;
    await send();
    expect(status()).toContain('Your take is still here');
    expect(submit().disabled).toBe(false);
    expect(line().textContent).toContain('0 saved · 1 not submitted');
    expect(document.querySelector('.voice-takes')!.textContent).toContain('Save failed');
    await send();
    expect(line().textContent).toContain('1 saved');
    expect(saved.size).toBe(1);
    const uploads = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect(uploads[0]![0]).toBe(uploads[1]![0]);
  });
  it('submits every pending take for the selected line with one tap', async () => {
    await start();
    line().click();
    await take();
    await take();
    expect(line().textContent).toContain('0 saved · 2 not submitted');
    await send();
    expect(saved.size).toBe(2);
    expect(line().textContent).toContain('2 saved');
    expect(submit().disabled).toBe(true);
  });

  it('pauses and blocks listening throughout microphone acquisition, recording and stopping', async () => {
    await start();
    line().click();
    await take();
    playButtons()[0]!.click();
    await vi.waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));
    let resolve!: (value: MediaStream) => void;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    record().click();
    record().click();
    expect(record().disabled).toBe(true);
    expect(playButtons().every((el) => el.disabled)).toBe(true);
    expect(button('All lines').disabled).toBe(true);
    expect(submit().disabled).toBe(true);
    expect(document.querySelector<HTMLAudioElement>('audio')!.controls).toBe(false);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    resolve(microphone);
    await vi.waitFor(() => expect(record().textContent).toBe('Stop'));
    playButtons()[0]!.click();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    record().click();
    expect(playButtons()[0]!.disabled).toBe(true);
    await vi.waitFor(() => expect(record().textContent).toBe('Record'));
    expect(playButtons().every((el) => !el.disabled)).toBe(true);
    expect(document.querySelector<HTMLAudioElement>('audio')!.controls).toBe(true);
    expect(trackStop).toHaveBeenCalledTimes(2);
  });

  it('recovers denied permission and stops a late microphone grant after closing the page', async () => {
    await start();
    line().click();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(new Error('Permission denied'));
    record().click();
    await vi.waitFor(() => expect(status()).toContain('Permission denied'));
    expect(record().disabled).toBe(false);
    expect(button('All lines').disabled).toBe(false);
    let resolve!: (value: MediaStream) => void;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    record().click();
    button('Back to game').click();
    resolve(microphone);
    await vi.waitFor(() => expect(trackStop).toHaveBeenCalledTimes(1));
    expect(document.querySelector('.voice-submit')).toBeNull();
  });
});
