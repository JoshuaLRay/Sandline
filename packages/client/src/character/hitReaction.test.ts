/**
 * T-2.27, the numbers: what a hit does to the body that took it, before any
 * bone is involved. Direction from the shooter's position in the target's own
 * frame, magnitude from the damage, the head only on a head-zone hit, and a
 * recovery that is a closed form of the age.
 */
import { describe, expect, it } from 'vitest';
import {
  FROM_THE_FRONT,
  REACTION_DECAY_RATE,
  REACTION_FULL_DAMAGE,
  REACTION_SETTLE_FRACTION,
  REACTION_TURN_RAD,
  hitReactionFrom,
  reactionAt,
  reactionSeconds,
  shooterDirection,
} from './hitReaction.ts';

/** The soldier faces +Z (yaw 0) unless a test says otherwise. */
const FACING_Z = 0;
const LETHAL = REACTION_FULL_DAMAGE;

describe('where the shooter was, in the target\'s frame (T-2.27)', () => {
  it('reads a shooter on the soldier\'s left as left, and turns with the soldier', () => {
    // +X is the soldier's left when they face +Z.
    const onTheLeft = shooterDirection(5, 0, FACING_Z);
    expect(onTheLeft.left).toBeCloseTo(1, 12);
    expect(onTheLeft.forward).toBeCloseTo(0, 12);
    // Turn the soldier to face that same shooter: now they are in front.
    const faced = shooterDirection(5, 0, Math.PI / 2);
    expect(faced.forward).toBeCloseTo(1, 12);
    expect(faced.left).toBeCloseTo(0, 12);
  });

  it('is a unit direction, and a shooter standing on the target is a shot from the front', () => {
    const d = shooterDirection(3, -4, 0.7);
    expect(Math.hypot(d.forward, d.left)).toBeCloseTo(1, 12);
    expect(shooterDirection(0, 0, 0)).toEqual(FROM_THE_FRONT);
    expect(shooterDirection(1, 0, Number.NaN)).toEqual(FROM_THE_FRONT);
  });
});

describe('the reaction one hit provokes (T-2.27)', () => {
  it('turns the chest away from the shooter: opposite signs from the left and the right', () => {
    const fromLeft = hitReactionFrom(LETHAL, 'torso', shooterDirection(5, 0, FACING_Z));
    const fromRight = hitReactionFrom(LETHAL, 'torso', shooterDirection(-5, 0, FACING_Z));
    // Away from a shooter on the left is a turn to the soldier's right, which
    // is negative about the model's up axis.
    expect(fromLeft.turn).toBeLessThan(0);
    expect(fromRight.turn).toBeGreaterThan(0);
    expect(fromLeft.turn).toBeCloseTo(-fromRight.turn, 12);
    expect(Math.abs(fromLeft.turn)).toBeCloseTo(REACTION_TURN_RAD, 12);
  });

  it('tilts back from a shot in front and forward from one behind, and neither from the side', () => {
    expect(hitReactionFrom(LETHAL, 'torso', shooterDirection(0, 5, FACING_Z)).lean).toBeGreaterThan(0);
    expect(hitReactionFrom(LETHAL, 'torso', shooterDirection(0, -5, FACING_Z)).lean).toBeLessThan(0);
    expect(hitReactionFrom(LETHAL, 'torso', shooterDirection(5, 0, FACING_Z)).lean).toBeCloseTo(0, 12);
  });

  it('scales with the damage, and is bounded above it', () => {
    const from = shooterDirection(5, 0, FACING_Z);
    const light = hitReactionFrom(REACTION_FULL_DAMAGE / 4, 'torso', from);
    const full = hitReactionFrom(REACTION_FULL_DAMAGE, 'torso', from);
    const absurd = hitReactionFrom(REACTION_FULL_DAMAGE * 10, 'torso', from);
    expect(Math.abs(light.turn)).toBeCloseTo(Math.abs(full.turn) / 4, 12);
    expect(Math.abs(absurd.turn)).toBe(Math.abs(full.turn));
    expect(hitReactionFrom(0, 'torso', from).turn).toBe(-0);
  });

  it('snaps the head on a head-zone hit and on no other', () => {
    const from = shooterDirection(5, 0, FACING_Z);
    expect(hitReactionFrom(LETHAL, 'head', from).head).toBe(1);
    expect(hitReactionFrom(LETHAL, 'torso', from).head).toBe(0);
    expect(hitReactionFrom(LETHAL, 'limb', from).head).toBe(0);
    // The zone says where, the damage still says how much.
    expect(hitReactionFrom(REACTION_FULL_DAMAGE / 2, 'head', from).head).toBeCloseTo(0.5, 12);
  });
});

describe('the recovery (T-2.27)', () => {
  it('is the T-2.02 curve, and the same envelope however it is sampled', () => {
    const peak = hitReactionFrom(LETHAL, 'head', shooterDirection(5, 2, FACING_Z));
    expect(reactionAt(peak, 0)).toEqual(peak);
    const t = 0.1;
    expect(reactionAt(peak, t).turn).toBeCloseTo(peak.turn * Math.exp(-REACTION_DECAY_RATE * t), 12);
    // At 30 fps and at 120 fps the same moment is the same pose: the reaction
    // is a function of the age, never of the frames that got there.
    const at30 = reactionAt(peak, 6 / 30);
    const at120 = reactionAt(peak, 24 / 120);
    expect(at30).toEqual(at120);
  });

  it('has recovered to under the settle fraction by the end, derived from the rate', () => {
    const peak = hitReactionFrom(LETHAL, 'torso', shooterDirection(5, 0, FACING_Z));
    const end = reactionSeconds();
    expect(end).toBeCloseTo(-Math.log(REACTION_SETTLE_FRACTION) / REACTION_DECAY_RATE, 12);
    expect(Math.abs(reactionAt(peak, end).turn)).toBeLessThanOrEqual(Math.abs(peak.turn) * REACTION_SETTLE_FRACTION + 1e-12);
    expect(Math.abs(reactionAt(peak, end / 2).turn)).toBeGreaterThan(Math.abs(reactionAt(peak, end).turn));
  });
});
