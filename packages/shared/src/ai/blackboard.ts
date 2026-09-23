/**
 * A typed blackboard (T-3.07) — the memory a behaviour tree's leaves share.
 *
 * Typed by its shape, not by string keys looked up at runtime: a brain declares
 * `Blackboard<{ target: number | null; lastSeenTick: number }>` and a leaf that
 * writes a string into `target` does not compile. Every key has a value from the
 * moment the board exists — "nothing yet" is a `null` the shape says it may
 * hold, never a missing key — so `get` needs no undefined check and `reset`
 * has something to go back to.
 *
 * Platform-free and clock-free like the tree that reads it: a value that is a
 * time is a tick number some leaf wrote, never a wall-clock read.
 */
export class Blackboard<S extends object> {
  private readonly initial: Readonly<S>;
  private values: S;

  constructor(initial: S) {
    this.initial = { ...initial };
    this.values = { ...initial };
  }

  get<K extends keyof S>(key: K): S[K] {
    return this.values[key];
  }

  set<K extends keyof S>(key: K, value: S[K]): void {
    this.values[key] = value;
  }

  /** Every key back to the value it was built with. */
  reset(): void {
    this.values = { ...this.initial };
  }

  /** A copy of the current values, for a debug view or a test. */
  snapshot(): Readonly<S> {
    return { ...this.values };
  }
}
