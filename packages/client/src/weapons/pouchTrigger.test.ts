import { describe, expect, it } from 'vitest';
import { PouchTrigger, type PouchTriggerSample } from './pouchTrigger.ts';

const idle: PouchTriggerSample = {
  holding: true,
  kind: 'thrown',
  triggerEdge: false,
  triggerHeld: false,
  triggerReleased: false,
  ads: false,
  throwHeld: false,
  throwReleased: false,
};

describe('the trigger with a grenade in hand', () => {
  it('aims while held and throws on the release', () => {
    const t = new PouchTrigger();
    expect(t.update({ ...idle, triggerEdge: true, triggerHeld: true })).toEqual({ aiming: true, launch: false });
    expect(t.update({ ...idle, triggerHeld: true })).toEqual({ aiming: true, launch: false });
    expect(t.aiming).toBe(true);
    expect(t.update({ ...idle, triggerReleased: true })).toEqual({ aiming: false, launch: true });
    expect(t.update(idle)).toEqual({ aiming: false, launch: false });
  });

  it('throws a click whose press and release land in one tick', () => {
    const t = new PouchTrigger();
    expect(t.update({ ...idle, triggerEdge: true, triggerReleased: true }).launch).toBe(true);
  });

  it('does not throw on the release of a press made before it was in hand', () => {
    const t = new PouchTrigger();
    t.update({ ...idle, holding: false, triggerEdge: true, triggerHeld: true });
    expect(t.update({ ...idle, triggerHeld: true })).toEqual({ aiming: false, launch: false });
    expect(t.update({ ...idle, triggerReleased: true }).launch).toBe(false);
  });

  it('cancels a throw whose button came up without a release (focus lost)', () => {
    const t = new PouchTrigger();
    t.update({ ...idle, triggerEdge: true, triggerHeld: true });
    expect(t.update(idle)).toEqual({ aiming: false, launch: false });
    expect(t.update({ ...idle, triggerReleased: true }).launch).toBe(false);
  });

  it('forgets an armed throw when a gun is switched to', () => {
    const t = new PouchTrigger();
    t.update({ ...idle, triggerEdge: true, triggerHeld: true });
    t.update({ ...idle, holding: false, triggerHeld: true });
    expect(t.update({ ...idle, triggerReleased: true }).launch).toBe(false);
  });
});

describe('the trigger with a rocket in hand', () => {
  const rocket = { ...idle, kind: 'rocket' as const };
  it('fires on the press, and aims down the sight', () => {
    const t = new PouchTrigger();
    expect(t.update({ ...rocket, triggerEdge: true, triggerHeld: true })).toEqual({ aiming: false, launch: true });
    expect(t.update({ ...rocket, triggerHeld: true }).launch).toBe(false);
    expect(t.update({ ...rocket, triggerReleased: true }).launch).toBe(false);
    expect(t.update({ ...rocket, ads: true })).toEqual({ aiming: true, launch: false });
  });
});

describe('the quick-throw key', () => {
  it('aims and throws the selected item whatever is in hand', () => {
    const t = new PouchTrigger();
    expect(t.update({ ...idle, holding: false, throwHeld: true })).toEqual({ aiming: true, launch: false });
    expect(t.update({ ...idle, holding: false, throwReleased: true })).toEqual({ aiming: false, launch: true });
  });

  it('ignores the trigger while a gun is in hand', () => {
    const t = new PouchTrigger();
    expect(t.update({ ...idle, holding: false, triggerEdge: true, triggerHeld: true })).toEqual({ aiming: false, launch: false });
    expect(t.update({ ...idle, holding: false, triggerReleased: true }).launch).toBe(false);
  });
});
