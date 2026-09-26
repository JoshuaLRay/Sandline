/**
 * T-4.25: the player's HUD, widget by widget, as pure functions of state.
 * Nothing here touches a page: what the HUD would say for a state is the
 * whole question.
 */
import { describe, expect, it } from 'vitest';
import type { BotOrder, RosterEntry } from '@sandline/shared';
import {
  COMPASS_HALF_WINDOW_DEG,
  DAMAGE_DIRECTION_SECONDS,
  HIT_MARKER_SECONDS,
  ammoView,
  bearingDegrees,
  compassView,
  damageDirectionView,
  headingOf,
  hitMarkerOpacity,
  liveHits,
  squadRows,
  stanceOf,
  stripOffset,
  vitalsView,
  wrapDegrees,
} from './hudModel.ts';

const alive = { vitality: 'alive' as const, vitalTimer: 0, reviveProgress: 0, reviverName: '' };

describe('vitals (T-4.25)', () => {
  it('is the health as a fraction and a number while alive, toned by how much is left', () => {
    expect(vitalsView({ ...alive, health: 100, maxHealth: 100 })).toEqual({ fraction: 1, label: '100', tone: 'ok' });
    expect(vitalsView({ ...alive, health: 55, maxHealth: 100 })).toEqual({ fraction: 0.55, label: '55', tone: 'hurt' });
    expect(vitalsView({ ...alive, health: 12.4, maxHealth: 100 })).toEqual({ fraction: 0.124, label: '12', tone: 'critical' });
    // Nothing replicated yet: an empty bar, not a crash.
    expect(vitalsView({ ...alive, health: 0, maxHealth: 0 })).toEqual({ fraction: 0, label: '--', tone: 'ok' });
  });

  it('reads the bleed-out and the reviver while downed, and the respawn while dead', () => {
    expect(vitalsView({ health: 0, maxHealth: 100, vitality: 'downed', vitalTimer: 18, reviveProgress: 0, reviverName: '' }))
      .toEqual({ fraction: 0, label: 'DOWNED  18s', tone: 'downed' });
    expect(vitalsView({ health: 0, maxHealth: 100, vitality: 'downed', vitalTimer: 17.6, reviveProgress: 40, reviverName: 'kai' }))
      .toEqual({ fraction: 0.4, label: 'DOWNED  18s  kai 40%', tone: 'downed' });
    expect(vitalsView({ health: 0, maxHealth: 100, vitality: 'dead', vitalTimer: 4, reviveProgress: 0, reviverName: '' }))
      .toEqual({ fraction: 0, label: 'KILLED  4s', tone: 'dead' });
    expect(vitalsView({ health: 0, maxHealth: 100, vitality: 'dead', vitalTimer: 0, reviveProgress: 0, reviverName: '' }).label).toBe('KILLED');
  });
});

describe('ammo and the pouch (T-4.25)', () => {
  const pouch = [{ name: 'M67 frag', count: 2, selected: false }, { name: 'AT4', count: 1, selected: true }];
  it('is the magazine over its size, low at a quarter, empty at none, and the reload while it runs', () => {
    expect(ammoView({ weapon: 'MK4 Carbine', ammo: 21, magSize: 30, reloading: false, reloadFraction: 0, pouch }))
      .toEqual({ weapon: 'MK4 Carbine', magazine: '21 / 30', reloadFraction: 0, low: false, empty: false, pouch });
    expect(ammoView({ weapon: 'MK4 Carbine', ammo: 7, magSize: 30, reloading: false, reloadFraction: 0, pouch: [] })).toMatchObject({ magazine: '7 / 30', low: true, empty: false });
    expect(ammoView({ weapon: 'MK4 Carbine', ammo: 0, magSize: 30, reloading: false, reloadFraction: 0, pouch: [] })).toMatchObject({ magazine: '0 / 30', low: false, empty: true });
    expect(ammoView({ weapon: 'MK4 Carbine', ammo: 0, magSize: 30, reloading: true, reloadFraction: 0.4, pouch: [] })).toMatchObject({ magazine: 'RELOADING', reloadFraction: 0.4, low: false, empty: false });
  });
});

describe('stance (T-4.25)', () => {
  it('names what the body is doing, the more telling state first', () => {
    const base = { downed: false, vaulting: false, prone: false, crouched: false, grounded: true };
    expect(stanceOf(base)).toBe('standing');
    expect(stanceOf({ ...base, crouched: true })).toBe('crouched');
    expect(stanceOf({ ...base, prone: true, crouched: true })).toBe('prone');
    expect(stanceOf({ ...base, grounded: false, crouched: true })).toBe('airborne');
    expect(stanceOf({ ...base, vaulting: true, grounded: false })).toBe('vaulting');
    expect(stanceOf({ ...base, downed: true, prone: true })).toBe('downed');
  });
});

