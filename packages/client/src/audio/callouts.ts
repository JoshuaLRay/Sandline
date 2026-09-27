/**
 * Who says what, and how it is heard (T-2.49, ADR-017).
 *
 * The director takes an event and the soldier it happened to, and decides
 * whether a line plays and how:
 *
 * - **Cooldowns.** An event is not said again within its cooldown — by
 *   anyone in the squad, or by that soldier when its scope is `speaker` —
 *   and a soldier never starts a line while still saying one (plus a gap),
 *   so nobody talks over themselves.
 * - **Near or far.** Your own soldier is heard as your own, dry. A squadmate
 *   within `radioBeyondM` is heard where they stand, dry; beyond it, over
 *   the radio treatment, unplaced.
 * - **One voice on the radio.** A radio line while another is on the air
 *   waits up to `radioQueueSeconds` (the most urgent first) or is dropped.
 * - **Missing recordings.** Each soldier speaks with its slot's profile; a
 *   line nobody has recorded yet is its route's placeholder — the chirp,
 *   placed or on the radio the same way, for squad dialogue; silence for a
 *   body's sound or an enemy's shout — and nothing errors. Your own
 *   soldier's unrecorded dialogue is silent unless `selfChirp` (U-007).
 *   Every play says whether it is a placeholder.
 * - **Routes (U-012).** Radio dialogue is the above. A body's grunt, cry or
 *   last breath is never on the radio: heard where the body is, or not at
 *   all beyond its route's `audibleM`. An enemy's shout is said with the
 *   enemy's voices where it stands, within its `audibleM`, never on the
 *   radio. Each route carries its own level trim. A body's sound is
 *   involuntary: it neither waits for its soldier to finish a line nor
 *   makes them wait.
 *
 * Pure: time comes in as `now`, seconds, and what is heard goes out as a
 * `CalloutPlay` for the engine.
 */
import {
  CALLOUTS,
  type CalloutEvent,
  type CalloutLine,
  type CalloutRouteId,
  type CalloutsConfig,
  SOUNDS,
  VOICES,
  type VoicesConfig,
  voiceFile,
} from '@sandline/shared';
import type { VoiceRendersManifest } from '../ui/soundBoardModel.ts';
import type { Vec3 } from './spatial.ts';

/** What has been recorded and processed: from `audio/voice/renders.json`. */
export interface VoiceIndex {
  /** How many variants a `<profile>/<line>.<style>.<treatment>` key has; 0 when none. */
  variants(key: string): number;
  /** A variant's length, seconds. */
  seconds(key: string, variant: number): number;
}

export function voiceIndex(manifest: VoiceRendersManifest | null): VoiceIndex {
  return {
    variants: (key) => manifest?.lines[key]?.length ?? 0,
    seconds: (key, variant) => manifest?.lines[key]?.[variant]?.seconds ?? 0,
  };
}

/** Nobody has recorded anything. */
export const NO_VOICES: VoiceIndex = voiceIndex(null);

export interface CalloutSpeaker {
  /** The squad slot; −1 for an enemy. */
  slot: number;
  /** U-012: an enemy's netId — it speaks the enemy's lines with `enemyProfiles[netId % length]`. */
  enemy?: number;
  /** Where they stand; null for your own soldier. */
  at: Vec3 | null;
  /** Your own soldier. */
  self: boolean;
}

export interface CalloutPlay {
  event: CalloutEvent;
  /** How it is heard (U-012). */
  route: CalloutRouteId;
  slot: number;
  /** The enemy saying it, or null for the squad. */
  enemy: number | null;
  line: string;
  /** Over the radio, unplaced; otherwise where the speaker stands (or your own). */
  radio: boolean;
  /** A committed voice file under `audio/`, or null: nobody has recorded it. */
  file: string | null;
  /**
   * U-012: a placeholder, not a voice — what plays for an unrecorded line
   * (the route's `placeholder`, a sound id), or null when the file is real
   * or the route's placeholder is silence. `isPlaceholder` says which.
   */
  placeholder: string | null;
  isPlaceholder: boolean;
  /** The route's level trim, as a gain. */
  gain: number;
  at: Vec3 | null;
  own: boolean;
  seconds: number;
}

