/**
 * Interest management (T-3.12, ADR-012): what one client is sent.
 *
 * ADR-012 puts a ~120 m relevance radius round each player, and calls it
 * required rather than an optimisation — without it bandwidth scales with the
 * world, not with what a player can see. Everything here is a pure function
 * of the snapshot the session built and the set this client was last sent, so
 * the session keeps one world snapshot and each client gets a filtered view
 * of it.
 *
 * - **Slots are always relevant.** The squad is always on the HUD, so an
 *   entity carrying `PlayerSlot` is never filtered, whatever the distance.
 * - **Everything else** (enemies, projectiles) is relevant within
 *   `RELEVANCE_RADIUS_M` of the viewer's own slot, measured on the quantized
 *   positions the snapshot carries.
 * - **Hysteresis.** An entity already in the client's view stays until it is
 *   `RELEVANCE_HYSTERESIS_M` past the radius, so one pacing along the edge
 *   does not despawn and respawn — a full spawn each time — every tick.
 *
 * Leaving and re-entering need nothing new on the wire: an entity missing
 * from the view is a despawn in the delta against the client's baseline, and
 * one back in it is a spawn with every component at its current value. That
 * works only because the baseline is the VIEW this client was sent at the
 * acknowledged tick, not the whole world — `ClientView` keeps those.
 */
import { COMPONENT_IDS, POSITION, SnapshotHistory, dequantize, type WorldSnapshot } from '@sandline/shared';

/** ADR-012's radius, from the viewer's slot. */
export const RELEVANCE_RADIUS_M = 120;
/** How far past the radius an entity already in view may go before it leaves. */
export const RELEVANCE_HYSTERESIS_M = 10;

type Entity = WorldSnapshot['entities'][number];

/** One client's side of interest management: what it was sent, by tick. */
export class ClientView {
  /** The views this client was sent, for its baselines. Same depth as the session's. */
  readonly history = new SnapshotHistory(64);
  /** NetIds in the newest view sent, for hysteresis. */
  relevant: ReadonlySet<number> = new Set();

  /** Filters `snapshot` for the viewer, remembers the result and returns it. */
  next(snapshot: WorldSnapshot, viewerNetId: number | null): WorldSnapshot {
    const view = relevantView(snapshot, viewerNetId, this.relevant);
    this.history.store(view);
    this.relevant = new Set(view.entities.map((e) => e.netId));
    return view;
  }
}

function positionOf(e: Entity): { x: number; y: number; z: number } | null {
  const t = e.components[COMPONENT_IDS.Transform];
  if (!t) return null;
  return {
    x: dequantize(t[0] as number, POSITION),
    y: dequantize(t[1] as number, POSITION),
    z: dequantize(t[2] as number, POSITION),
  };
}

/** Whether an entity is sent to every client regardless of distance. */
export function alwaysRelevant(e: Entity): boolean {
  return e.components[COMPONENT_IDS.PlayerSlot] !== undefined;
}

/**
 * The part of `snapshot` a viewer is sent. `viewerNetId` is the client's own
 * slot; null (a connection without one) sees only the slots. `previous` is the
 * set it was last sent, for hysteresis. Entity order is preserved, and the
 * entity objects are the snapshot's own — nothing is copied.
 */
export function relevantView(
  snapshot: WorldSnapshot,
  viewerNetId: number | null,
  previous: ReadonlySet<number> = new Set(),
): WorldSnapshot {
  const viewerEntity = viewerNetId === null ? undefined : snapshot.entities.find((e) => e.netId === viewerNetId);
  const viewer = viewerEntity ? positionOf(viewerEntity) : null;
  const enterSq = RELEVANCE_RADIUS_M * RELEVANCE_RADIUS_M;
  const stay = RELEVANCE_RADIUS_M + RELEVANCE_HYSTERESIS_M;
  const staySq = stay * stay;

  const entities = snapshot.entities.filter((e) => {
    if (alwaysRelevant(e)) return true;
    if (!viewer) return false;
    const p = positionOf(e);
    if (!p) return false;
    const dx = p.x - viewer.x;
    const dy = p.y - viewer.y;
    const dz = p.z - viewer.z;
    const dSq = dx * dx + dy * dy + dz * dz;
    return dSq <= (previous.has(e.netId) ? staySq : enterSq);
  });
  return { tick: snapshot.tick, entities };
}
