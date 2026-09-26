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
 *   line nobody has recorded yet is the chirp, placed or on the radio the
 *   same way, and nothing errors.
 *
 * Pure: time comes in as `now`, seconds, and what is heard goes out as a
 * `CalloutPlay` for the engine.
 */
import {
  CALLOUTS,
  type CalloutEvent,
  type CalloutLine,
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
  slot: number;
  /** Where they stand; null for your own soldier. */
  at: Vec3 | null;
  /** Your own soldier. */
  self: boolean;
}

export interface CalloutPlay {
  event: CalloutEvent;
  slot: number;
  line: string;
  /** Over the radio, unplaced; otherwise where the speaker stands (or your own). */
  radio: boolean;
  /** A committed voice file under `audio/`, or null for the chirp. */
  file: string | null;
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
  /** Slot → when they may start another line. */
  private readonly busy = new Map<number, number>();
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
    return (this.busy.get(slot) ?? 0) > now;
  }

  /** Whether the radio is in use at `now`. */
  onAir(now: number): boolean {
    return this.radioFreeAt > now;
  }

  private cooldownKey(event: CalloutEvent, slot: number): string {
    return this.config.events[event].scope === 'speaker' ? `${event}#${slot}` : event;
  }

  /**
   * `event` happened to `speaker`: the line to play now, or null — on
   * cooldown, the speaker busy, your own soldier for an event it does not
   * say, or waiting for the radio (see `update`).
   */
  say(event: CalloutEvent, speaker: CalloutSpeaker, listener: Vec3, now: number): CalloutPlay | null {
    const def = this.config.events[event];
    if (speaker.self && !def.self) return null;
    if (speaker.slot < 0 || speaker.slot >= this.voices.profiles.length) return null;
    const key = this.cooldownKey(event, speaker.slot);
    if ((this.cooldowns.get(key) ?? Number.NEGATIVE_INFINITY) > now) return null;
    if (this.speaking(speaker.slot, now)) return null;
    this.cooldowns.set(key, now + def.cooldown);
    const radio = this.overRadio(speaker, listener);
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
      if (this.speaking(next.speaker.slot, now)) continue;
      out.push(this.start(next.event, next.speaker, true, now));
    }
    return out;
  }

  private overRadio(speaker: CalloutSpeaker, listener: Vec3): boolean {
    if (speaker.self || !speaker.at) return false;
    const dx = speaker.at.x - listener.x;
    const dy = speaker.at.y - listener.y;
    const dz = speaker.at.z - listener.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) > this.config.radioBeyondM;
  }

  private pickLine(event: CalloutEvent): CalloutLine {
    const lines = this.config.events[event].lines;
    const i = (this.nextLine.get(event) ?? 0) % lines.length;
    this.nextLine.set(event, i + 1);
    return lines[i]!;
  }

  private start(event: CalloutEvent, speaker: CalloutSpeaker, radio: boolean, now: number): CalloutPlay {
    const { line, style } = this.pickLine(event);
    const profile = this.voices.profiles[speaker.slot]!.id;
    const treatment = radio ? 'radio' : 'dry';
    const key = `${profile}/${line}.${style}.${treatment}`;
    const variants = this.index.variants(key);
    let file: string | null = null;
    let seconds = this.chirpSeconds;
    if (variants > 0) {
      const v = (this.nextVariant.get(key) ?? 0) % variants;
      this.nextVariant.set(key, v + 1);
      file = `voice/${voiceFile(profile, line, style, treatment, v)}`;
      seconds = this.index.seconds(key, v) || seconds;
    }
    this.busy.set(speaker.slot, now + seconds + this.config.speakerGapSeconds);
    if (radio) this.radioFreeAt = now + seconds + this.config.radioGapSeconds;
    return { event, slot: speaker.slot, line, radio, file, at: radio ? null : speaker.at, own: speaker.self, seconds };
  }
}
