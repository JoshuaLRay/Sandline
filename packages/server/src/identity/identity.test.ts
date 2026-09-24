/**
 * Player identity (T-4.22): issue, verify and rotate; a forged or expired
 * token refused with a typed reason; nothing stored beyond ADR-019's four
 * fields. The host-level half — a Join carrying a token over a session — is
 * `hostIdentity.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { Identity, secretsFromEnv } from './Identity.ts';
import { PLAYER_RETENTION_MS, PlayerDirectory } from './PlayerDirectory.ts';
import { issueToken, newPlayerId, verifyToken } from './token.ts';

const SECRET = 's'.repeat(32);
const OTHER = 'o'.repeat(32);
const DAY_MS = 24 * 60 * 60_000;

function clock(start = 1_750_000_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => void (t += ms) };
}

describe('identity tokens (T-4.22)', () => {
  it('issues a token that verifies to the same player', () => {
    const id = newPlayerId();
    const token = issueToken(id, 1000, 60, SECRET);
    const result = verifyToken(token, 1030, [SECRET]);
    expect(result).toEqual({ ok: true, claims: { playerId: id, issuedAt: 1000, expiresAt: 1060, secretIndex: 0 } });
  });

  it('makes player IDs random and unguessable (22 base64url characters, 128 bits)', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newPlayerId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('refuses an expired token as expired', () => {
    const token = issueToken(newPlayerId(), 1000, 60, SECRET);
    expect(verifyToken(token, 1060, [SECRET])).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses forgeries as bad signature: another secret, a changed ID, a pushed-out expiry', () => {
    const id = newPlayerId();
    const token = issueToken(id, 1000, 60, SECRET);
    expect(verifyToken(issueToken(id, 1000, 60, OTHER), 1030, [SECRET])).toEqual({ ok: false, reason: 'bad signature' });
    const [v, , iat, exp, sig] = token.split('.');
    expect(verifyToken([v, newPlayerId(), iat, exp, sig].join('.'), 1030, [SECRET])).toEqual({ ok: false, reason: 'bad signature' });
    expect(verifyToken([v, id, iat, '99999999', sig].join('.'), 1030, [SECRET])).toEqual({ ok: false, reason: 'bad signature' });
  });

  it('calls a forged token with a past date a forgery, not expired', () => {
    const forged = issueToken(newPlayerId(), 1000, 60, OTHER);
    expect(verifyToken(forged, 5000, [SECRET])).toEqual({ ok: false, reason: 'bad signature' });
  });

  it('refuses garbage as malformed, and a future format as unknown version', () => {
    for (const junk of ['', 'hello', 'v1.a.b.c.d', 'v1.not-an-id.1.2.sig', `v1.${newPlayerId()}.-1.2.sig`, `v1.${newPlayerId()}.1.2.sig.extra`]) {
      expect(verifyToken(junk, 0, [SECRET])).toEqual({ ok: false, reason: 'malformed' });
    }
    const token = issueToken(newPlayerId(), 1000, 60, SECRET);
    expect(verifyToken(token.replace(/^v1/, 'v2'), 1030, [SECRET])).toEqual({ ok: false, reason: 'unknown version' });
  });

  it('verifies under a previous secret and says which', () => {
    const token = issueToken(newPlayerId(), 1000, 60, OTHER);
    const result = verifyToken(token, 1030, [SECRET, OTHER]);
    expect(result.ok && result.claims.secretIndex).toBe(1);
  });
});

describe('Identity.admit (T-4.22)', () => {
  it('issues a new player to a Join with no token, and binds the display name', () => {
    const c = clock();
    const identity = new Identity({ secrets: [SECRET], now: c.now });
    const first = identity.admit('', 'ray');
    expect(first).toMatchObject({ ok: true, issued: true, rotated: false });
    if (!first.ok) throw new Error('unreachable');
    expect(identity.directory.get(first.playerId)).toEqual({ id: first.playerId, name: 'ray', firstSeen: c.now(), lastSeen: c.now() });
  });

  it('knows a returning player by their token, hands the same token back, and rebinds a new name', () => {
    const c = clock();
    const identity = new Identity({ secrets: [SECRET], now: c.now });
    const first = identity.admit('', 'ray');
    if (!first.ok) throw new Error('unreachable');
    const joinedAt = c.now();
    c.advance(DAY_MS);
    const again = identity.admit(first.token, 'ray-2');
    expect(again).toEqual({ ok: true, playerId: first.playerId, token: first.token, issued: false, rotated: false });
    expect(identity.directory.get(first.playerId)).toEqual({ id: first.playerId, name: 'ray-2', firstSeen: joinedAt, lastSeen: c.now() });
    expect(identity.directory.size).toBe(1);
  });

  it('rotates a token past its rotation age: same player, new token, later expiry', () => {
    const c = clock();
    const identity = new Identity({ secrets: [SECRET], now: c.now, rotateAfterS: 7 * 24 * 3600 });
    const first = identity.admit('', 'ray');
    if (!first.ok) throw new Error('unreachable');
    c.advance(8 * DAY_MS);
    const again = identity.admit(first.token, 'ray');
    expect(again).toMatchObject({ ok: true, playerId: first.playerId, issued: false, rotated: true });
    if (!again.ok) throw new Error('unreachable');
    expect(again.token).not.toBe(first.token);
    const nowS = Math.floor(c.now() / 1000);
    const before = verifyToken(first.token, nowS, [SECRET]);
    const after = verifyToken(again.token, nowS, [SECRET]);
    if (!before.ok || !after.ok) throw new Error('unreachable');
    expect(after.claims.expiresAt).toBeGreaterThan(before.claims.expiresAt);
  });

  it('rotates a token signed by a retired secret onto the current one', () => {
    const c = clock();
    const old = new Identity({ secrets: [OTHER], now: c.now });
    const first = old.admit('', 'ray');
    if (!first.ok) throw new Error('unreachable');
    const identity = new Identity({ secrets: [SECRET, OTHER], now: c.now });
    const again = identity.admit(first.token, 'ray');
    expect(again).toMatchObject({ ok: true, playerId: first.playerId, rotated: true });
    if (!again.ok) throw new Error('unreachable');
    // The rotated token needs only the current secret: the old one can go.
    expect(verifyToken(again.token, Math.floor(c.now() / 1000), [SECRET]).ok).toBe(true);
  });

  it('rotates on request', () => {
    const c = clock();
    const identity = new Identity({ secrets: [SECRET], now: c.now });
    const first = identity.admit('', 'ray');
    if (!first.ok) throw new Error('unreachable');
    c.advance(1000);
    const rotated = identity.rotate(first.token);
    expect(rotated).toMatchObject({ ok: true, playerId: first.playerId, rotated: true });
    expect(identity.rotate('forged')).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses a forged or expired token with a typed reason, and records nobody for it', () => {
    const c = clock();
    const identity = new Identity({ secrets: [SECRET], now: c.now, lifetimeS: 60 });
    const stranger = new Identity({ secrets: [OTHER], now: c.now }).admit('', 'mallory');
    if (!stranger.ok) throw new Error('unreachable');
    expect(identity.admit(stranger.token, 'mallory')).toEqual({ ok: false, reason: 'bad signature' });
    const mine = identity.admit('', 'ray');
    if (!mine.ok) throw new Error('unreachable');
    c.advance(61_000);
    expect(identity.admit(mine.token, 'ray')).toEqual({ ok: false, reason: 'expired' });
    expect(identity.directory.size).toBe(1);
  });

  it('falls back to a random per-process secret, whose tokens no other process accepts', () => {
    const a = new Identity();
    const b = new Identity();
    expect(a.durable).toBe(false);
    const issued = a.admit('', 'ray');
    if (!issued.ok) throw new Error('unreachable');
    expect(a.admit(issued.token, 'ray').ok).toBe(true);
    expect(b.admit(issued.token, 'ray')).toEqual({ ok: false, reason: 'bad signature' });
  });

  it('refuses a short secret', () => {
    expect(() => new Identity({ secrets: ['hunter2'] })).toThrow(/at least 32/);
  });

  it('reads IDENTITY_SECRET as a comma-separated list', () => {
    expect(secretsFromEnv(undefined)).toEqual([]);
    expect(secretsFromEnv(' a , b ,,')).toEqual(['a', 'b']);
  });
});

describe('PlayerDirectory — only what ADR-019 allows (T-4.22)', () => {
  it('stores the ID, the display name and the seen-times, and nothing else', () => {
    const identity = new Identity({ secrets: [SECRET] });
    const r = identity.admit('', 'ray');
    if (!r.ok) throw new Error('unreachable');
    expect(Object.keys(identity.directory.get(r.playerId) ?? {}).sort()).toEqual(['firstSeen', 'id', 'lastSeen', 'name']);
  });

  it('forgets a player not seen for 180 days', () => {
    const dir = new PlayerDirectory();
    dir.touch('a', 'old', 0);
    dir.touch('b', 'recent', PLAYER_RETENTION_MS);
    expect(dir.prune(PLAYER_RETENTION_MS + 1)).toBe(1);
    expect(dir.get('a')).toBeUndefined();
    expect(dir.get('b')?.name).toBe('recent');
  });
});
