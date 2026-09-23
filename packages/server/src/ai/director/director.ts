/**
 * The director (T-3.33): the spawner's pacing (`Pacing`), from how hard the
 * fight is and how many people are in it.
 *
 * INTENSITY, 0..1, is sampled every tick from what the squad is going
 * through (`data/director.json`): damage it took inside a sliding window,
 * enemies in contact (alive and knowing of a squad soldier), and its mean
 * suppression, each normalised and capped at 1, weighted and summed. A
 * group's next wave is never sent before its file's `minSeconds` since the
 * last and always by `maxSeconds`; between them, held while intensity is
 * above `holdAbove`, sent at `minSeconds` while it is below `forwardBelow`,
 * and otherwise at `everySeconds`.
 *
 * BUDGET follows the HUMANS seated, not the squad (ADR-001): six slots are
 * always filled, and five bots are not five players the mission must be
 * harder for. Each wave's member counts and the alive cap are scaled by the
 * budget row for the humans there at the moment a wave is sent — so a human
 * joining mid-mission changes the next wave, not the one already queued.
 */
import { type DirectorConfig, DIRECTOR, type EncounterGroup, budgetFor, scaled } from '@sandline/shared';
import type { Pacing } from './spawner.ts';

/** What the session tells the director each tick. */
export interface DirectorSample {
  /** Seconds since the mission began. */
  seconds: number;
  /** Humans seated now. */
  humans: number;
  /** The squad's summed current health: its drops are damage taken. */
  squadHealth: number;
  /** Living enemies that know of a squad soldier. */
  contact: number;
  /** The squad's mean suppression, 0..1. */
  suppression: number;
}

export class Director implements Pacing {
  private humansNow = 0;
  private lastHealth: number | null = null;
  /** Damage taken, by the second it was taken, inside the window. */
  private readonly damage: { seconds: number; amount: number }[] = [];
  private intensityValue = 0;
  private parts = { damage: 0, contact: 0, suppression: 0 };

  constructor(private readonly config: DirectorConfig = DIRECTOR) {}

  /** Intensity after the latest sample, 0..1. */
  get intensity(): number {
    return this.intensityValue;
  }

  /** Its three parts, each 0..1 before weighting, after the latest sample. */
  get components(): Readonly<{ damage: number; contact: number; suppression: number }> {
    return this.parts;
  }

  /** The humans the latest sample counted. */
  get humans(): number {
    return this.humansNow;
  }

  /** Take this tick's sample. Call once a tick, before the spawner steps. */
  sample(s: DirectorSample): void {
    const c = this.config.intensity;
    this.humansNow = s.humans;
    if (this.lastHealth !== null && s.squadHealth < this.lastHealth) this.damage.push({ seconds: s.seconds, amount: this.lastHealth - s.squadHealth });
    this.lastHealth = s.squadHealth;
    while (this.damage.length > 0 && this.damage[0]!.seconds <= s.seconds - c.windowSeconds) this.damage.shift();
    const taken = this.damage.reduce((a, d) => a + d.amount, 0);
    this.parts = {
      damage: Math.min(1, taken / c.damageFull),
      contact: Math.min(1, s.contact / c.contactFull),
      suppression: Math.min(1, Math.max(0, s.suppression)),
    };
    this.intensityValue = c.weights.damage * this.parts.damage + c.weights.contact * this.parts.contact + c.weights.suppression * this.parts.suppression;
  }

  waveSize(count: number): number {
    return scaled(count, budgetFor(this.humansNow, this.config).size);
  }

  aliveCap(fileCap: number): number {
    return scaled(fileCap, budgetFor(this.humansNow, this.config).aliveCap);
  }

  waveDue(since: number, waves: EncounterGroup['waves']): boolean {
    if (since < waves.minSeconds) return false;
    if (since >= waves.maxSeconds) return true;
    if (this.intensityValue > this.config.holdAbove) return false;
    if (this.intensityValue < this.config.forwardBelow) return true;
    return since >= waves.everySeconds;
  }
}
