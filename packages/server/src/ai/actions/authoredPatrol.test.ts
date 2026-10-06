import { describe, expect, it } from 'vitest';
import { authoredPatrolPauseTicks, patrolPoint, stepAuthoredPatrol, type EnemyPosture } from './posture.ts';
function patrol(): EnemyPosture { return { kind: 'patrol', post: { x: 0, y: 0, z: 0 }, face: { x: 0, z: -10 }, route: [{ x: 0, y: 8, z: 5 }, { x: 0, y: 8, z: 10 }], area: null, leg: 0, patrol: { direction: 1, pauseTicks: 0, pauseTotalTicks: authoredPatrolPauseTicks(3), active: true } }; }
describe('authored reversible patrol phase (U-130)', () => {
  it('pauses for exactly 90 locomotion ticks at the initial endpoint, then departs', () => {
    const p = patrol();
    for (let i = 0; i < 90; i++) expect(stepAuthoredPatrol(p, p.post)).toBeNull();
    expect(stepAuthoredPatrol(p, p.post)!.goal).toEqual(patrolPoint(p, 1));
    expect(p.leg).toBe(1);
  });
  it('passes intermediate points without pausing and reverses with a three-second endpoint pause', () => {
    const p = patrol(); p.leg = 1;
    expect(stepAuthoredPatrol(p, patrolPoint(p, 1))!.goal).toEqual(patrolPoint(p, 2));
    const end = patrolPoint(p, 2);
    for (let i = 0; i < 90; i++) expect(stepAuthoredPatrol(p, end)).toBeNull();
    expect(p.patrol!.direction).toBe(-1); expect(p.leg).toBe(1);
    expect(stepAuthoredPatrol(p, end)!.goal).toEqual(patrolPoint(p, 1));
    expect(stepAuthoredPatrol(p, patrolPoint(p, 1))!.goal).toEqual(p.post);
    for (let i = 0; i < 90; i++) expect(stepAuthoredPatrol(p, p.post)).toBeNull();
    expect(p.patrol!.direction).toBe(1);
  });
  it('never advances merely because x/z match on a different floor', () => {
    const p = patrol(); p.leg = 1;
    expect(stepAuthoredPatrol(p, { x: 0, y: 0, z: 5 })!.goal.y).toBe(8);
    expect(p.leg).toBe(1);
  });
  it('retains reverse phase and remaining pause through JSON with no absolute process time', () => {
    const p = patrol(); p.leg = 2;
    for (let i = 0; i < 31; i++) stepAuthoredPatrol(p, { x: 0, y: 8, z: 10 });
    const copy = JSON.parse(JSON.stringify(p)) as EnemyPosture;
    expect(copy.patrol!.pauseTicks).toBe(59);
    for (let i = 0; i < 59; i++) expect(stepAuthoredPatrol(copy, { x: 0, y: 8, z: 10 })).toBeNull();
    expect(stepAuthoredPatrol(copy, { x: 0, y: 8, z: 10 })!.goal).toEqual(patrolPoint(copy, 1));
  });
});
