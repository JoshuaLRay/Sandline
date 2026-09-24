/**
 * The host's player-identity service (T-4.22, ADR-019 decision 3).
 *
 * Every Join passes through `admit`:
 *   - no token: a new player ID is issued;
 *   - a good token: the same player, and a fresh token for them once theirs is
 *     old, or was signed by a secret being retired (rotation);
 *   - a forged, malformed or expired token: refused with a typed reason. The
 *     client forgets it and joins again without one.
 *
 * The display name typed in the lobby is bound to the ID in the directory.
 * No accounts: ADR-019 leaves linking one to this ID for a later addendum.
 */
import { randomBytes } from 'node:crypto';
import { PlayerDirectory } from './PlayerDirectory.ts';
import { type TokenRefusal, issueToken, newPlayerId, verifyToken } from './token.ts';

const DAY_S = 24 * 60 * 60;
/** A token lives as long as ADR-019 keeps an unvisited player: 180 days. */
export const DEFAULT_TOKEN_LIFETIME_S = 180 * DAY_S;
/** Past this age a token is re-issued on the next Join, so a regular never nears expiry. */
export const DEFAULT_ROTATE_AFTER_S = 7 * DAY_S;
/** Shorter than this and a secret is guessable in a way HMAC cannot help. */
export const MIN_SECRET_LENGTH = 32;

export interface IdentityOptions {
  /**
   * The signing secrets (`IDENTITY_SECRET`). The first signs; every one
   * verifies, so an old secret can be kept while its tokens rotate out.
   * Empty: a random secret for this process, and every token dies with it.
   */
  secrets?: readonly string[];
  /** Wall clock, Unix ms. Injected by tests. */
  now?: () => number;
  lifetimeS?: number;
  rotateAfterS?: number;
  directory?: PlayerDirectory;
}

export type AdmitResult =
  | {
      ok: true;
      playerId: string;
      /** The token the JoinAck carries: the offered one, unless it was issued or rotated. */
      token: string;
      issued: boolean;
      rotated: boolean;
    }
  | { ok: false; reason: TokenRefusal };

export class Identity {
  readonly directory: PlayerDirectory;
  /** Whether the secret came from the environment; a random one does not outlive the process. */
  readonly durable: boolean;
  private readonly secrets: readonly string[];
  private readonly now: () => number;
  private readonly lifetimeS: number;
  private readonly rotateAfterS: number;

  constructor(options: IdentityOptions = {}) {
    const secrets = (options.secrets ?? []).filter((s) => s !== '');
    for (const s of secrets) {
      if (s.length < MIN_SECRET_LENGTH) throw new Error(`an identity secret must be at least ${MIN_SECRET_LENGTH} characters`);
    }
    this.durable = secrets.length > 0;
    this.secrets = this.durable ? secrets : [randomBytes(32).toString('base64url')];
    this.now = options.now ?? Date.now;
    this.lifetimeS = options.lifetimeS ?? DEFAULT_TOKEN_LIFETIME_S;
    this.rotateAfterS = options.rotateAfterS ?? DEFAULT_ROTATE_AFTER_S;
    this.directory = options.directory ?? new PlayerDirectory();
  }

  /** Verify, issue or rotate the token a Join offered, and record the visit. */
  admit(offered: string, name: string): AdmitResult {
    const nowMs = this.now();
    const nowS = Math.floor(nowMs / 1000);
    if (offered === '') {
      const playerId = newPlayerId();
      this.directory.touch(playerId, name, nowMs);
      return { ok: true, playerId, token: this.sign(playerId, nowS), issued: true, rotated: false };
    }
    const verified = verifyToken(offered, nowS, this.secrets);
    if (!verified.ok) return verified;
    const { playerId, issuedAt, secretIndex } = verified.claims;
    this.directory.touch(playerId, name, nowMs);
    const rotate = secretIndex > 0 || nowS - issuedAt >= this.rotateAfterS;
    return { ok: true, playerId, token: rotate ? this.sign(playerId, nowS) : offered, issued: false, rotated: rotate };
  }

  /** A fresh token for a player the host already knows. */
  rotate(token: string): AdmitResult {
    const nowS = Math.floor(this.now() / 1000);
    const verified = verifyToken(token, nowS, this.secrets);
    if (!verified.ok) return verified;
    const { playerId } = verified.claims;
    return { ok: true, playerId, token: this.sign(playerId, nowS), issued: false, rotated: true };
  }

  private sign(playerId: string, nowS: number): string {
    return issueToken(playerId, nowS, this.lifetimeS, this.secrets[0] as string);
  }
}

/** `IDENTITY_SECRET=current,previous`: comma-separated, the first signs. */
export function secretsFromEnv(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
}
