/**
 * Player-identity tokens (T-4.22, ADR-019 decision 3).
 *
 * A player is an anonymous, durable, random ID. The host signs it; the client
 * keeps the token and offers it on every Join. Nothing in a token is personal:
 * the ID, when it was issued, when it expires, and the host's signature.
 *
 *   v1.<player id>.<issued, s>.<expires, s>.<HMAC-SHA256, base64url>
 *
 * HMAC rather than a public-key signature because the host is the only party
 * that ever verifies one. The comparison is constant-time, so a forger cannot
 * learn the signature a byte at a time.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOKEN_VERSION = 'v1';

/** 128 random bits, base64url: 22 characters. */
const PLAYER_ID_BYTES = 16;
const PLAYER_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const SECONDS = /^(0|[1-9][0-9]{0,11})$/;

/**
 * Why a token was refused, as a type (T-1.5.04's rule for every refusal). The
 * host logs it and sends it as the Disconnect's detail beside `bad identity`.
 */
export type TokenRefusal = 'malformed' | 'unknown version' | 'bad signature' | 'expired';

export interface TokenClaims {
  playerId: string;
  /** Unix seconds. */
  issuedAt: number;
  expiresAt: number;
  /** Index into the verifying secrets of the one that signed it; 0 is current. */
  secretIndex: number;
}

export type VerifyResult = { ok: true; claims: TokenClaims } | { ok: false; reason: TokenRefusal };

/** A new random player ID. */
export function newPlayerId(): string {
  return randomBytes(PLAYER_ID_BYTES).toString('base64url');
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64url');
}

function signatureMatches(offered: string, expected: string): boolean {
  const a = Buffer.from(offered, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Sign `playerId` for `lifetimeS` seconds from `nowS`. */
export function issueToken(playerId: string, nowS: number, lifetimeS: number, secret: string): string {
  if (!PLAYER_ID_PATTERN.test(playerId)) throw new Error(`not a player id: '${playerId}'`);
  const body = `${TOKEN_VERSION}.${playerId}.${nowS}.${nowS + lifetimeS}`;
  return `${body}.${sign(body, secret)}`;
}

/**
 * Check a token against the host's secrets: the current one first, then any
 * previous ones still being honoured while their tokens rotate out.
 *
 * The signature is checked before the expiry, so an expired token is only
 * ever reported as expired if the host really issued it: a forgery with a
 * past date is a forgery.
 */
export function verifyToken(token: string, nowS: number, secrets: readonly string[]): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 5) return { ok: false, reason: 'malformed' };
  const [version, playerId, issued, expires, signature] = parts as [string, string, string, string, string];
  if (version !== TOKEN_VERSION) return { ok: false, reason: 'unknown version' };
  if (!PLAYER_ID_PATTERN.test(playerId) || !SECONDS.test(issued) || !SECONDS.test(expires)) {
    return { ok: false, reason: 'malformed' };
  }
  const body = `${version}.${playerId}.${issued}.${expires}`;
  const secretIndex = secrets.findIndex((s) => signatureMatches(signature, sign(body, s)));
  if (secretIndex < 0) return { ok: false, reason: 'bad signature' };
  const issuedAt = Number(issued);
  const expiresAt = Number(expires);
  if (expiresAt <= nowS) return { ok: false, reason: 'expired' };
  return { ok: true, claims: { playerId, issuedAt, expiresAt, secretIndex } };
}
