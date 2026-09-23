import { describe, expect, it } from 'vitest';
import { Blackboard } from './blackboard.ts';

type Board = { target: number | null; lastSeenTick: number; alert: boolean };

describe('Blackboard', () => {
  it('holds every key from construction and reads back what is set', () => {
    const bb = new Blackboard<Board>({ target: null, lastSeenTick: -1, alert: false });
    expect(bb.get('target')).toBeNull();
    bb.set('target', 7);
    bb.set('lastSeenTick', 120);
    expect(bb.get('target')).toBe(7);
    expect(bb.snapshot()).toEqual({ target: 7, lastSeenTick: 120, alert: false });
  });

  it('reset goes back to the initial values, which later sets never touch', () => {
    const initial: Board = { target: null, lastSeenTick: -1, alert: false };
    const bb = new Blackboard<Board>(initial);
    bb.set('alert', true);
    expect(initial.alert).toBe(false);
    bb.reset();
    expect(bb.get('alert')).toBe(false);
    bb.set('alert', true);
    bb.reset();
    expect(bb.get('alert')).toBe(false);
  });

  it('a snapshot is a copy', () => {
    const bb = new Blackboard<Board>({ target: null, lastSeenTick: -1, alert: false });
    const snap = bb.snapshot();
    bb.set('target', 3);
    expect(snap.target).toBeNull();
  });

  it('is typed by its shape', () => {
    const bb = new Blackboard<Board>({ target: null, lastSeenTick: -1, alert: false });
    // @ts-expect-error — a string is not a target
    bb.set('target', 'enemy');
    // @ts-expect-error — no such key
    bb.get('health');
  });
});
