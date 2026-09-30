/**
 * U-049: the support's 20% discount on timed interactions. The revive is the
 * one the host times per reviver; the health kit's 8 s is in the client
 * package's healthKit test (it needs a hosted room).
 */
import { describe, expect, it } from 'vitest';
import { DAMAGE, TICK_SECONDS } from '@sandline/shared';
import { Session } from './Session.ts';

interface Internals {
  updateRevives(): void;
  reviveSeconds(reviver: number): number;
  kitSeconds(slot: unknown): number;
}

function reviveTicks(reviver: number): number {
  const session = new Session(undefined, '', 'range', { roomLobby: true });
  const x = session as unknown as Internals;
  const down = session.slots[0]!;
  const helper = session.slots[reviver]!;
  Object.assign(down.health, { current: 0, downedAt: 1 });
  down.state = { ...down.state, x: 0, y: 0, z: 0 };
  helper.state = { ...helper.state, x: 0.5, y: 0, z: 0 };
  // The helper's hand on E: a bot's brain reading interact, as holdingInteract asks.
  (helper as unknown as { brain: { read(k: string): boolean } }).brain = { read: (k) => k === 'interact' };
  let ticks = 0;
  while (down.health.current === 0 && ticks < 400) {
    x.updateRevives();
    ticks += 1;
  }
  return ticks;
}

describe('interaction time scale (U-049)', () => {
  it('the support (slot 2) takes 0.8 of the base time to revive; another character is unchanged', () => {
    const session = new Session(undefined, '', 'range', { roomLobby: true });
    const x = session as unknown as Internals;
    expect(x.reviveSeconds(2)).toBeCloseTo(DAMAGE.downed.reviveSeconds * 0.8, 6);
    for (const n of [0, 1, 3, 4, 5]) expect(x.reviveSeconds(n), `slot ${n}`).toBe(DAMAGE.downed.reviveSeconds);
    expect(x.kitSeconds(session.slots[2])).toBeCloseTo(8, 6);
    expect(x.kitSeconds(session.slots[0])).toBe(10);
  });

  it('a real revive by the support finishes sooner, and by anyone else at the base time', () => {
    const base = Math.ceil(DAMAGE.downed.reviveSeconds / TICK_SECONDS);
    expect(reviveTicks(1)).toBeGreaterThanOrEqual(base);
    expect(reviveTicks(1)).toBeLessThanOrEqual(base + 2);
    const support = reviveTicks(2);
    expect(support).toBeGreaterThanOrEqual(Math.ceil(base * 0.8));
    expect(support).toBeLessThanOrEqual(Math.ceil(base * 0.8) + 2);
    expect(support).toBeLessThan(base);
  });
});
