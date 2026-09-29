/** Private, invite-only intake for consented source recordings. Never serves recordings. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { VOICES, VOICE_CONSENT_TEXT, passFile, passLines } from '@sandline/shared';

const PASSES = new Set(VOICES.sections.flatMap((s) => (['normal', 'shout', 'hurt'] as const)
  .filter((style) => passLines(s, style).length > 0).map((style) => passFile(s.id, style))));
const TYPES: Record<string, string> = {
  'audio/webm': '.webm', 'audio/mp4': '.m4a', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
};
const MAX_CLIP = 8 * 1024 * 1024;
const MAX_TOTAL = 100 * 1024 * 1024;
const MAX_STORED = 256 * 1024 * 1024;
const CONSENT = VOICE_CONSENT_TEXT;

export interface VoiceIntakeOptions {
  dir: string; inviteKey: string; origin: string;
  onFinished?: (submission: { id: string; name: string; clips: number }) => Promise<void>;
}
interface Submission { id: string; tokenHash: string; name: string; agreedAt: string; consent: string; clips: Record<string, { bytes: number; file: string }>; complete: boolean; notifiedAt?: string }

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
    if (size > limit) throw new Error('Recording is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Configured only on the dedicated intake host, backed by its persistent private volume. */
export class VoiceIntake {
  private readonly starts = new Map<string, { count: number; since: number }>();
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
  private storedBytes(): number {
    return readdirSync(this.options.dir).reduce((sum, id) => {
      if (!/^[a-f0-9]{32}$/.test(id)) return sum;
      return sum + readdirSync(this.path(id)).reduce((clips, file) => clips + statSync(join(this.path(id), file)).size, 0);
    }, 0);
  }
  /** Handles OPTIONS/POST/PUT only. No public reads of private source audio. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('vary', 'Origin');
    if (req.headers.origin === this.options.origin) {
      res.setHeader('access-control-allow-origin', this.options.origin);
      res.setHeader('access-control-allow-methods', 'POST, PUT, OPTIONS');
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
        if (this.options.onFinished && !s.notifiedAt) {
          try {
            await this.options.onFinished({ id: s.id, name: s.name, clips: count });
            s.notifiedAt = new Date().toISOString();
            this.save(s);
          } catch {
            json(res, 503, { error: 'Recording saved, but notification failed. Tap Finish again to retry.' });
            return;
          }
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
