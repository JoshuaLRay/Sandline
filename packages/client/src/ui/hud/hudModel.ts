/**
 * The player's HUD as numbers and words (T-4.25).
 *
 * Every widget here is a PURE FUNCTION of replicated state: the health and
 * vitality the host sends, the magazine and pouch the weapon state holds,
 * the roster, the orders and marks the host broadcast, and where the camera
 * looks. Nothing here reads the DOM, the clock or the scene, so a test can
 * ask what the HUD would show for a state without a page — `Hud.ts` only
 * draws what these return.
 *
 * Directions follow the world's convention: a soldier faces +Z at yaw 0,
 * yaw = atan2(forward.x, forward.z), and the soldier's RIGHT is -X. A
 * compass reads that as north = +Z, east = -X, and a heading that grows as
 * the player turns right.
 */
import { MAX_SLOTS, type BotOrder, type RosterEntry, type Vitality, classById } from '@sandline/shared';
import type { MarkerKind } from '../OrderMarkers.ts';

// -- Vitals --------------------------------------------------------------

export interface VitalsInput {
  health: number;
  maxHealth: number;
  vitality: Vitality;
  /** Seconds left: bleeding out while downed, the respawn while dead. */
  vitalTimer: number;
  /** 0..100 while a teammate revives you, else 0. */
  reviveProgress: number;
  /** Who is reviving you, or '' for nobody. */
  reviverName: string;
}

export type VitalsTone = 'ok' | 'hurt' | 'critical' | 'downed' | 'dead';

export interface VitalsView {
  /** The bar's fill, 0..1: health while alive, the bleed-out or respawn left otherwise. */
  fraction: number;
  /** The number on the bar: "72", or "DOWNED 18s", or "KILLED 4s". */
  label: string;
  tone: VitalsTone;
}

/** Under this fraction of health the bar reads as critical. */
export const CRITICAL_HEALTH = 0.3;
/** Under this fraction the bar reads as hurt. */
export const HURT_HEALTH = 0.7;

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

export function vitalsView(v: VitalsInput): VitalsView {
  if (v.vitality === 'dead') {
    return { fraction: 0, label: v.vitalTimer > 0 ? `KILLED  ${Math.max(0, Math.round(v.vitalTimer))}s` : 'KILLED', tone: 'dead' };
  }
  if (v.vitality === 'downed') {
    const revive = v.reviveProgress > 0
      ? `  ${v.reviverName || 'revive'} ${Math.round(v.reviveProgress)}%`
      : '';
    return { fraction: clamp01(v.reviveProgress / 100), label: `DOWNED  ${Math.max(0, Math.round(v.vitalTimer))}s${revive}`, tone: 'downed' };
  }
  // Nothing replicated yet (no snapshot has carried health): an empty bar, no number, no alarm.
  if (!(v.maxHealth > 0)) return { fraction: 0, label: '--', tone: 'ok' };
  const fraction = clamp01(v.health / v.maxHealth);
  const tone: VitalsTone = fraction < CRITICAL_HEALTH ? 'critical' : fraction < HURT_HEALTH ? 'hurt' : 'ok';
  return { fraction, label: `${Math.max(0, Math.round(v.health))}`, tone };
}

// -- Ammo and the pouch ---------------------------------------------------

export interface PouchRow {
  name: string;
  count: number;
  /** The one in the hands, if any is. */
  selected: boolean;
}

export interface AmmoInput {
  weapon: string;
  ammo: number;
  magSize: number;
  reloading: boolean;
  /** 0..1 through the reload; 0 when none is in progress. */
  reloadFraction: number;
  pouch: readonly PouchRow[];
}

export interface AmmoView {
  weapon: string;
  /** "21 / 30", or "RELOADING" through a reload. */
  magazine: string;
  reloadFraction: number;
  /** A quarter of a magazine or less: the number goes amber. */
  low: boolean;
  /** Nothing in the magazine and no reload running: the number goes red. */
  empty: boolean;
  pouch: PouchRow[];
}

/** At or under this fraction of the magazine the count reads as low. */
export const LOW_AMMO = 0.25;

