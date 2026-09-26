/**
 * The pure half of placing a sound (T-2.45): where the ear is against the
 * source, whether the world's boxes stand between them, and who keeps a
 * voice when too many play. The engine (`engine.ts`) turns these into Web
 * Audio nodes; nothing here touches one, so all of it is tested headless.
 */
import { type MixConfig, type SoundClass, type WorldBox, dbToGain, falloffGain, rayWorld, soundDelaySeconds, voicePriority } from '@sandline/shared';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** A box between the ear and the source: the low-pass and the gain the mix's occlusion gives, or none for a clear line. */
export function occlusion(listener: Vec3, source: Vec3, boxes: readonly WorldBox[], mix: MixConfig): { occluded: boolean; lowpassHz: number | null; gain: number } {
  const d = distance(listener, source);
  if (d < 1e-3) return { occluded: false, lowpassHz: null, gain: 1 };
  const direction = { x: (source.x - listener.x) / d, y: (source.y - listener.y) / d, z: (source.z - listener.z) / d };
  // A source sitting on a box's face is not behind it: stop a few centimetres short.
  const hit = rayWorld({ origin: listener, direction, maxDistance: Math.max(0, d - 0.05) }, boxes);
  return hit === null ? { occluded: false, lowpassHz: null, gain: 1 } : { occluded: true, lowpassHz: mix.occlusion.lowpassHz, gain: dbToGain(mix.occlusion.gainDb) };
}

/** Everything the engine needs to place one sound: its gain, its filter, when it starts and how much it matters. */
export interface Placement {
  gain: number;
  lowpassHz: number | null;
  delaySeconds: number;
  priority: number;
  distanceM: number;
}

/** Place a sound of a class at `source` (or unplaced with null) for an ear at `listener`. */
export function place(cls: SoundClass, source: Vec3 | null, listener: Vec3, boxes: readonly WorldBox[], mix: MixConfig, own = false): Placement {
  const curve = mix.classes[cls].falloff;
  if (source === null || curve === null) return { gain: 1, lowpassHz: null, delaySeconds: 0, priority: voicePriority(mix, cls, own, 0), distanceM: 0 };
  const d = distance(listener, source);
  const occ = occlusion(listener, source, boxes, mix);
  return {
    gain: falloffGain(curve, d) * occ.gain,
    lowpassHz: occ.lowpassHz,
    delaySeconds: own ? 0 : soundDelaySeconds(mix, d),
    priority: voicePriority(mix, cls, own, d),
    distanceM: d,
  };
}

/**
 * The voice limit: at most `limit` sounds at once. A new sound takes a free
 * voice; with none free it steals the lowest-priority voice (the oldest of
 * equals) if it outranks it, and is dropped otherwise. Returns what to stop.
 */
export class VoicePool<T> {
  private readonly voices: { item: T; priority: number; started: number }[] = [];
  private clock = 0;

  constructor(readonly limit: number) {}

  get size(): number {
    return this.voices.length;
  }

  /** Try to take a voice. `{ ok: false }` drops the sound; `stolen` is a voice to stop first. */
  acquire(item: T, priority: number): { ok: true; stolen: T | null } | { ok: false } {
    if (this.voices.length < this.limit) {
      this.voices.push({ item, priority, started: this.clock++ });
      return { ok: true, stolen: null };
    }
    let worst = 0;
    for (let i = 1; i < this.voices.length; i += 1) {
      const v = this.voices[i]!;
      const w = this.voices[worst]!;
      if (v.priority < w.priority || (v.priority === w.priority && v.started < w.started)) worst = i;
    }
    const victim = this.voices[worst]!;
    if (priority <= victim.priority) return { ok: false };
    this.voices.splice(worst, 1);
    this.voices.push({ item, priority, started: this.clock++ });
    return { ok: true, stolen: victim.item };
  }

  /** A voice finished on its own. */
  release(item: T): void {
    const i = this.voices.findIndex((v) => v.item === item);
    if (i >= 0) this.voices.splice(i, 1);
  }

  items(): T[] {
    return this.voices.map((v) => v.item);
  }
}