describe('the squad rows (T-4.25)', () => {
  const roster: RosterEntry[] = [
    { name: 'kai', human: true, classId: 'team-leader' },
    { name: '', human: false, classId: 'marksman' },
    { name: 'rae', human: true, classId: 'marksman' },
    { name: '', human: false, classId: 'marksman' },
    { name: '', human: false, classId: 'marksman' },
    { name: '', human: false, classId: 'marksman' },
  ];
  const orders: BotOrder[] = [{ slot: 1, order: 'move', point: { x: 1, y: 0, z: 2 }, target: null, from: 0 }];
  it('is six rows always: names for people, Bot for bots, the host\'s vitality and the order each bot is under', () => {
    const vitality = (slot: number) => (slot === 0 ? 'alive' : slot === 1 ? 'downed' : slot === 2 ? 'dead' : slot === 3 ? 'alive' : null);
    const rows = squadRows(roster, 2, vitality, orders);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({ slot: 0, label: 'kai', human: true, you: false, state: 'alive', order: '', classShort: 'TL' });
    expect(rows[1]).toEqual({ slot: 1, label: 'Bot', human: false, you: false, state: 'downed', order: 'move', classShort: 'MM' });
    expect(rows[2]).toEqual({ slot: 2, label: 'rae', human: true, you: true, state: 'dead', order: '', classShort: 'MM' });
    expect(rows[3]?.state).toBe('alive');
    expect(rows[4]?.state).toBe('unknown');
    expect(rows[5]).toEqual({ slot: 5, label: 'Bot', human: false, you: false, state: 'unknown', order: '', classShort: 'MM' });
  });
  it('is six rows of bots before the roster arrives', () => {
    const rows = squadRows([], -1, () => null, []);
    expect(rows.map((r) => r.label)).toEqual(['Bot', 'Bot', 'Bot', 'Bot', 'Bot', 'Bot']);
    expect(rows.every((r) => !r.you && r.state === 'unknown')).toBe(true);
  });
});

describe('the compass (T-4.25)', () => {
  it('bears north along +Z and east along -X, the soldier\'s right', () => {
    expect(bearingDegrees(0, 1)).toBe(0);
    expect(bearingDegrees(-1, 0)).toBe(90);
    expect(bearingDegrees(0, -1)).toBe(180);
    expect(bearingDegrees(1, 0)).toBe(270);
    // Facing +Z is heading 0; turning right (toward -X) grows the heading.
    expect(headingOf(0)).toBe(0);
    expect(headingOf(Math.atan2(-1, 0))).toBeCloseTo(90, 9);
    expect(headingOf(Math.atan2(1, 0))).toBeCloseTo(270, 9);
    expect(wrapDegrees(190)).toBe(-170);
    expect(wrapDegrees(-180)).toBe(180);
  });

  it('puts a marker on the strip by where it is relative to the look, and drops one behind the edges', () => {
    // Facing +Z: a marker at +X is on the LEFT, one at -X on the right.
    expect(stripOffset(270, 0)).toBe(-1);
    expect(stripOffset(45, 0)).toBeCloseTo(0.5, 9);
    expect(stripOffset(180, 0)).toBeNull();
    expect(stripOffset(0, 350)).toBeCloseTo(10 / COMPASS_HALF_WINDOW_DEG, 9);
    const view = compassView(0, { x: 0, z: 0 }, [
      { key: 'o1', kind: 'move', label: 'move', x: 3, z: 0 },
      { key: 'm1', kind: 'mark', label: 'mark', x: -3, z: 3 },
      { key: 'o2', kind: 'hold', label: 'hold', x: 0, z: -5 },
    ]);
    expect(view.heading).toBe(0);
    expect(view.ticks.map((t) => t.text)).toEqual(['N', 'NE', 'E', 'W', 'NW']);
    expect(view.ticks.find((t) => t.text === 'N')).toEqual({ text: 'N', offset: 0, major: true });
    expect(view.ticks.find((t) => t.text === 'E')?.offset).toBe(1);
    expect(view.markers.map((m) => m.key)).toEqual(['o1', 'm1']);
    expect(view.markers[0]).toMatchObject({ kind: 'move', offset: -1, distanceM: 3 });
    expect(view.markers[1]?.offset).toBeCloseTo(0.5, 9);
    expect(view.markers[1]?.distanceM).toBeCloseTo(Math.hypot(3, 3), 9);
  });

  it('turns with the player: the same marker moves the other way', () => {
    const marker = [{ key: 'o1', kind: 'attack' as const, label: 'attack', x: -4, z: 4 }];
    const ahead = compassView(Math.atan2(-1, 1), { x: 0, z: 0 }, marker);
    expect(ahead.heading).toBeCloseTo(45, 9);
    expect(ahead.markers[0]?.offset).toBeCloseTo(0, 9);
    const turnedRight = compassView(Math.atan2(-1, 0), { x: 0, z: 0 }, marker);
    expect(turnedRight.markers[0]?.offset).toBeCloseTo(-0.5, 9);
  });
});

describe('hit markers and the damage direction (T-4.25)', () => {
  it('a hit marker fades out over its life and is gone exactly at its end', () => {
    expect(hitMarkerOpacity(null, 5)).toBe(0);
    expect(hitMarkerOpacity(5, 5)).toBe(1);
    expect(hitMarkerOpacity(5, 5 + HIT_MARKER_SECONDS / 2)).toBeCloseTo(0.5, 9);
    expect(hitMarkerOpacity(5, 5 + HIT_MARKER_SECONDS)).toBe(0);
    expect(hitMarkerOpacity(5, 4.9)).toBe(0);
  });

  it('points each hit where it came from, around the reticle, fading with age', () => {
    const hits = [{ bearingDeg: 90, at: 10 }, { bearingDeg: 0, at: 10 - DAMAGE_DIRECTION_SECONDS }];
    // Facing north: a hit from the east is on the right, a quarter turn clockwise.
    const view = damageDirectionView(hits, 0, 10);
    expect(view).toEqual([{ angleDeg: 90, opacity: 1 }]);
    // Turned to face east, the same hit is straight ahead; half a life later it is half faded.
    const later = damageDirectionView(hits, Math.atan2(-1, 0), 10 + DAMAGE_DIRECTION_SECONDS / 2);
    expect(later).toHaveLength(1);
    expect(later[0]?.angleDeg).toBeCloseTo(0, 9);
    expect(later[0]?.opacity).toBeCloseTo(0.5, 9);
    expect(liveHits(hits, 10)).toEqual([hits[0]]);
    expect(liveHits(hits, 10 + DAMAGE_DIRECTION_SECONDS)).toEqual([]);
  });
});
