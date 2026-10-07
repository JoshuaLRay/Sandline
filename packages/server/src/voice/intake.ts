/** Private, invite-only intake. Source reads are available only to the separate owner review service. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { VOICES, VOICE_CONSENT_TEXT, VOICE_RECORDING_LINES, passFile, passLines, type VoiceContributorSubmission } from '@sandline/shared';

const PASSES = new Set(VOICES.sections.flatMap((s) => (['normal', 'shout', 'hurt'] as const)
  .filter((style) => passLines(s, style).length > 0).map((style) => passFile(s.id, style))));
const TYPES: Record<string, string> = {
  'audio/webm': '.webm', 'audio/mp4': '.m4a', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
};
const MAX_CLIP = 8 * 1024 * 1024;
const MAX_TOTAL = 100 * 1024 * 1024;
const MAX_STORED = 256 * 1024 * 1024;
const CONSENT = VOICE_CONSENT_TEXT;
const LINES = new Set(VOICE_RECORDING_LINES.map((line) => line.id));

export interface VoiceIntakeOptions {
  dir: string; inviteKey: string; origin: string;
  onFinished?: (submission: { id: string; name: string; clips: number }) => Promise<void>;
}
interface Submission { id: string; tokenHash: string; name: string; agreedAt: string; consent: string; clips: Record<string, { bytes: number; file: string; line?: string; savedAt?: string }>; complete: boolean; notifiedAt?: string }
export type ReviewSubmission = VoiceContributorSubmission;

function equal(a: string, b: string): boolean {
  const aa = createHash('sha256').update(a).digest();
  const bb = createHash('sha256').update(b).digest();
  return timingSafeEqual(aa, bb);
}
function json(res: ServerResponse, code: number, body: object): void {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const piece of req) {
    const chunk = Buffer.from(piece as Buffer);
    size += chunk.length;
    // Drain an oversized request without keeping its bytes, so the caller receives a useful 413.
    if (size <= limit) chunks.push(chunk);
  }
  if (size > limit) throw new Error('Recording is too large');
  return Buffer.concat(chunks);
}

/** Configured only on the dedicated intake host, backed by its persistent private volume. */
export class VoiceIntake {
  private readonly starts = new Map<string, { count: number; since: number }>();
  private readonly notifications = new Map<string, Promise<boolean>>();
  constructor(private readonly options: VoiceIntakeOptions) {
    if (!options.dir || !options.inviteKey || !/^https?:\/\/[^/]+$/.test(options.origin)) throw new Error('Voice intake needs a directory, invite key and a site origin');
    mkdirSync(options.dir, { recursive: true, mode: 0o700 });
  }
  private path(id: string): string { return join(this.options.dir, id); }
  private read(id: string): Submission | null {
    if (!/^[a-f0-9]{32}$/.test(id)) return null;
    const file = join(this.path(id), 'submission.json');
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Submission : null;
  }
  private save(s: Submission): void {
    const file = join(this.path(s.id), 'submission.json');
    const temp = `${file}.tmp`;
    writeFileSync(temp, JSON.stringify(s, null, 2), { mode: 0o600 });
    renameSync(temp, file);
  }
  private authorized(req: IncomingMessage, id: string): Submission | null {
    const s = this.reviewRead(id);
    const token = req.headers['x-submission-token'];
    return s && typeof token === 'string' && equal(createHash('sha256').update(token).digest('hex'), s.tokenHash) ? s : null;
  }
  private metadata(s: Submission): ReviewSubmission {
    return { id: s.id, name: s.name, agreedAt: s.agreedAt, complete: s.complete,
      clips: Object.entries(s.clips).flatMap(([pass, stored]) => {
        const clip = this.reviewClip(s.id, pass);
        return clip ? [{ pass, bytes: clip.bytes, type: clip.type,
          ...(stored.line ? { line: stored.line } : {}), ...(stored.savedAt ? { savedAt: stored.savedAt } : {}) }] : [];
      }).sort((a, b) => (a.savedAt ?? '').localeCompare(b.savedAt ?? '') || a.pass.localeCompare(b.pass)),
    };
  }
  /** Notification is secondary to durable audio; concurrent takes share one dispatch. */
  private async notify(s: Submission): Promise<boolean> {
    if (!this.options.onFinished || s.notifiedAt) return true;
    const pending = this.notifications.get(s.id);
    if (pending) return pending;
    const delivery = (async () => {
      try {
        await this.options.onFinished!({ id: s.id, name: s.name, clips: Object.keys(s.clips).length });
        // Another take may have arrived while the dispatch was in flight.
        const latest = this.read(s.id)!;
        latest.notifiedAt = new Date().toISOString();
        this.save(latest);
        return true;
      } catch { return false; }
    })();
    this.notifications.set(s.id, delivery);
    try { return await delivery; } finally { this.notifications.delete(s.id); }
  }
  /** No secrets or filesystem paths cross the review API. Called only after owner authentication. */
  reviewSubmissions(offset = 0): { submissions: ReviewSubmission[]; total: number } {
    const submissions: ReviewSubmission[] = [];
    for (const id of readdirSync(this.options.dir)) {
      try {
        const s = this.reviewRead(id);
        if (!s) continue;
        submissions.push(this.metadata(s));
      } catch { /* A missing/corrupt submission must not prevent reviewing the others. */ }
    }
    submissions.sort((a, b) => b.agreedAt.localeCompare(a.agreedAt) || a.id.localeCompare(b.id));
    return { submissions: submissions.slice(offset, offset + 50), total: submissions.length };
  }
  private reviewRead(id: string): Submission | null {
    if (!/^[a-f0-9]{32}$/.test(id)) return null;
    const dir = this.path(id);
    if (!existsSync(dir) || !lstatSync(dir).isDirectory()) return null;
    const file = join(dir, 'submission.json');
    if (!existsSync(file) || !lstatSync(file).isFile()) return null;
    const s = this.read(id);
    if (!s || s.id !== id || typeof s.name !== 'string' || typeof s.agreedAt !== 'string' ||
      typeof s.complete !== 'boolean' || !s.clips || typeof s.clips !== 'object') return null;
    return s;
  }
  reviewClip(id: string, pass: string): { path: string; bytes: number; type: string } | null {
    if (!PASSES.has(pass) && !/^take-[a-f0-9]{32}$/.test(pass)) return null;
    const s = this.reviewRead(id);
    const clip = s?.clips[pass];
    if (!clip) return null;
    if (pass.startsWith('take-') && (!clip.line || !LINES.has(clip.line))) return null;
    const format = Object.entries(TYPES).find(([, ext]) => clip.file === `${pass}${ext}`);
    if (!format) return null;
    const path = join(this.path(id), clip.file);
    if (!existsSync(path)) return null;
    const stat = lstatSync(path);
    if (!stat.isFile()) return null;
    return { path, bytes: stat.size, type: format[0] };
  }
  private storedBytes(): number {
    return readdirSync(this.options.dir).reduce((sum, id) => {
      if (!/^[a-f0-9]{32}$/.test(id)) return sum;
      return sum + readdirSync(this.path(id)).reduce((clips, file) => clips + statSync(join(this.path(id), file)).size, 0);
    }, 0);
  }
  /** Contributor reads require their own submission token. There is no public listing. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('vary', 'Origin');
    if (req.headers.origin === this.options.origin) {
      res.setHeader('access-control-allow-origin', this.options.origin);
      res.setHeader('access-control-allow-methods', 'GET, POST, PUT, OPTIONS');
      res.setHeader('access-control-allow-headers', 'Content-Type, X-Submission-Token');
    } else if (req.headers.origin) { json(res, 403, { error: 'Origin is not permitted' }); return; }
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    try {
      if (req.method === 'POST' && req.url === '/voice-submissions') {
        const source = req.socket.remoteAddress ?? 'unknown';
        const now = Date.now();
        const window = this.starts.get(source);
        // A hosting proxy may give several friends the same remote address.
        if (window && now - window.since < 3_600_000 && window.count >= 60) { json(res, 429, { error: 'Too many submissions; try again later' }); return; }
        const data = JSON.parse((await body(req, 4096)).toString('utf8')) as Record<string, unknown>;
        const name = typeof data['name'] === 'string' ? data['name'].trim() : '';
        if (name.length < 1 || name.length > 40 || !/^[\p{L}\p{N} _.-]+$/u.test(name) || data['consent'] !== CONSENT || data['agree'] !== true || typeof data['invite'] !== 'string' || !equal(data['invite'].toLowerCase(), this.options.inviteKey.toLowerCase())) {
          json(res, 400, { error: 'Check your name, invitation and consent before submitting' }); return;
        }
        const id = randomBytes(16).toString('hex');
        const token = randomBytes(32).toString('hex');
        const s: Submission = { id, tokenHash: createHash('sha256').update(token).digest('hex'), name, agreedAt: new Date().toISOString(), consent: CONSENT, clips: {}, complete: false };
        this.starts.set(source, { count: window && now - window.since < 3_600_000 ? window.count + 1 : 1, since: window && now - window.since < 3_600_000 ? window.since : now });
        mkdirSync(this.path(id), { mode: 0o700 });
        this.save(s);
        json(res, 201, { id, token });
        return;
      }
      const listing = /^\/voice-submissions\/([a-f0-9]{32})$/.exec(req.url ?? '');
      if (req.method === 'GET' && listing) {
        const s = this.authorized(req, listing[1]!);
        if (!s) { json(res, 404, { error: 'Submission not found' }); return; }
        json(res, 200, this.metadata(s)); return;
      }
      const playback = /^\/voice-submissions\/([a-f0-9]{32})\/clips\/(take-[a-f0-9]{32})$/.exec(req.url ?? '');
      if (req.method === 'GET' && playback) {
        const s = this.authorized(req, playback[1]!);
        const clip = s && this.reviewClip(s.id, playback[2]!);
        if (!clip) { json(res, 404, { error: 'Recording not found' }); return; }
        res.setHeader('content-type', clip.type);
        res.setHeader('content-length', clip.bytes);
        res.end(readFileSync(clip.path)); return;
      }
      const take = /^\/voice-submissions\/([a-f0-9]{32})\/lines\/([a-z][a-z0-9-]*)\/([a-f0-9]{32})$/.exec(req.url ?? '');
      if (req.method === 'PUT' && take) {
        const id = take[1]!;
        if (!this.authorized(req, id)) { json(res, 404, { error: 'Submission not found' }); return; }
        const line = take[2]!;
        const key = `take-${take[3]!}`;
        const mime = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
        const ext = TYPES[mime];
        if (!LINES.has(line) || !ext) { json(res, 400, { error: 'Unknown script line or audio format' }); return; }
        const bytes = await body(req, MAX_CLIP);
        if (bytes.length < 1000) { json(res, 400, { error: 'Recording is empty or too short' }); return; }
        // Re-read after the asynchronous body: overlapping uploads must not lose each other's metadata.
        const s = this.authorized(req, id);
        if (!s) { json(res, 404, { error: 'Submission not found' }); return; }
        const file = `${key}${ext}`;
        const existing = s.clips[key];
        if (existing) {
          const source = this.reviewClip(id, key);
          if (existing.line !== line || existing.file !== file || !source || !readFileSync(source.path).equals(bytes)) {
            json(res, 409, { error: 'This take is already saved; record a new take instead' }); return;
          }
        } else {
          const total = Object.values(s.clips).reduce((sum, clip) => sum + clip.bytes, bytes.length);
          if (total > MAX_TOTAL) { json(res, 413, { error: 'Submission exceeds size limit' }); return; }
          if (this.storedBytes() + bytes.length > MAX_STORED) { json(res, 507, { error: 'Voice intake is full; contact the owner' }); return; }
          const temp = join(this.path(id), `${file}.tmp`);
          writeFileSync(temp, bytes, { mode: 0o600 });
          renameSync(temp, join(this.path(id), file));
          s.clips[key] = { bytes: bytes.length, file, line, savedAt: new Date().toISOString() };
          s.complete = true; // A single Submit is the complete delivery action.
          this.save(s);
        }
        const stored = s.clips[key]!;
        json(res, 200, { clip: { pass: key, line, bytes: stored.bytes, type: mime, savedAt: stored.savedAt } });
        // Confirm the durable save immediately; an external notification must not delay Submit.
        void this.notify(s);
        return;
      }
      const upload = /^\/voice-submissions\/([a-f0-9]{32})\/([a-z][a-z0-9-]*)$/.exec(req.url ?? '');
      if (req.method === 'PUT' && upload && upload[2] !== 'finish') {
        const s = this.read(upload[1]!);
        const token = req.headers['x-submission-token'];
        if (!s || typeof token !== 'string' || !equal(createHash('sha256').update(token).digest('hex'), s.tokenHash)) { json(res, 404, { error: 'Submission not found' }); return; }
        const pass = upload[2]!;
        const mime = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
        const ext = TYPES[mime];
        if (!PASSES.has(pass) || !ext) { json(res, 400, { error: 'Unknown script pass or audio format' }); return; }
        if (s.complete) { json(res, 409, { error: 'Submission already finished' }); return; }
        const bytes = await body(req, MAX_CLIP);
        if (bytes.length < 1000) { json(res, 400, { error: 'Recording is empty or too short' }); return; }
        const total = Object.entries(s.clips).reduce((sum, [key, clip]) => sum + (key === pass ? 0 : clip.bytes), bytes.length);
        if (total > MAX_TOTAL) { json(res, 413, { error: 'Submission exceeds size limit' }); return; }
        const file = `${pass}${ext}`;
        if (this.storedBytes() - (s.clips[pass]?.bytes ?? 0) + bytes.length > MAX_STORED) { json(res, 507, { error: 'Voice intake is full; contact the owner' }); return; }
        // New uploads replace only their own pass. Files are never named from untrusted input.
        const temp = join(this.path(s.id), `${file}.tmp`);
        writeFileSync(temp, bytes, { mode: 0o600 });
        renameSync(temp, join(this.path(s.id), file));
        s.clips[pass] = { bytes: bytes.length, file };
        this.save(s);
        json(res, 200, { pass, bytes: bytes.length });
        return;
      }
      const finish = /^\/voice-submissions\/([a-f0-9]{32})\/finish$/.exec(req.url ?? '');
      if (req.method === 'POST' && finish) {
        const s = this.read(finish[1]!);
        const token = req.headers['x-submission-token'];
        if (!s || typeof token !== 'string' || !equal(createHash('sha256').update(token).digest('hex'), s.tokenHash)) { json(res, 404, { error: 'Submission not found' }); return; }
        const count = Object.keys(s.clips).length;
        if (!count) { json(res, 400, { error: 'Record at least one section' }); return; }
        if (!s.complete) {
          s.complete = true;
          this.save(s);
        }
        // The completed recording is durable before delivery. A failed dispatch
        // can be retried by Finish without uploading the audio again.
        if (!await this.notify(s)) {
          json(res, 503, { error: 'Recording saved, but notification failed. Tap Finish again to retry.' });
          return;
        }
        json(res, 200, { received: count });
        return;
      }
      json(res, 404, { error: 'Not found' });
    } catch (e) {
      json(res, e instanceof SyntaxError ? 400 : (e as Error).message.includes('too large') ? 413 : 500, { error: e instanceof SyntaxError ? 'Invalid request' : (e as Error).message.includes('too large') ? 'Recording is too large' : 'Upload failed' });
    }
  }
}
