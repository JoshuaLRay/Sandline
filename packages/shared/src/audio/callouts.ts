/**
 * Callouts as data (T-2.49, ADR-017): which voice-script line each game
 * event is said with, how often, how urgently, and whether your own soldier
 * says it; when a squadmate is heard over the radio instead of where they
 * stand; and the chirp that stands in for a line nobody has recorded yet.
 * Every line must be one the voice pipeline renders, and the chirp a
 * recipe — checked at import.
 */
import RAW from '../data/audio/callouts.json' with { type: 'json' };
import { SOUNDS, type SoundsConfig } from './sounds.ts';
import { VOICES, type VoiceStyle, type VoicesConfig } from './voices.ts';

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
] as const;
export type CalloutEvent = (typeof CALLOUT_EVENTS)[number];

export interface CalloutLine {
  line: string;
  /** The pass it is rendered from: a line has one in the game. */
  style: VoiceStyle;
}

export interface CalloutDef {
  lines: readonly CalloutLine[];
  cooldown: number;
  /** Whose cooldown: the squad's, or each soldier's own. */
  scope: 'squad' | 'speaker';
  priority: number;
  self: boolean;
}

export interface CalloutsConfig {
  chirp: string;
  radioBeyondM: number;
  radioQueueSeconds: number;
  radioGapSeconds: number;
  speakerGapSeconds: number;
  sight: { rangeM: number; forgetSeconds: number; everySeconds: number };
  grenadeWarningM: number;
  killCreditSeconds: number;
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
  const o = obj('callouts', raw, ['chirp', 'radioBeyondM', 'radioQueueSeconds', 'radioGapSeconds', 'speakerGapSeconds', 'sight', 'grenadeWarningM', 'killCreditSeconds', 'events']);
  if (typeof o['chirp'] !== 'string' || !sounds.sounds.has(o['chirp'])) throw new CalloutsDataError(`callouts.chirp: no sound '${String(o['chirp'])}' in sounds.json`);
  const sight = obj('callouts.sight', o['sight'], ['rangeM', 'forgetSeconds', 'everySeconds']);
  const rendered = renderedLines(voices);
  const rawEvents = obj('callouts.events', o['events'], CALLOUT_EVENTS);
  const events = {} as Record<CalloutEvent, CalloutDef>;
  for (const id of CALLOUT_EVENTS) {
    const where = `callouts.events.${id}`;
    const e = obj(where, rawEvents[id], ['lines', 'cooldown', 'scope', 'priority', 'self']);
    const lines = e['lines'];
    if (!Array.isArray(lines) || lines.length === 0) throw new CalloutsDataError(`${where}.lines must list at least one line`);
    const scope = e['scope'];
    if (scope !== 'squad' && scope !== 'speaker') throw new CalloutsDataError(`${where}.scope must be squad or speaker, got ${JSON.stringify(scope)}`);
    if (typeof e['self'] !== 'boolean') throw new CalloutsDataError(`${where}.self must be true or false`);
    events[id] = {
      lines: lines.map((line, i) => {
        const style = typeof line === 'string' ? rendered.get(line) : undefined;
        if (!style) throw new CalloutsDataError(`${where}.lines[${i}]: '${String(line)}' is not a line the voice pipeline renders`);
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
    radioBeyondM: num('callouts.radioBeyondM', o['radioBeyondM'], 0, 1000),
    radioQueueSeconds: num('callouts.radioQueueSeconds', o['radioQueueSeconds'], 0, 30),
    radioGapSeconds: num('callouts.radioGapSeconds', o['radioGapSeconds'], 0, 10),
    speakerGapSeconds: num('callouts.speakerGapSeconds', o['speakerGapSeconds'], 0, 10),
    sight: { rangeM: num('callouts.sight.rangeM', sight['rangeM'], 1, 1000), forgetSeconds: num('callouts.sight.forgetSeconds', sight['forgetSeconds'], 0, 600), everySeconds: num('callouts.sight.everySeconds', sight['everySeconds'], 0.01, 10) },
    grenadeWarningM: num('callouts.grenadeWarningM', o['grenadeWarningM'], 0, 100),
    killCreditSeconds: num('callouts.killCreditSeconds', o['killCreditSeconds'], 0, 30),
    events,
  };
}

export const CALLOUTS: CalloutsConfig = parseCallouts(RAW);

/** Whether a string names a callout event: a mission script's callout id may. */
export function isCalloutEvent(id: string): id is CalloutEvent {
  return (CALLOUT_EVENTS as readonly string[]).includes(id);
}
