/** Same-origin, owner-only review. No contributor token or invitation can authorize a read. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants, createReadStream, openSync, closeSync, fstatSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { VoiceIntake } from './intake.ts';
import { REVIEW_HTML, REVIEW_SCRIPT, REVIEW_STYLE } from './reviewPage.ts';

const OWNER_ID = 127329846; // JoshuaLRay: stable identity, independent of a renamed login.
const SESSION_COOKIE = '__Host-sandline-voice-owner';
const STATE_COOKIE = '__Host-sandline-voice-state';
const SESSION_MS = 8 * 60 * 60 * 1000;
const STATE_MS = 10 * 60 * 1000;

export interface VoiceReviewOptions {
  intake: VoiceIntake; publicOrigin: string; clientId: string; clientSecret: string;
  /** Inject a provider transport in tests; production always uses GitHub's fixed HTTPS endpoints. */
  fetch?: typeof fetch;
  now?: () => number;
}

function json(res: ServerResponse, status: number, value: object): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(value));
}
function cookie(req: IncomingMessage, name: string): string {
  return (req.headers.cookie ?? '').split(';').map((v) => v.trim()).find((v) => v.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';
}
function matches(a: string, b: string): boolean {
  return /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export class VoiceReview {
  private readonly pending = new Map<string, { expires: number; verifier: string }>();
  private readonly sessions = new Map<string, number>();
  private readonly transport: typeof fetch;
  private readonly now: () => number;
  constructor(private readonly options: VoiceReviewOptions) {
    const origin = new URL(options.publicOrigin);
    if (origin.protocol !== 'https:' || origin.origin !== options.publicOrigin) throw new Error('VOICE_REVIEW_ORIGIN must be an HTTPS origin');
    if (!options.clientId || !options.clientSecret) throw new Error('Voice review needs GitHub OAuth credentials');
    this.transport = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }
  private setCookie(res: ServerResponse, name: string, value: string, seconds: number): void {
    // __Host- cookies are Secure, host-only and Path=/ by definition.
    res.appendHeader('set-cookie', `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`);
  }
  private redirect(res: ServerResponse, target: string): void {
    res.statusCode = 303;
    res.setHeader('location', target);
    res.end();
  }
  private authorized(req: IncomingMessage): boolean {
    const token = cookie(req, SESSION_COOKIE);
    return /^[a-f0-9]{64}$/.test(token) && (this.sessions.get(token) ?? 0) > this.now();
  }
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('cache-control', 'private, no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('cross-origin-resource-policy', 'same-origin');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    // No CORS. Review runs on the host itself, including native <audio> requests.
    if (req.headers.origin && req.headers.origin !== this.options.publicOrigin) {
      json(res, 403, { error: 'Origin is not permitted' }); return;
    }
    for (const [key, value] of this.pending) if (value.expires <= this.now()) this.pending.delete(key);
    for (const [key, expires] of this.sessions) if (expires <= this.now()) this.sessions.delete(key);
    const url = new URL(req.url ?? '/', this.options.publicOrigin);
    const path = url.pathname;
    try {
      if (req.method === 'GET' && ['/voice-review', '/voice-review/', '/voice-review/app.js', '/voice-review/style.css'].includes(path)) {
        res.setHeader('content-type', path.endsWith('.js') ? 'text/javascript; charset=utf-8' : path.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
        res.end(path.endsWith('.js') ? REVIEW_SCRIPT : path.endsWith('.css') ? REVIEW_STYLE : REVIEW_HTML);
        return;
      }
      if (req.method === 'GET' && path === '/voice-review/login') {
        if (this.pending.size >= 100) { json(res, 429, { error: 'Too many login attempts. Try again later.' }); return; }
        const state = randomBytes(32).toString('hex');
        const verifier = randomBytes(32).toString('base64url');
        this.pending.set(state, { expires: this.now() + STATE_MS, verifier });
        this.setCookie(res, STATE_COOKIE, state, STATE_MS / 1000);
        const authorize = new URL('https://github.com/login/oauth/authorize');
        authorize.search = new URLSearchParams({ client_id: this.options.clientId,
          redirect_uri: `${this.options.publicOrigin}/voice-review/callback`, state,
          code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
        }).toString();
        this.redirect(res, authorize.href); return;
      }
      if (req.method === 'GET' && path === '/voice-review/callback') {
        const state = url.searchParams.get('state') ?? '';
        const pending = this.pending.get(state);
        const valid = pending && matches(state, cookie(req, STATE_COOKIE));
        this.setCookie(res, STATE_COOKIE, '', 0);
        if (!valid || !url.searchParams.get('code') || url.searchParams.has('error')) {
          this.redirect(res, '/voice-review?error=login'); return;
        }
        this.pending.delete(state); // A code/state pair is usable only once, even if GitHub fails.
        const exchanged = await this.transport('https://github.com/login/oauth/access_token', {
          method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ client_id: this.options.clientId, client_secret: this.options.clientSecret,
            code: url.searchParams.get('code'), redirect_uri: `${this.options.publicOrigin}/voice-review/callback`, code_verifier: pending.verifier }),
          signal: AbortSignal.timeout(8000),
        });
        if (!exchanged.ok) throw new Error('OAuth exchange failed');
        const data = await exchanged.json() as { access_token?: unknown };
        if (typeof data.access_token !== 'string' || !data.access_token) throw new Error('OAuth exchange failed');
        const user = await this.transport('https://api.github.com/user', {
          headers: { authorization: `Bearer ${data.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'Sandline-voice-review' },
          signal: AbortSignal.timeout(8000),
        });
        if (!user.ok) throw new Error('GitHub account lookup failed');
        const identity = await user.json() as { id?: unknown };
        if (identity.id !== OWNER_ID) { this.redirect(res, '/voice-review?error=owner'); return; }
        // The GitHub access token is never stored or sent to the browser.
        if (this.sessions.size >= 100) this.sessions.delete(this.sessions.keys().next().value!);
        const session = randomBytes(32).toString('hex');
        this.sessions.set(session, this.now() + SESSION_MS);
        this.setCookie(res, SESSION_COOKIE, session, SESSION_MS / 1000);
        this.redirect(res, '/voice-review'); return;
      }
      if (req.method === 'POST' && path === '/voice-review/logout') {
        if (req.headers.origin !== this.options.publicOrigin) { json(res, 403, { error: 'Origin is not permitted' }); return; }
        this.sessions.delete(cookie(req, SESSION_COOKIE));
        this.setCookie(res, SESSION_COOKIE, '', 0);
        json(res, 200, { signedOut: true }); return;
      }
      if (!this.authorized(req)) { json(res, 401, { error: 'Sign in with the owner GitHub account to review recordings.' }); return; }
      if (req.method === 'GET' && path === '/voice-review/submissions') {
        const raw = url.searchParams.get('offset') ?? '0';
        if (!/^\d{1,7}$/.test(raw)) { json(res, 400, { error: 'Invalid page' }); return; }
        json(res, 200, this.options.intake.reviewSubmissions(Number(raw))); return;
      }
      const clip = /^\/voice-review\/clips\/([a-f0-9]{32})\/([a-z][a-z0-9-]*)$/.exec(path);
      if (clip && (req.method === 'GET' || req.method === 'HEAD')) {
        const source = this.options.intake.reviewClip(clip[1]!, clip[2]!);
        if (!source) { json(res, 404, { error: 'Recording not found' }); return; }
        this.stream(req, res, source); return;
      }
      json(res, 404, { error: 'Not found' });
    } catch {
      if (path === '/voice-review/callback') this.redirect(res, '/voice-review?error=login');
      else if (!res.headersSent) json(res, 500, { error: 'Could not load recordings. Try again.' });
      else res.destroy();
    }
  }
  private stream(req: IncomingMessage, res: ServerResponse, source: { path: string; type: string }): void {
    const fd = openSync(source.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const size = fstatSync(fd).size;
    let start = 0;
    let end = size - 1;
    const range = req.headers.range;
    res.setHeader('accept-ranges', 'bytes');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match && (match[1] || match[2])) {
        start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
      } else start = size;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size || end < 0) {
        closeSync(fd);
        res.setHeader('content-range', `bytes */${size}`);
        res.statusCode = 416; res.end(); return;
      }
      res.statusCode = 206;
      res.setHeader('content-range', `bytes ${start}-${end}/${size}`);
    }
    res.setHeader('content-type', source.type);
    res.setHeader('content-length', Math.max(0, end - start + 1));
    if (req.method === 'HEAD' || size === 0) { closeSync(fd); res.end(); return; }
    const stream = createReadStream(source.path, { fd, autoClose: true, start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }
}
