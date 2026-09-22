/**
 * T-2.32: the pouch, the arc, and the handover from a predicted grenade to the
 * server's own.
 *
 * All numbers, no THREE, so the handover — the part with actual sequencing in
 * it — is tested here rather than only seen in a browser.
 */
import { describe, expect, it } from 'vitest';
import {
  PROJECTILE_IDS,
  type ProjectileWorld,
  TICK_SECONDS,
  createProjectileState,
  getProjectile,
  launchVelocity,
  projectileArc,
  stepProjectile,
} from '@sandline/shared';
import { ARC_PREVIEW_SECONDS, GHOST_ORPHAN_SECONDS, LAUNCH_AHEAD_M, ThrowQA } from './ThrowQA.ts';

const FRAG = 0;
const ROCKET = 1;
const OUR_SLOT = 2;
const OPEN: ProjectileWorld = { boxes: [], groundY: 0 };
const EYE = { x: 0, y: 1.55, z: 0 };
const FORWARD = { x: 0, y: 0, z: 1 };

describe('the pouch (T-2.32)', () => {
  it('starts with what the data says is carried, and spends it', () => {
    const throws = new ThrowQA();
    expect(throws.count(FRAG)).toBe(getProjectile(PROJECTILE_IDS[FRAG]).carried);
    expect(throws.throwFrom(EYE, 0, 0, 0)).not.toBeNull();
    expect(throws.count(FRAG)).toBe(getProjectile(PROJECTILE_IDS[FRAG]).carried - 1);
  });

  it('holds its own cooldown, so the picture cannot promise what the server refuses', () => {
    const throws = new ThrowQA();
    expect(throws.throwFrom(EYE, 0, 0, 0)).not.toBeNull();
    expect(throws.canThrow(0.1)).toBe(false);
    expect(throws.throwFrom(EYE, 0, 0, 0.1)).toBeNull();
    const cooldown = getProjectile(PROJECTILE_IDS[FRAG]).cooldownSeconds;
    expect(throws.cooldownLeft(0)).toBeCloseTo(cooldown, 6);
    expect(throws.canThrow(cooldown)).toBe(true);
  });

  it('refuses when the pouch is empty, and a reset gives it back', () => {
    const throws = new ThrowQA();
    const def = getProjectile(PROJECTILE_IDS[FRAG]);
    let now = 0;
    for (let i = 0; i < def.carried; i += 1) {
      expect(throws.throwFrom(EYE, 0, 0, now)).not.toBeNull();
      now += def.cooldownSeconds;
    }
    expect(throws.count(FRAG)).toBe(0);
    expect(throws.throwFrom(EYE, 0, 0, now)).toBeNull();
    throws.reset();
    expect(throws.count(FRAG)).toBe(def.carried);
    expect(throws.canThrow(0)).toBe(true);
  });

  it('selects within the pouch and nowhere else', () => {
    const throws = new ThrowQA();
    throws.select(ROCKET);
    expect(throws.kind).toBe(ROCKET);
    expect(throws.def.id).toBe(PROJECTILE_IDS[ROCKET]);
    throws.select(7);
    expect(throws.kind).toBe(ROCKET);
    throws.select(-1);
    expect(throws.kind).toBe(ROCKET);
  });
});

describe('the arc the thrower is shown (T-2.32)', () => {
  it('is `projectileArc`\'s own points, not a second integrator', () => {
    const throws = new ThrowQA();
    const def = throws.def;
    const from = throws.origin(EYE, FORWARD, OPEN);
    const mine = throws.arc(from, 0, 0, OPEN);
    const theirs = projectileArc(def, from, launchVelocity(def, 0, 0), {
      dt: TICK_SECONDS,
      maxSeconds: Math.min(def.fuseSeconds, ARC_PREVIEW_SECONDS),
      world: OPEN,
    });
    expect(mine.points.length).toBe(theirs.points.length);
    for (let i = 0; i < mine.points.length; i += 1) {
      expect(mine.points[i]).toEqual(theirs.points[i]);
    }
    expect(mine.detonation).toEqual(theirs.detonation);
  });

  it('starts where the throw starts: ahead of the eye, clamped by the world', () => {
    const throws = new ThrowQA();
    const from = throws.origin(EYE, FORWARD, OPEN);
    expect(from.z).toBeCloseTo(LAUNCH_AHEAD_M, 6);
    expect(from.y).toBeCloseTo(EYE.y, 6);
  });
});

