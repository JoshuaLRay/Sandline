/**
 * Callouts as data (T-2.49, ADR-017): which voice-script line each game
 * event is said with, how often, how urgently, and whether your own soldier
 * says it; when a squadmate is heard over the radio instead of where they
 * stand; and the chirp that stands in for a line nobody has recorded yet.
 * Every line must be one the voice pipeline renders, and the chirp a
 * recipe — checked at import.
 *
 * U-012: every event is heard along one of three ROUTES, each with its own
 * rules (`CalloutRoute`): the squad's radio dialogue, a body's own sounds,
 * and the enemy's shouts. A route's lines must be said by that route's
 * voices — the squad's, or the enemy's.
 */
import RAW from '../data/audio/callouts.json' with { type: 'json' };
import { SOUNDS, type SoundsConfig } from './sounds.ts';
import { VOICES, type VoiceStyle, type VoicesConfig, sectionOfLine } from './voices.ts';

export const CALLOUT_EVENTS = [
  'contact',
  'contact-mg',
  'reloading',
  'frag-out',
  'grenade',
  'hit',
  'down',
  'man-down',
  'reviving',
  'revived',
  'enemy-down',
  'order-move',
  'order-attack',
  'order-hold',
  'order-regroup',
  'order-revive',
  'order-failed',
  'objective-clear',
  'objective-hold',
  'objective-done',
  // U-012: a body's own sounds, apart from what the soldier says about them.
  'hit-grunt',
  'downed-cry',
  'dying',
  // U-012: the enemy, where it stands.
  'enemy-engage',
] as const;
export type CalloutEvent = (typeof CALLOUT_EVENTS)[number];

/**
 * U-012: how an event is heard.
 *
 * - `radio`: squad dialogue. Your own soldier is your own; a squadmate within
 *   `radioBeyondM` is heard where they stand, dry; beyond it, over the radio
 *   treatment, one voice at a time. A line nobody has recorded is the chirp.
 * - `body`: a soldier's grunt, cry or last breath. Never on the radio: heard
 *   where the body is, or not at all beyond the route's `audibleM`. Nothing
 *   stands in for an unrecorded one (a chirp would say "radio").
 * - `shout`: an enemy calling out. Heard where it stands, dry, within
 *   `audibleM`; never on the radio; said with the enemy's voices. Nothing
 *   stands in for an unrecorded one.
 */
export const CALLOUT_ROUTES = ['radio', 'body', 'shout'] as const;
export type CalloutRouteId = (typeof CALLOUT_ROUTES)[number];

export interface CalloutRoute {
  /** Heard no further than this, metres; the radio route's far squadmates are on the radio instead. */
  audibleM: number;
  /** A trim on the voice class's level, dB. */
  gainDb: number;
  /** What an unrecorded line plays instead (a sound id), or null: silent until it is recorded. */
  placeholder: string | null;
}

export interface CalloutLine {
  line: string;
  /** The pass it is rendered from: a line has one in the game. */
  style: VoiceStyle;
}

export interface CalloutDef {
  /** How it is heard (U-012). */
  route: CalloutRouteId;
  lines: readonly CalloutLine[];
  cooldown: number;
  /** Whose cooldown: the squad's, or each soldier's own. */
  scope: 'squad' | 'speaker';
  priority: number;
  self: boolean;
}

export interface CalloutsConfig {
  chirp: string;
  /**
   * Whether your own soldier's unrecorded lines play the chirp (U-007). Off:
   * the chirp says a squadmate spoke, and your own "reloading" chirp landed on
   * your own magazine-out, a dozen decibels over it. A recorded line plays either way.
   */
  selfChirp: boolean;
  radioBeyondM: number;
  radioQueueSeconds: number;
  radioGapSeconds: number;
  speakerGapSeconds: number;
  sight: { rangeM: number; forgetSeconds: number; everySeconds: number };
  grenadeWarningM: number;
  killCreditSeconds: number;
  /** U-012: an enemy firing on the squad after this long quiet has opened an engagement, and may shout it. */
  engageQuietSeconds: number;
  routes: Readonly<Record<CalloutRouteId, CalloutRoute>>;
  events: Readonly<Record<CalloutEvent, CalloutDef>>;
}

export class CalloutsDataError extends Error {}

type Obj = Record<string, unknown>;

/** Every line the voice pipeline renders, with the pass it is rendered from (the first, where a section renders two). */
export function renderedLines(voices: VoicesConfig = VOICES): Map<string, VoiceStyle> {
  const out = new Map<string, VoiceStyle>();
  for (const section of voices.sections) {
    const spoken = section.render.find((s) => s !== 'hurt');
    if (spoken) for (const line of section.lines) out.set(line, spoken);
    if (section.render.includes('hurt')) for (const line of section.hurt) out.set(line, 'hurt');
  }
  return out;
}

