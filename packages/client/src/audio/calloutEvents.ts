/**
 * Game events as callouts (T-2.49): what the squad would say, found in what
 * every client already has — replicated soldiers, enemies, projectiles,
 * orders and the mission, the server's shot events, and the world's boxes.
 *
 * - **contact**: an enemy a squadmate can see (a clear line from their eye
 *   to its chest, within range) that nobody has seen for a while; the MG
 *   gets its own line. Your own soldier does not call what you can see.
 * - **reloading**: a reload starting. **frag-out**: a squad grenade in the
 *   air. **grenade**: someone else's grenade near a squadmate, once each.
 * - **hit**, **down**, **man-down**: a round into a squadmate; one going
 *   down, who says so, and the nearest other who says "man down".
 * - **reviving**, **revived**: a reviver starting, and the one they picked
 *   up standing again.
 * - **enemy-down**: an enemy dying soon after a squadmate's round or blast.
 * - **order-…**: a bot given an order acknowledges it; **order-failed** is
 *   the host saying it could not get there.
 * - **objective-…**: the objective clear, held halfway, and secured.
 *
 * Nothing here plays anything: `update` returns events and who they
 * happened to; the director (callouts.ts) decides what is heard.
 */
import { type BotOrder, CALLOUTS, type CalloutEvent, type CalloutsConfig, MAX_SLOTS, type MissionView, type Vitality, type WorldBox, isCalloutEvent, rayWorld } from '@sandline/shared';
import type { Vec3 } from './spatial.ts';

export interface SquadSoldier {
  netId: number;
  slot: number;
  /** Feet. */
  at: Vec3;
  vitality: Vitality;
  /** Reloading now. */
  reloading: boolean;
  /** The slot reviving them, or −1. */
  reviverSlot: number;
  /** Your own soldier. */
  self: boolean;
}

export interface SeenEnemy {
  netId: number;
  at: Vec3;
  vitality: Vitality;
  /** Carries the MG. */
  mg: boolean;
}

export interface SeenGrenade {
  netId: number;
  /** A grenade rather than a rocket. */
  grenade: boolean;
  /** A squad slot, or anything from `MAX_SLOTS` up for the other side. */
  ownerSlot: number;
  at: Vec3;
}

/** What the watcher reads each frame. */
export interface CalloutView {
  soldiers: readonly SquadSoldier[];
  enemies: readonly SeenEnemy[];
  projectiles: readonly SeenGrenade[];
  orders: readonly BotOrder[];
  mission: MissionView | null;
  boxes: readonly WorldBox[];
}

export interface CalloutCue {
  event: CalloutEvent;
  slot: number;
}

/** Eye and chest heights over the feet, metres: a standing soldier. */
const EYE_M = 1.6;
const CHEST_M = 1.2;

