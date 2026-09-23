/**
 * Projectile tuning (the grenade that did not throw far enough).
 *
 * Node-only: the paste-back order and `throwReach` need no DOM. The session
 * side — a tuned row is what the in-page session throws — is here too, over
 * `LocalServer`, since that is the path the panel's edits take.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PROJECTILES, getProjectile } from '@sandline/shared';
import { initNav } from '@sandline/server/nav';
import { PROJECTILE_JSON_ORDER, throwReach } from './ProjectilePanel.ts';
import { ThrowQA } from '../weapons/ThrowQA.ts';
import { DEFAULT_LINK, LocalServer } from '../net/LocalServer.ts';

describe('projectile panel paste-back', () => {
  it('lists every field of every shipped projectile exactly once, and nothing else', () => {
    for (const def of Object.values(PROJECTILES)) expect([...PROJECTILE_JSON_ORDER].sort()).toEqual(Object.keys(def).sort());
    expect(new Set(PROJECTILE_JSON_ORDER).size).toBe(PROJECTILE_JSON_ORDER.length);
  });
});

describe('how far a grenade goes', () => {
  const frag = getProjectile('frag');

  it('throws a soldier’s distance: past 15 m level, past 30 m at its best angle', () => {
    const level = throwReach(frag, 0);
    const best = Math.max(...[15, 20, 25, 30, 35, 40, 45].map((p) => throwReach(frag, p).firstLandM ?? 0));
    console.log(`frag: level lands ${level.firstLandM?.toFixed(1)} m (goes off ${level.goesOffM.toFixed(1)} m); best angle lands ${best.toFixed(1)} m`);
    expect(level.firstLandM!).toBeGreaterThan(15);
    expect(best).toBeGreaterThan(30);
  });

  it('lands before it goes off at every angle up to 45°: no airbursts from a normal throw', () => {
    for (const p of [0, 15, 30, 45]) expect(throwReach(frag, p).firstLandM, `${p}°`).not.toBeNull();
  });

  it('dropped at your feet, still goes off at your feet', () => {
    expect(throwReach(frag, -90).goesOffM).toBeLessThan(2);
  });

  it('reads the row it is given: faster goes further, more gravity less far', () => {
    const base = throwReach(frag, 20).firstLandM!;
    expect(throwReach({ ...frag, speedMPerSec: frag.speedMPerSec * 1.5 }, 20).firstLandM!).toBeGreaterThan(base);
    expect(throwReach({ ...frag, gravity: frag.gravity * 2 }, 20).firstLandM!).toBeLessThan(base);
  });
});

describe('tuning reaches the in-page session', () => {
  beforeAll(() => initNav());

  it('hands each edit on, clamps the pouch to a lowered load-out, and resets to the data', () => {
    const throws = new ThrowQA();
    const seen: { index: number; speed: number }[] = [];
    throws.onTune = (index, def) => seen.push({ index, speed: def.speedMPerSec });
    throws.def.speedMPerSec = 33;
    throws.tuned();
    expect(seen).toEqual([{ index: 0, speed: 33 }]);
    throws.def.carried = 1;
    throws.tuned();
    expect(throws.count()).toBe(1);
    throws.resetDef();
    expect(throws.def.speedMPerSec).toBe(getProjectile('frag').speedMPerSec);
    // The shipped table itself is never touched.
    expect(getProjectile('frag').speedMPerSec).not.toBe(33);
  });

  it('throws the tuned row in that session only', async () => {
    const tuned = await LocalServer.create(DEFAULT_LINK);
    const other = await LocalServer.create(DEFAULT_LINK);
    tuned.tuneProjectile(0, { ...getProjectile('frag'), speedMPerSec: 40, fuseSeconds: 9 });
    expect(tuned.projectileDef(0)?.speedMPerSec).toBe(40);
    expect(other.projectileDef(0)?.speedMPerSec).toBe(getProjectile('frag').speedMPerSec);
    // Out of range is ignored rather than thrown.
    expect(() => tuned.tuneProjectile(9, getProjectile('frag'))).not.toThrow();
  });
});
