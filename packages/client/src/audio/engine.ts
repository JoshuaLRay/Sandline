/**
 * The audio engine (T-2.45, ADR-017): the committed renders played in the
 * world on Web Audio.
 *
 * - The context is made on the first user gesture (browsers refuse to start
 *   one before), and every render is fetched and decoded then.
 * - The listener follows the camera; each placed sound gets its own panner
 *   (HRTF), a low-pass when a box stands between it and the ear, its class's
 *   falloff as a gain, and a start delayed by the distance over the speed of
 *   sound. Unplaced sounds (the UI) go straight to the bus.
 * - A voice limit with priority: your own sounds and near ones before
 *   distant fire (`VoicePool`).
 * - Three volumes — master, effects and voice — from the settings.
 *
 * Written against the few Web Audio calls it makes (`AudioContextLike`), so
 * a test drives it with a fake context and no audio device.
 */
import { MIX, type MixConfig, SOUNDS, type SoundClass, type SoundDef, type SoundsConfig, type WorldBox, soundFile } from '@sandline/shared';
import { type Vec3, VoicePool, place } from './spatial.ts';

/** The parts of an AudioParam the engine sets. */
export interface ParamLike {
  value: number;
  setValueAtTime?(value: number, time: number): unknown;
}

export interface NodeLike {
  connect(to: NodeLike): unknown;
  disconnect(): void;
}

export interface GainLike extends NodeLike {
  gain: ParamLike;
}

export interface FilterLike extends NodeLike {
  type: BiquadFilterType;
  frequency: ParamLike;
}

export interface PannerLike extends NodeLike {
  panningModel: PanningModelType;
  distanceModel: DistanceModelType;
  positionX: ParamLike;
  positionY: ParamLike;
  positionZ: ParamLike;
}

export interface SourceLike extends NodeLike {
  buffer: unknown;
  onended: (() => void) | null;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface ListenerLike {
  positionX: ParamLike;
  positionY: ParamLike;
  positionZ: ParamLike;
  forwardX: ParamLike;
  forwardY: ParamLike;
  forwardZ: ParamLike;
  upX: ParamLike;
  upY: ParamLike;
  upZ: ParamLike;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: NodeLike;
  readonly listener: ListenerLike;
  createGain(): GainLike;
  createBiquadFilter(): FilterLike;
  createPanner(): PannerLike;
  createBufferSource(): SourceLike;
  decodeAudioData(data: ArrayBuffer): Promise<unknown>;
  resume(): Promise<void>;
}

export interface EngineOptions {
  /** Makes the context, on the first gesture. */
  createContext: () => AudioContextLike;
  /** Fetches a committed render's bytes by file name. */
  fetchBytes: (file: string) => Promise<ArrayBuffer>;
  sounds?: SoundsConfig;
  mix?: MixConfig;
  /** Which variant plays; a counter by default, so automatic fire never repeats one back to back. */
  pickVariant?: (def: SoundDef, last: number) => number;
}

export interface PlayOptions {
  /** Where the sound is; unplaced when absent. */
  at?: Vec3;
  /** Your own: plays at once whatever the distance, and outranks others for a voice. */
  own?: boolean;
  /** A fixed variant (the sound board); the engine's pick otherwise. */
  variant?: number;
  /** A further gain on top of the placement's: a cross-fade's share (T-2.46). */
  gain?: number;
}

/** A played sound: its nodes, to stop or to let finish. */
interface Voice {
  source: SourceLike;
  nodes: NodeLike[];
}

export interface Volumes {
  master: number;
  effects: number;
  voice: number;
}

/** The next variant after `last`, cycling: never the same one twice in a row when there are two or more. */
export function nextVariant(def: SoundDef, last: number): number {
  return def.variants <= 1 ? 0 : (last + 1) % def.variants;
}

export class AudioEngine {
  private ctx: AudioContextLike | null = null;
  private master: GainLike | null = null;
  private effectsBus: GainLike | null = null;
  private voiceBus: GainLike | null = null;
  private readonly buffers = new Map<string, unknown[]>();
  /** T-2.49: files played by name (voice lines), loaded on first use. */
  private readonly files = new Map<string, Promise<unknown>>();
  private readonly lastVariant = new Map<string, number>();
  private readonly pool: VoicePool<Voice>;
  private readonly sounds: SoundsConfig;
  private readonly mix: MixConfig;
  private listenerAt: Vec3 = { x: 0, y: 0, z: 0 };
  private boxes: readonly WorldBox[] = [];
  private volumes: Volumes = { master: 0.8, effects: 1, voice: 1 };
  private loading: Promise<void> | null = null;

  constructor(private readonly options: EngineOptions) {
    this.sounds = options.sounds ?? SOUNDS;
    this.mix = options.mix ?? MIX;
    this.pool = new VoicePool<Voice>(this.mix.voiceLimit);
  }

  /** Whether the context exists and every render has loaded. */
  get ready(): boolean {
    return this.ctx !== null && this.buffers.size === this.sounds.sounds.size;
  }

  /** Voices playing right now. */
  get voices(): number {
    return this.pool.size;
  }