describe('the ghost and its twin (T-2.32)', () => {
  it('flies the ghost on the same stepper the server flies the real one on', () => {
    const throws = new ThrowQA();
    const from = throws.origin(EYE, FORWARD, OPEN);
    const ghost = throws.throwFrom(from, 0, 0, 0);
    if (!ghost) throw new Error('nothing thrown');

    let expected = createProjectileState(from, launchVelocity(throws.def, 0, 0));
    for (let i = 0; i < 10; i += 1) {
      throws.tick(OPEN);
      expected = stepProjectile(throws.def, expected, TICK_SECONDS, OPEN).state;
    }
    expect(ghost.state.x).toBe(expected.x);
    expect(ghost.state.y).toBe(expected.y);
    expect(ghost.state.z).toBe(expected.z);
    // And the frame between ticks has both ends to interpolate across.
    expect(ghost.prev.z).not.toBe(ghost.state.z);
  });

  it('binds to the replicated twin, hides it, and retires when it goes off', () => {
    const throws = new ThrowQA();
    const ghost = throws.throwFrom(EYE, 0, 0, 0);
    if (!ghost) throw new Error('nothing thrown');

    // Nothing replicated yet: the ghost is the only thing on screen.
    throws.bind([], OUR_SLOT);
    expect(throws.ghosts).toHaveLength(1);
    expect(ghost.netId).toBeNull();

    // The server's copy arrives. It is ours, so the ghost adopts it and the
    // twin stays out of the picture.
    const twin = { netId: 2001, kind: FRAG, ownerSlot: OUR_SLOT };
    throws.bind([twin], OUR_SLOT);
    expect(ghost.netId).toBe(2001);
    expect(throws.isGhosted(2001)).toBe(true);
    expect(throws.takeRetired()).toEqual([]);

    // It goes off: the twin leaves the world, and so does the ghost.
    throws.bind([], OUR_SLOT);
    expect(throws.ghosts).toHaveLength(0);
    expect(throws.takeRetired()).toEqual([ghost.id]);
    expect(throws.isGhosted(2001)).toBe(false);
  });

  it('never adopts somebody else\'s grenade, or one of the wrong kind', () => {
    const throws = new ThrowQA();
    const ghost = throws.throwFrom(EYE, 0, 0, 0);
    if (!ghost) throw new Error('nothing thrown');
    throws.bind([{ netId: 2002, kind: FRAG, ownerSlot: OUR_SLOT + 1 }], OUR_SLOT);
    expect(ghost.netId).toBeNull();
    throws.bind([{ netId: 2003, kind: ROCKET, ownerSlot: OUR_SLOT }], OUR_SLOT);
    expect(ghost.netId).toBeNull();
    expect(throws.isGhosted(2002)).toBe(false);
    expect(throws.isGhosted(2003)).toBe(false);
  });

  it('gives two throws two twins, oldest first', () => {
    const throws = new ThrowQA();
    const first = throws.throwFrom(EYE, 0, 0, 0);
    const second = throws.throwFrom(EYE, 0, 0, getProjectile(PROJECTILE_IDS[FRAG]).cooldownSeconds);
    if (!first || !second) throw new Error('nothing thrown');
    throws.bind(
      [
        { netId: 2010, kind: FRAG, ownerSlot: OUR_SLOT },
        { netId: 2011, kind: FRAG, ownerSlot: OUR_SLOT },
      ],
      OUR_SLOT,
    );
    expect(first.netId).toBe(2010);
    expect(second.netId).toBe(2011);
  });

  it('retires a ghost whose throw the server never answered', () => {
    const throws = new ThrowQA();
    const ghost = throws.throwFrom(EYE, 0, 0, 0);
    if (!ghost) throw new Error('nothing thrown');
    const ticks = Math.ceil(GHOST_ORPHAN_SECONDS / TICK_SECONDS) + 1;
    for (let i = 0; i < ticks; i += 1) throws.tick(OPEN);
    expect(throws.ghosts).toHaveLength(0);
    expect(throws.takeRetired()).toEqual([ghost.id]);
  });

  it('does not go off by itself: the blast is the server\'s', () => {
    const throws = new ThrowQA();
    const ghost = throws.throwFrom(EYE, 0, 0, 0);
    if (!ghost) throw new Error('nothing thrown');
    // Bound, so the orphan rule cannot be what keeps it alive.
    throws.bind([{ netId: 2020, kind: FRAG, ownerSlot: OUR_SLOT }], OUR_SLOT);
    const past = Math.ceil((throws.def.fuseSeconds + 1) / TICK_SECONDS);
    for (let i = 0; i < past; i += 1) {
      throws.tick(OPEN);
      throws.bind([{ netId: 2020, kind: FRAG, ownerSlot: OUR_SLOT }], OUR_SLOT);
    }
    expect(throws.ghosts).toHaveLength(1);
    expect(throws.takeRetired()).toEqual([]);
  });
});