interface Waiting {
  event: CalloutEvent;
  speaker: CalloutSpeaker;
  priority: number;
  queuedAt: number;
}

export interface DirectorOptions {
  config?: CalloutsConfig;
  voices?: VoicesConfig;
  index?: VoiceIndex;
  /** The chirp's length, seconds. */
  chirpSeconds?: number;
}

export class CalloutDirector {
  private readonly config: CalloutsConfig;
  private readonly voices: VoicesConfig;
  index: VoiceIndex;
  private readonly chirpSeconds: number;
  /** Cooldown key → when it may be said again. */
  private readonly cooldowns = new Map<string, number>();
  /** Speaker (`s<slot>`, `e<netId>`) → when they may start another line. */
  private readonly busy = new Map<string, number>();
  private radioFreeAt = 0;
  private readonly waiting: Waiting[] = [];
  private readonly nextLine = new Map<CalloutEvent, number>();
  private readonly nextVariant = new Map<string, number>();

  constructor(options: DirectorOptions = {}) {
    this.config = options.config ?? CALLOUTS;
    this.voices = options.voices ?? VOICES;
    this.index = options.index ?? NO_VOICES;
    this.chirpSeconds = options.chirpSeconds ?? SOUNDS.sounds.get(this.config.chirp)?.seconds ?? 0.5;
  }

  /** Whether a soldier is saying something (or just finished) at `now`. */
  speaking(slot: number, now: number): boolean {
    return (this.busy.get(`s${slot}`) ?? 0) > now;
  }

  /**
   * U-012: forget everything said — cooldowns, who is talking, the radio and
   * its queue — for a fresh session, a rejoin or a mission retry, so nothing
   * from before holds a line back or plays late into the new one.
   */
  reset(): void {
    this.cooldowns.clear();
    this.busy.clear();
    this.radioFreeAt = 0;
    this.waiting.length = 0;
  }

  private speakerKey(speaker: CalloutSpeaker): string {
    return speaker.enemy !== undefined ? `e${speaker.enemy}` : `s${speaker.slot}`;
  }

  private busyNow(speaker: CalloutSpeaker, now: number): boolean {
    return (this.busy.get(this.speakerKey(speaker)) ?? 0) > now;
  }

  /** The voice profile a speaker says its lines with. */
  private profileOf(speaker: CalloutSpeaker): string {
    if (speaker.enemy !== undefined) return this.voices.enemyProfiles[speaker.enemy % this.voices.enemyProfiles.length]!.id;
    return this.voices.profiles[speaker.slot]!.id;
  }

  /** Whether the radio is in use at `now`. */
  onAir(now: number): boolean {
    return this.radioFreeAt > now;
  }

  private cooldownKey(event: CalloutEvent, speaker: CalloutSpeaker): string {
    return this.config.events[event].scope === 'speaker' ? `${event}#${this.speakerKey(speaker)}` : event;
  }

  /**
   * `event` happened to `speaker`: the line to play now, or null — on
   * cooldown, the speaker busy, your own soldier for an event it does not
   * say, or waiting for the radio (see `update`).
   */
  say(event: CalloutEvent, speaker: CalloutSpeaker, listener: Vec3, now: number): CalloutPlay | null {
    const def = this.config.events[event];
    if (speaker.self && !def.self) return null;
    // An enemy shouts, and only an enemy does (U-012).
    const enemy = speaker.enemy !== undefined;
    if (enemy !== (def.route === 'shout')) return null;
    if (enemy ? speaker.enemy! < 0 : speaker.slot < 0 || speaker.slot >= this.voices.profiles.length) return null;
    // A body's sound or a shout does not carry past its route's reach, and is not on the radio instead.
    if (def.route !== 'radio' && !speaker.self && (!speaker.at || distance(speaker.at, listener) > this.config.routes[def.route].audibleM)) return null;
    const key = this.cooldownKey(event, speaker);
    if ((this.cooldowns.get(key) ?? Number.NEGATIVE_INFINITY) > now) return null;
    // A body's sound is not something anyone waits to say (U-012): it neither waits on their words nor holds them up.
    if (def.route !== 'body' && this.busyNow(speaker, now)) return null;
    // Your own unrecorded line: nothing to say but the chirp, and you know what you did (U-007).
    if (speaker.self && def.route === 'radio' && !this.config.selfChirp && !this.recorded(event, speaker)) return null;
    this.cooldowns.set(key, now + def.cooldown);
    const radio = def.route === 'radio' && this.overRadio(speaker, listener);
    if (radio && this.onAir(now)) {
      this.waiting.push({ event, speaker, priority: def.priority, queuedAt: now });
      return null;
    }
    return this.start(event, speaker, radio, now);
  }

