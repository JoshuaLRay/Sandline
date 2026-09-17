/**
 * Receive-side snapshot state (T-1.04 companion).
 *
 * Holds recently applied snapshots so an incoming delta can be resolved against
 * its baseline, and reports the tick to acknowledge.
 *
 * Losing a baseline is normal, not exceptional: snapshots travel on the
 * unreliable channel, so a dropped one means the next delta references a tick
 * we never applied. The correct response is to say so and let the server send a
 * full snapshot, NOT to decode against the wrong baseline — that would produce
 * plausible-looking but wrong world state, which is far worse than a hitch.
 */
import { BitReader } from './BitStream.ts';
import { readDelta } from './delta.ts';
import type { WorldSnapshot } from './snapshot.ts';

export interface ApplyResult {
  ok: boolean;
  snapshot?: WorldSnapshot;
  /** Set when the delta could not be applied, e.g. its baseline was lost. */
  reason?: string;
}

export class SnapshotStore {
  private readonly ring: (WorldSnapshot | null)[];
  private latest: WorldSnapshot | null = null;
  /** Deltas dropped for a missing baseline — a useful health signal. */
  missedBaselines = 0;

  constructor(private readonly capacity = 64) {
    this.ring = new Array<WorldSnapshot | null>(capacity).fill(null);
  }

  get lastAppliedTick(): number {
    return this.latest ? this.latest.tick : -1;
  }

  get current(): WorldSnapshot | null {
    return this.latest;
  }

  get(tick: number): WorldSnapshot | null {
    const found = this.ring[tick % this.capacity];
    return found && found.tick === tick ? found : null;
  }

  applyDelta(tick: number, baselineTick: number | null, payload: Uint8Array): ApplyResult {
    // Out-of-order arrival: an older snapshot than the one we hold is stale.
    if (this.latest && tick <= this.latest.tick) {
      return { ok: false, reason: `stale delta for tick ${tick}` };
    }

    let baseline: WorldSnapshot | null = null;
    if (baselineTick !== null) {
      baseline = this.get(baselineTick);
      if (!baseline) {
        this.missedBaselines++;
        return { ok: false, reason: `missing baseline tick ${baselineTick}` };
      }
    }

    let snapshot: WorldSnapshot;
    try {
      snapshot = readDelta(new BitReader(payload), baseline);
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }

    this.ring[snapshot.tick % this.capacity] = snapshot;
    this.latest = snapshot;
    return { ok: true, snapshot };
  }

  reset(): void {
    this.ring.fill(null);
    this.latest = null;
  }
}
