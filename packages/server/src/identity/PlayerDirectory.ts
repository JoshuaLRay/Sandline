/**
 * What the host knows about a player (T-4.22, ADR-019 decision 5).
 *
 * Exactly the ID, the display name they typed and when they were first and
 * last seen. No email, no address, no device, nothing else: `PlayerRecord`
 * is the whole of it, and a test holds it to those four keys.
 *
 * In memory for now. Campaign saves (T-4.23) put it in the SQLite file.
 */
export interface PlayerRecord {
  id: string;
  name: string;
  /** Unix ms. */
  firstSeen: number;
  lastSeen: number;
}

/** ADR-019: a player ID with no visit for 180 days is deleted. */
export const PLAYER_RETENTION_MS = 180 * 24 * 60 * 60_000;

export class PlayerDirectory {
  private readonly players = new Map<string, PlayerRecord>();

  /** Record a visit: the name is bound to the ID, and the latest one wins. */
  touch(id: string, name: string, nowMs: number): PlayerRecord {
    const known = this.players.get(id);
    const record: PlayerRecord = { id, name, firstSeen: known?.firstSeen ?? nowMs, lastSeen: nowMs };
    this.players.set(id, record);
    return record;
  }

  get(id: string): PlayerRecord | undefined {
    return this.players.get(id);
  }

  get size(): number {
    return this.players.size;
  }

  /** Forget everyone not seen within `retentionMs`. Returns how many went. */
  prune(nowMs: number, retentionMs = PLAYER_RETENTION_MS): number {
    let removed = 0;
    for (const [id, record] of this.players) {
      if (nowMs - record.lastSeen > retentionMs) {
        this.players.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}