export function ammoView(a: AmmoInput): AmmoView {
  const ammo = Math.max(0, Math.floor(a.ammo));
  return {
    weapon: a.weapon,
    magazine: a.reloading ? 'RELOADING' : `${ammo} / ${Math.max(0, Math.floor(a.magSize))}`,
    reloadFraction: a.reloading ? clamp01(a.reloadFraction) : 0,
    low: !a.reloading && a.magSize > 0 && ammo > 0 && ammo / a.magSize <= LOW_AMMO,
    empty: !a.reloading && ammo === 0,
    pouch: a.pouch.map((row) => ({ name: row.name, count: Math.max(0, row.count), selected: row.selected })),
  };
}

// -- Stance ---------------------------------------------------------------

export type Stance = 'standing' | 'crouched' | 'prone' | 'vaulting' | 'airborne' | 'downed';

export interface StanceInput {
  downed: boolean;
  vaulting: boolean;
  prone: boolean;
  crouched: boolean;
  grounded: boolean;
}

/** One word for the body: what it is doing beats what it was asked. */
export function stanceOf(s: StanceInput): Stance {
  if (s.downed) return 'downed';
  if (s.vaulting) return 'vaulting';
  if (!s.grounded) return 'airborne';
  if (s.prone) return 'prone';
  if (s.crouched) return 'crouched';
  return 'standing';
}

// -- The squad ------------------------------------------------------------

export type SquadState = Vitality | 'unknown';

export interface SquadRow {
  slot: number;
  /** The player's name, or "Bot" for a bot. */
  label: string;
  human: boolean;
  you: boolean;
  state: SquadState;
  /** The order the bot is under, or '' (a human is under none). */
  order: string;
  /** The class's two letters (T-4.27), '' before the host has assigned one. */
  classShort: string;
}

/**
 * Six rows, always (ADR-001): a bot's row says "Bot", never a missing one.
 * `vitalityOf` is the host's word for a slot, or null for one this client
 * has not been told about yet (it reads as unknown, not dead).
 */
export function squadRows(
  roster: readonly RosterEntry[],
  mySlot: number,
  vitalityOf: (slot: number) => Vitality | null,
  orders: readonly BotOrder[],
): SquadRow[] {
  const rows: SquadRow[] = [];
  for (let slot = 0; slot < MAX_SLOTS; slot += 1) {
    const entry = roster[slot];
    const human = entry?.human ?? false;
    const order = orders.find((o) => o.slot === slot);
    rows.push({
      slot,
      label: human && entry?.name ? entry.name : 'Bot',
      human,
      you: slot === mySlot,
      state: vitalityOf(slot) ?? 'unknown',
      order: order?.order ?? '',
      classShort: classById(entry?.classId ?? '')?.short ?? '',
    });
  }
  return rows;
}

// -- The compass ----------------------------------------------------------

export interface CompassMarkerInput {
  key: string;
  kind: MarkerKind;
  label: string;
  x: number;
  z: number;
}

export interface CompassTick {
  text: string;
  /** Across the strip: -1 at the left edge, 0 dead ahead, +1 at the right edge. */
  offset: number;
  major: boolean;
}

export interface CompassMarkerView {
  key: string;
  kind: MarkerKind;
  label: string;
  offset: number;
  distanceM: number;
}

export interface CompassView {
  /** Where the player looks, degrees 0..360: 0 north (+Z), 90 east (-X). */
  heading: number;
  ticks: CompassTick[];
  markers: CompassMarkerView[];
}

/** Half the strip's field, degrees: what fits between its edges. */
export const COMPASS_HALF_WINDOW_DEG = 90;

const CARDINALS: readonly { deg: number; text: string; major: boolean }[] = [
  { deg: 0, text: 'N', major: true },
  { deg: 45, text: 'NE', major: false },
  { deg: 90, text: 'E', major: true },
  { deg: 135, text: 'SE', major: false },
  { deg: 180, text: 'S', major: true },
  { deg: 225, text: 'SW', major: false },
  { deg: 270, text: 'W', major: true },
  { deg: 315, text: 'NW', major: false },
];