function dist(a: Vec3, b: Vec3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

/** A clear line from `a`'s eye to `b`'s chest within `range`. */
export function canSee(a: Vec3, b: Vec3, boxes: readonly WorldBox[], range: number): boolean {
  const from = { x: a.x, y: a.y + EYE_M, z: a.z };
  const to = { x: b.x, y: b.y + CHEST_M, z: b.z };
  const d = dist(from, to);
  if (d > range) return false;
  if (d < 1e-6) return true;
  const direction = { x: (to.x - from.x) / d, y: (to.y - from.y) / d, z: (to.z - from.z) / d };
  return rayWorld({ origin: from, direction, maxDistance: d }, boxes) === null;
}

const orderKey = (o: BotOrder) => `${o.order}|${o.from}|${o.target ?? ''}|${o.point ? `${o.point.x.toFixed(1)},${o.point.z.toFixed(1)}` : ''}`;

export class CalloutWatcher {
  private readonly config: CalloutsConfig;
  private primed = false;
  private readonly vitality = new Map<number, Vitality>();
  private readonly reloading = new Map<number, boolean>();
  private readonly reviver = new Map<number, number>();
  /** Who last picked up whom: netId → the reviver's slot, until they stand. */
  private readonly revivedBy = new Map<number, number>();
  private readonly enemyVitality = new Map<number, Vitality>();
  private readonly lastSeen = new Map<number, number>();
  private nextSight = 0;
  private readonly projectiles = new Set<number>();
  private readonly warned = new Set<number>();
  /** Projectile netId → its thrower's slot, kept a while after it goes: a blast can be released after its entity has. */
  private readonly owners = new Map<number, { slot: number; seenAt: number }>();
  /** Enemy netId → the last squad slot to hurt it, and when. */
  private readonly credit = new Map<number, { slot: number; at: number }>();
  private orders = new Map<number, string>();
  private mission: MissionView | null = null;
  private readonly pending: CalloutCue[] = [];

  constructor(config: CalloutsConfig = CALLOUTS) {
    this.config = config;
  }

  /** A server shot event (T-2.11): a squadmate hit, or an enemy hurt by one. */
  onShot(shooterNetId: number, targetNetId: number, damage: number, view: CalloutView, now: number): void {
    if (targetNetId === 0 || damage <= 0) return;
    const target = view.soldiers.find((s) => s.netId === targetNetId);
    if (target && target.vitality === 'alive') this.pending.push({ event: 'hit', slot: target.slot });
    const shooter = view.soldiers.find((s) => s.netId === shooterNetId);
    if (shooter && view.enemies.some((e) => e.netId === targetNetId)) this.credit.set(targetNetId, { slot: shooter.slot, at: now });
  }

  /** A blast (T-2.33): every enemy it hurt is the thrower's, if the thrower — as its projectile was last seen — is the squad's. */
  onDetonation(projectileNetId: number, targets: readonly number[], now: number): void {
    const owner = this.owners.get(projectileNetId)?.slot ?? -1;
    if (owner < 0 || owner >= MAX_SLOTS) return;
    for (const t of targets) this.credit.set(t, { slot: owner, at: now });
  }

  /** The host saying a bot's order failed (protocol 33). */
  onOrderFailed(slot: number): void {
    this.pending.push({ event: 'order-failed', slot });
  }

  /** A mission script's callout: said by the nearest squadmate when it names an event. */
  onScriptCallout(id: string, view: CalloutView): void {
    if (!isCalloutEvent(id)) return;
    const speaker = this.nearestOther(view, null);
    if (speaker) this.pending.push({ event: id, slot: speaker.slot });
  }

  /** The squadmate nearest you who is up and is not you (or `exclude`); you if there is nobody else. */
  private nearestOther(view: CalloutView, exclude: number | null, from?: Vec3): SquadSoldier | null {
    const me = view.soldiers.find((s) => s.self);
    const origin = from ?? me?.at;
    let best: SquadSoldier | null = null;
    for (const s of view.soldiers) {
      if (s.self || s.vitality !== 'alive' || s.netId === exclude) continue;
      if (!origin) return s;
      if (!best || dist(s.at, origin) < dist(best.at, origin)) best = s;
    }
    return best ?? (me && me.vitality === 'alive' && me.netId !== exclude ? me : null);
  }

  /** The events since the last call. The first call only learns what is already so. */
  update(view: CalloutView, now: number): CalloutCue[] {
    const out = this.pending.splice(0);
    const priming = !this.primed;
    this.primed = true;
    const say = (event: CalloutEvent, slot: number) => {
      if (!priming) out.push({ event, slot });
    };

    for (const s of view.soldiers) {
      const was = this.vitality.get(s.netId);
      if (was !== undefined && was !== s.vitality) {
        if (was === 'alive' && s.vitality === 'downed') {
          say('down', s.slot);
          const other = this.nearestOther(view, s.netId, s.at);
          if (other && !other.self) say('man-down', other.slot);
        }
        if (was === 'downed' && s.vitality === 'alive') {
          const by = this.revivedBy.get(s.netId);
          if (by !== undefined) say('revived', by);
        }
      }
      if (s.vitality !== 'downed') this.revivedBy.delete(s.netId);
      this.vitality.set(s.netId, s.vitality);
      if (s.reloading && !this.reloading.get(s.netId) && s.vitality === 'alive') say('reloading', s.slot);
      this.reloading.set(s.netId, s.reloading);
      const reviver = s.reviverSlot;
      if (reviver >= 0 && (this.reviver.get(s.netId) ?? -1) < 0) say('reviving', reviver);
      if (reviver >= 0) this.revivedBy.set(s.netId, reviver);
      this.reviver.set(s.netId, reviver);
    }

    for (const e of view.enemies) {
      const was = this.enemyVitality.get(e.netId);
      if (was === 'alive' && e.vitality === 'dead') {
        const c = this.credit.get(e.netId);
        if (c && now - c.at <= this.config.killCreditSeconds) say('enemy-down', c.slot);
      }
      this.enemyVitality.set(e.netId, e.vitality);
    }

    // New sightings, a few times a second: a ray per squadmate and enemy.
    if (now >= this.nextSight) {
      this.nextSight = now + this.config.sight.everySeconds;
      for (const e of view.enemies) {
        if (e.vitality !== 'alive') continue;
        const seer = view.soldiers.find((s) => s.vitality === 'alive' && canSee(s.at, e.at, view.boxes, this.config.sight.rangeM));
        if (!seer) continue;
        const last = this.lastSeen.get(e.netId);
        this.lastSeen.set(e.netId, now);
        if (last !== undefined && now - last <= this.config.sight.forgetSeconds) continue;
        // You see what you see: the call is a squadmate's who sees it too.
        const caller = seer.self ? view.soldiers.find((s) => !s.self && s.vitality === 'alive' && canSee(s.at, e.at, view.boxes, this.config.sight.rangeM)) : seer;
        if (caller) say(e.mg ? 'contact-mg' : 'contact', caller.slot);
      }
    }

    const live = new Set<number>();
    for (const p of view.projectiles) {
      live.add(p.netId);
      this.owners.set(p.netId, { slot: p.ownerSlot, seenAt: now });
      if (!p.grenade) continue;
      const squad = p.ownerSlot >= 0 && p.ownerSlot < MAX_SLOTS;
      if (!this.projectiles.has(p.netId) && squad) say('frag-out', p.ownerSlot);
      if (!squad && !this.warned.has(p.netId)) {
        const near = view.soldiers.filter((s) => s.vitality === 'alive' && dist(s.at, p.at) <= this.config.grenadeWarningM).sort((a, b) => dist(a.at, p.at) - dist(b.at, p.at))[0];
        if (near) {
          this.warned.add(p.netId);
          say('grenade', near.slot);
        }
      }
      this.projectiles.add(p.netId);
    }
    for (const id of [...this.projectiles]) if (!live.has(id)) this.projectiles.delete(id);
    for (const id of [...this.warned]) if (!live.has(id)) this.warned.delete(id);
    for (const [id, o] of [...this.owners]) if (now - o.seenAt > 10) this.owners.delete(id);

    const orders = new Map(view.orders.map((o) => [o.slot, orderKey(o)] as const));
    for (const o of view.orders) if (this.orders.get(o.slot) !== orders.get(o.slot)) say(`order-${o.order}` as CalloutEvent, o.slot);
    this.orders = orders;

    const m = view.mission;
    const was = this.mission;
    if (m && was && m.attempt === was.attempt && m.objective === was.objective) {
      const speaker = this.nearestOther(view, null);
      if (speaker) {
        if (m.type === 'clear-and-hold' && m.satisfied && !was.satisfied && m.state === 'progress') say('objective-clear', speaker.slot);
        if (m.goal > 0 && m.progress * 2 >= m.goal && was.progress * 2 < m.goal && m.state === 'progress') say('objective-hold', speaker.slot);
      }
    }
    if (m && was && m.state === 'complete' && was.state !== 'complete') {
      const speaker = this.nearestOther(view, null);
      if (speaker) say('objective-done', speaker.slot);
    }
    this.mission = m;
    return out;
  }
}