export function parseCallouts(raw: unknown, voices: VoicesConfig = VOICES, sounds: SoundsConfig = SOUNDS): CalloutsConfig {
  const obj = (where: string, v: unknown, keys: readonly string[]): Obj => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new CalloutsDataError(`${where}: expected an object`);
    const o = v as Obj;
    for (const k of Object.keys(o)) if (!keys.includes(k) && k !== '$comment') throw new CalloutsDataError(`${where}: unknown key '${k}'`);
    for (const k of keys) if (!(k in o)) throw new CalloutsDataError(`${where}: missing '${k}'`);
    return o;
  };
  const num = (where: string, v: unknown, min: number, max: number): number => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new CalloutsDataError(`${where} must be in [${min}, ${max}], got ${JSON.stringify(v)}`);
    return v;
  };
  const o = obj('callouts', raw, ['chirp', 'selfChirp', 'radioBeyondM', 'radioQueueSeconds', 'radioGapSeconds', 'speakerGapSeconds', 'sight', 'grenadeWarningM', 'killCreditSeconds', 'engageQuietSeconds', 'routes', 'events']);
  if (typeof o['chirp'] !== 'string' || !sounds.sounds.has(o['chirp'])) throw new CalloutsDataError(`callouts.chirp: no sound '${String(o['chirp'])}' in sounds.json`);
  if (typeof o['selfChirp'] !== 'boolean') throw new CalloutsDataError('callouts.selfChirp must be true or false');
  const sight = obj('callouts.sight', o['sight'], ['rangeM', 'forgetSeconds', 'everySeconds']);
  const rendered = renderedLines(voices);
  const rawRoutes = obj('callouts.routes', o['routes'], CALLOUT_ROUTES);
  const routes = {} as Record<CalloutRouteId, CalloutRoute>;
  for (const id of CALLOUT_ROUTES) {
    const where = `callouts.routes.${id}`;
    const r = obj(where, rawRoutes[id], ['audibleM', 'gainDb', 'placeholder']);
    const placeholder = r['placeholder'];
    if (placeholder !== null && (typeof placeholder !== 'string' || !sounds.sounds.has(placeholder))) {
      throw new CalloutsDataError(`${where}.placeholder: no sound '${String(placeholder)}' in sounds.json (null for silence)`);
    }
    routes[id] = { audibleM: num(`${where}.audibleM`, r['audibleM'], 1, 1000), gainDb: num(`${where}.gainDb`, r['gainDb'], -24, 12), placeholder };
  }
  const rawEvents = obj('callouts.events', o['events'], CALLOUT_EVENTS);
  const events = {} as Record<CalloutEvent, CalloutDef>;
  for (const id of CALLOUT_EVENTS) {
    const where = `callouts.events.${id}`;
    const e = obj(where, rawEvents[id], ['route', 'lines', 'cooldown', 'scope', 'priority', 'self']);
    const route = e['route'];
    if (typeof route !== 'string' || !(CALLOUT_ROUTES as readonly string[]).includes(route)) {
      throw new CalloutsDataError(`${where}.route must be one of ${CALLOUT_ROUTES.join(', ')}, got ${JSON.stringify(route)}`);
    }
    // The enemy's shouts are the enemy's lines, and only they are.
    const speakers = route === 'shout' ? 'enemy' : 'squad';
    const lines = e['lines'];
    if (!Array.isArray(lines) || lines.length === 0) throw new CalloutsDataError(`${where}.lines must list at least one line`);
    const scope = e['scope'];
    if (scope !== 'squad' && scope !== 'speaker') throw new CalloutsDataError(`${where}.scope must be squad or speaker, got ${JSON.stringify(scope)}`);
    if (typeof e['self'] !== 'boolean') throw new CalloutsDataError(`${where}.self must be true or false`);
    events[id] = {
      route: route as CalloutRouteId,
      lines: lines.map((line, i) => {
        const style = typeof line === 'string' ? rendered.get(line) : undefined;
        if (!style) throw new CalloutsDataError(`${where}.lines[${i}]: '${String(line)}' is not a line the voice pipeline renders`);
        if (sectionOfLine(line as string, voices)?.speakers !== speakers) {
          throw new CalloutsDataError(`${where}.lines[${i}]: '${String(line)}' is not said by the ${speakers === 'enemy' ? "enemy's" : "squad's"} voices, which the ${route} route uses`);
        }
        if (route === 'shout' && e['self'] !== false) throw new CalloutsDataError(`${where}.self: an enemy's shout is never your own soldier's`);
        return { line: line as string, style };
      }),
      cooldown: num(`${where}.cooldown`, e['cooldown'], 0, 600),
      scope,
      priority: num(`${where}.priority`, e['priority'], 0, 100),
      self: e['self'],
    };
  }
  return {
    chirp: o['chirp'],
    selfChirp: o['selfChirp'],
    radioBeyondM: num('callouts.radioBeyondM', o['radioBeyondM'], 0, 1000),
    radioQueueSeconds: num('callouts.radioQueueSeconds', o['radioQueueSeconds'], 0, 30),
    radioGapSeconds: num('callouts.radioGapSeconds', o['radioGapSeconds'], 0, 10),
    speakerGapSeconds: num('callouts.speakerGapSeconds', o['speakerGapSeconds'], 0, 10),
    sight: { rangeM: num('callouts.sight.rangeM', sight['rangeM'], 1, 1000), forgetSeconds: num('callouts.sight.forgetSeconds', sight['forgetSeconds'], 0, 600), everySeconds: num('callouts.sight.everySeconds', sight['everySeconds'], 0.01, 10) },
    grenadeWarningM: num('callouts.grenadeWarningM', o['grenadeWarningM'], 0, 100),
    killCreditSeconds: num('callouts.killCreditSeconds', o['killCreditSeconds'], 0, 30),
    engageQuietSeconds: num('callouts.engageQuietSeconds', o['engageQuietSeconds'], 0, 600),
    routes,
    events,
  };
}

export const CALLOUTS: CalloutsConfig = parseCallouts(RAW);

/** Whether a string names a callout event: a mission script's callout id may. */
export function isCalloutEvent(id: string): id is CalloutEvent {
  return (CALLOUT_EVENTS as readonly string[]).includes(id);
}
