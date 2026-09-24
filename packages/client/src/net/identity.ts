/**
 * The player-identity token this browser keeps (T-4.22, ADR-019).
 *
 * The host signs an anonymous player ID and hands the token back in every
 * JoinAck; the client offers it on every Join, so the host knows the same
 * player across rooms, reloads and days. The client never reads inside it:
 * the token is the host's, and only the host can tell a good one.
 *
 * Kept per host address, because each host signs with its own secret: a token
 * from a laptop host is a forgery to the deployed one. Storage is
 * `localStorage`, and a browser that refuses it (private mode, a blocked
 * site) just gets a new identity each time — the game still works.
 */

/** The part of `Storage` this needs; tests pass a Map-backed one. */
export interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = 'sandline.identity.';

function defaultStorage(): TokenStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The key a host's token is kept under. The in-page session issues none, so it has none. */
export function identityKey(host: string): string {
  return PREFIX + host.trim().replace(/\/+$/, '');
}

/** The token this browser holds for `host`, or empty for none. */
export function readIdentity(host: string, storage: TokenStorage | null = defaultStorage()): string {
  try {
    return storage?.getItem(identityKey(host)) ?? '';
  } catch {
    return '';
  }
}

/** Keep the token the latest JoinAck carried: it may be a rotated one. Empty keeps what there is. */
export function storeIdentity(host: string, token: string, storage: TokenStorage | null = defaultStorage()): void {
  if (token === '') return;
  try {
    storage?.setItem(identityKey(host), token);
  } catch {
    // A preference, not a requirement: next time the host issues another.
  }
}

/** The host refused the token (`bad identity`): drop it, so the next Join is issued a new one. */
export function forgetIdentity(host: string, storage: TokenStorage | null = defaultStorage()): void {
  try {
    storage?.removeItem(identityKey(host));
  } catch {
    // Nothing to forget.
  }
}