/** Degrees into (-180, 180]. */
export function wrapDegrees(deg: number): number {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}

/** A world direction's compass bearing, degrees 0..360: +Z is 0, -X is 90. */
export function bearingDegrees(dx: number, dz: number): number {
  const deg = (Math.atan2(-dx, dz) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** The heading a facing yaw (radians, atan2(fx, fz)) reads as. */
export function headingOf(yawRadians: number): number {
  return bearingDegrees(Math.sin(yawRadians), Math.cos(yawRadians));
}

/**
 * Where a bearing sits on the strip for a heading: negative to the left,
 * positive to the right, null when it is behind the strip's edges.
 */
export function stripOffset(bearingDeg: number, headingDeg: number, halfWindowDeg = COMPASS_HALF_WINDOW_DEG): number | null {
  const relative = wrapDegrees(bearingDeg - headingDeg);
  if (Math.abs(relative) > halfWindowDeg) return null;
  return relative / halfWindowDeg;
}

export function compassView(
  yawRadians: number,
  me: { x: number; z: number },
  markers: readonly CompassMarkerInput[],
  halfWindowDeg = COMPASS_HALF_WINDOW_DEG,
): CompassView {
  const heading = headingOf(yawRadians);
  const ticks: CompassTick[] = [];
  for (const c of CARDINALS) {
    const offset = stripOffset(c.deg, heading, halfWindowDeg);
    if (offset !== null) ticks.push({ text: c.text, offset, major: c.major });
  }
  const out: CompassMarkerView[] = [];
  for (const m of markers) {
    const dx = m.x - me.x;
    const dz = m.z - me.z;
    const offset = stripOffset(bearingDegrees(dx, dz), heading, halfWindowDeg);
    if (offset === null) continue;
    out.push({ key: m.key, kind: m.kind, label: m.label, offset, distanceM: Math.hypot(dx, dz) });
  }
  return { heading, ticks, markers: out };
}

// -- Hit markers and the damage direction ---------------------------------

/** How long a hit marker shows after a round lands, seconds. */
export const HIT_MARKER_SECONDS = 0.35;
/** A life's end is an exact question: an age a rounding hair short of it is over. */
const AGE_EPSILON = 1e-9;

/** Where an age stands in a life, 0..1, or null once it is over (or before it began). */
function lifeLeft(age: number, life: number): number | null {
  if (!(age >= 0) || age >= life - AGE_EPSILON) return null;
  return 1 - age / life;
}

/** The marker's opacity at `now` for a hit landed at `hitAt`; 0 with none. */
export function hitMarkerOpacity(hitAt: number | null, now: number, life = HIT_MARKER_SECONDS): number {
  if (hitAt === null) return 0;
  return lifeLeft(now - hitAt, life) ?? 0;
}

export interface DamageHit {
  /** The compass bearing of whoever hit you, degrees 0..360. */
  bearingDeg: number;
  at: number;
}

export interface DamageDirectionView {
  /** Around the screen's centre: 0 straight ahead, growing clockwise. */
  angleDeg: number;
  opacity: number;
}

/** How long a damage direction shows, seconds. */
export const DAMAGE_DIRECTION_SECONDS = 1.2;

/**
 * Each recent hit as an arc around the reticle, pointing where it came
 * from. Expired hits are left out, so the caller can drop them.
 */
export function damageDirectionView(hits: readonly DamageHit[], yawRadians: number, now: number, life = DAMAGE_DIRECTION_SECONDS): DamageDirectionView[] {
  const heading = headingOf(yawRadians);
  const out: DamageDirectionView[] = [];
  for (const hit of hits) {
    const opacity = lifeLeft(now - hit.at, life);
    if (opacity === null) continue;
    out.push({ angleDeg: wrapDegrees(hit.bearingDeg - heading), opacity });
  }
  return out;
}

/** Drops the hits a `damageDirectionView` would no longer show. */
export function liveHits(hits: readonly DamageHit[], now: number, life = DAMAGE_DIRECTION_SECONDS): DamageHit[] {
  return hits.filter((hit) => lifeLeft(now - hit.at, life) !== null);
}