  /** Make the context and load every render: call from a user gesture. Idempotent. */
  unlock(): Promise<void> {
    if (!this.ctx) {
      const ctx = this.options.createContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.effectsBus = ctx.createGain();
      this.voiceBus = ctx.createGain();
      this.effectsBus.connect(this.master);
      this.voiceBus.connect(this.master);
      this.master.connect(ctx.destination);
      this.setVolumes(this.volumes);
      this.loading = this.loadAll();
    }
    void this.ctx.resume();
    return this.loading ?? Promise.resolve();
  }

  private async loadAll(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    await Promise.all(
      [...this.sounds.sounds.values()].map(async (def) => {
        const decoded = await Promise.all(
          Array.from({ length: def.variants }, async (_, v) => {
            try {
              return await ctx.decodeAudioData(await this.options.fetchBytes(soundFile(def.id, v)));
            } catch {
              return null;
            }
          }),
        );
        this.buffers.set(def.id, decoded);
      }),
    );
  }

  setVolumes(v: Volumes): void {
    this.volumes = { ...v };
    if (this.master) this.master.gain.value = v.master;
    if (this.effectsBus) this.effectsBus.gain.value = v.effects;
    if (this.voiceBus) this.voiceBus.gain.value = v.voice;
  }

  /** The world the occlusion ray is cast through. */
  setWorld(boxes: readonly WorldBox[]): void {
    this.boxes = boxes;
  }

  /** The ear: where the camera is and which way it looks (a unit forward, +Y up). */
  setListener(at: Vec3, forward: Vec3): void {
    this.listenerAt = { ...at };
    const l = this.ctx?.listener;
    if (!l) return;
    l.positionX.value = at.x;
    l.positionY.value = at.y;
    l.positionZ.value = at.z;
    l.forwardX.value = forward.x;
    l.forwardY.value = forward.y;
    l.forwardZ.value = forward.z;
    l.upX.value = 0;
    l.upY.value = 1;
    l.upZ.value = 0;
  }

  /** The variant a sound last played, or −1: what the tests read to check variants never repeat. */
  lastVariantOf(id: string): number {
    return this.lastVariant.get(id) ?? -1;
  }

  /** Where the ear is. */
  get listener(): Vec3 {
    return { ...this.listenerAt };
  }

  /** Play a sound; false when it is unknown, not loaded, locked out, or lost its voice to louder ones. */
  play(id: string, opts: PlayOptions = {}): boolean {
    const ctx = this.ctx;
    const def = this.sounds.sounds.get(id);
    const buffers = this.buffers.get(id);
    if (!ctx || !def || !buffers) return false;
    const variant = opts.variant ?? (this.options.pickVariant ?? nextVariant)(def, this.lastVariant.get(id) ?? -1);
    const buffer = buffers[variant];
    if (!buffer) return false;
    this.lastVariant.set(id, variant);
    return this.start(ctx, buffer, def.class, opts);
  }

  /**
   * T-2.49: play a committed file that is not a recipe's render — a voice
   * line — in `cls`, fetched and decoded the first time it is asked for and
   * kept. Resolves false when it cannot be had or placed, never throws.
   */
  async playFile(file: string, cls: SoundClass, opts: PlayOptions = {}): Promise<boolean> {
    const ctx = this.ctx;
    if (!ctx) return false;
    let loading = this.files.get(file);
    if (!loading) {
      loading = this.options
        .fetchBytes(file)
        .then((bytes) => ctx.decodeAudioData(bytes))
        .catch(() => null);
      this.files.set(file, loading);
    }
    const buffer = await loading;
    return buffer ? this.start(ctx, buffer, cls, opts) : false;
  }

  private start(ctx: AudioContextLike, buffer: unknown, cls: SoundClass, opts: PlayOptions): boolean {
    const placement = place(cls, opts.at ?? null, this.listenerAt, this.boxes, this.mix, opts.own ?? false);
    placement.gain *= opts.gain ?? 1;
    if (placement.gain <= 0) return false;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const voice: Voice = { source, nodes: [source] };
    const taken = this.pool.acquire(voice, placement.priority);
    if (!taken.ok) return false;
    if (taken.stolen) this.stop(taken.stolen);

    let tail: NodeLike = source;
    if (placement.lowpassHz !== null) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = placement.lowpassHz;
      tail.connect(lp);
      tail = lp;
      voice.nodes.push(lp);
    }
    const gain = ctx.createGain();
    gain.gain.value = placement.gain;
    tail.connect(gain);
    tail = gain;
    voice.nodes.push(gain);
    if (opts.at && this.mix.classes[cls].falloff !== null) {
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      // The falloff is ours (the gain above); the panner only places.
      panner.distanceModel = 'linear';
      (panner as unknown as { refDistance: number; maxDistance: number; rolloffFactor: number }).rolloffFactor = 0;
      panner.positionX.value = opts.at.x;
      panner.positionY.value = opts.at.y;
      panner.positionZ.value = opts.at.z;
      tail.connect(panner);
      tail = panner;
      voice.nodes.push(panner);
    }
    const bus = cls === 'voice' ? this.voiceBus : this.effectsBus;
    if (bus) tail.connect(bus);
    source.onended = () => {
      this.pool.release(voice);
      for (const n of voice.nodes) n.disconnect();
    };
    source.start(ctx.currentTime + placement.delaySeconds);
    return true;
  }

  private stop(voice: Voice): void {
    try {
      voice.source.stop();
    } catch {
      // Not started yet, or already ended.
    }
    voice.source.onended = null;
    for (const n of voice.nodes) n.disconnect();
  }
}