  /** The waiting radio lines whose turn has come; stale ones are dropped. */
  update(now: number): CalloutPlay[] {
    const out: CalloutPlay[] = [];
    for (let i = this.waiting.length - 1; i >= 0; i -= 1) {
      if (now - this.waiting[i]!.queuedAt > this.config.radioQueueSeconds) this.waiting.splice(i, 1);
    }
    while (this.waiting.length && !this.onAir(now)) {
      this.waiting.sort((a, b) => b.priority - a.priority || a.queuedAt - b.queuedAt);
      const next = this.waiting.shift()!;
      if (this.busyNow(next.speaker, now)) continue;
      out.push(this.start(next.event, next.speaker, true, now));
    }
    return out;
  }

  private overRadio(speaker: CalloutSpeaker, listener: Vec3): boolean {
    if (speaker.self || !speaker.at) return false;
    return distance(speaker.at, listener) > this.config.radioBeyondM;
  }

  /** Whether any line of this event is recorded for this speaker's voice, dry. */
  private recorded(event: CalloutEvent, speaker: CalloutSpeaker): boolean {
    const profile = this.profileOf(speaker);
    return this.config.events[event].lines.some(({ line, style }) => this.index.variants(`${profile}/${line}.${style}.dry`) > 0);
  }

  private pickLine(event: CalloutEvent): CalloutLine {
    const lines = this.config.events[event].lines;
    const i = (this.nextLine.get(event) ?? 0) % lines.length;
    this.nextLine.set(event, i + 1);
    return lines[i]!;
  }

  private start(event: CalloutEvent, speaker: CalloutSpeaker, radio: boolean, now: number): CalloutPlay {
    const { line, style } = this.pickLine(event);
    const route = this.config.events[event].route;
    const { placeholder: stand, gainDb } = this.config.routes[route];
    const profile = this.profileOf(speaker);
    const treatment = radio ? 'radio' : 'dry';
    const key = `${profile}/${line}.${style}.${treatment}`;
    const variants = this.index.variants(key);
    let file: string | null = null;
    // Unrecorded: the route's placeholder for as long as it lasts — the chirp's, or nothing.
    let seconds = stand === null ? 0 : stand === this.config.chirp ? this.chirpSeconds : (SOUNDS.sounds.get(stand)?.seconds ?? 0);
    if (variants > 0) {
      const v = (this.nextVariant.get(key) ?? 0) % variants;
      this.nextVariant.set(key, v + 1);
      file = `voice/${voiceFile(profile, line, style, treatment, v)}`;
      seconds = this.index.seconds(key, v) || seconds;
    }
    if (route !== 'body') this.busy.set(this.speakerKey(speaker), now + seconds + this.config.speakerGapSeconds);
    if (radio) this.radioFreeAt = now + seconds + this.config.radioGapSeconds;
    return {
      event,
      route,
      slot: speaker.enemy !== undefined ? -1 : speaker.slot,
      enemy: speaker.enemy ?? null,
      line,
      radio,
      file,
      placeholder: file ? null : stand,
      isPlaceholder: file === null,
      gain: 10 ** (gainDb / 20),
      at: radio ? null : speaker.at,
      own: speaker.self,
      seconds,
    };
  }
}

function distance(a: Vec3, b: Vec3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}
