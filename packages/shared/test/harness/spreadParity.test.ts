/**
 * Cross-engine spread parity (T-1.17, ADR-014).
 *
 * This file lives in `test/harness/` rather than beside the module because
 * `vitest.browser.config.ts` runs exactly this directory (plus `src/math/`) on
 * Firefox (SpiderMonkey) and WebKit (JSC). A V8-only test proves nothing about
 * spread parity: the server is Node and the common client is Chrome, so a
 * transcendental sneaking into the spread path would agree perfectly in
 * development and diverge only for Safari and Firefox players.
 *
 * EXACT equality is the correct assertion here, and one of the few places it
 * is. Weapon spread is an integer path end to end — an integer hash of
 * (tick, entityId, shotIndex, pelletIndex), an integer index into the committed
 * trig table, and IEEE-754 multiply and add. There is no transcendental in it
 * to be approximated differently, so there is no epsilon to justify. Contrast
 * the physics and movement harnesses in this directory, which assert a bound
 * and log the number (§2.3). If this test ever needs a tolerance, something has
 * started calling Math.sin — fix that rather than loosening this.
 *
 * The constants below are the fixture's own (§2.3): nothing here reads
 * data/weapons.json, so retuning a weapon cannot make this fail.
 */
import { describe, expect, it } from 'vitest';
import { degToAngle, dirFromYawPitch, pelletDirection, pelletSeed } from '../../src/sim/weapons.ts';

const YAW = 700;
const PITCH = 120;
const ENTITY = 3;
const SHOT = 17;
const CONE = degToAngle(3);

/**
 * Golden vectors, generated once on Node and committed. [tick, pellet, x, y, z].
 * Regenerating these is a decision, not routine maintenance: they only change
 * if the trig table, the PRNG or the spread algorithm changes, and each of
 * those is a deliberate act that should be visible in the diff.
 */
const GOLDEN: readonly (readonly [number, number, number, number, number])[] = [
  [1000, 0, 0.8510255584880533, 0.17247308399679595, 0.49599247383073386],
  [1000, 1, 0.8715208532786405, 0.2191012401568698, 0.43868673203345465],
  [1000, 2, 0.8458768413959257, 0.17096188876030122, 0.505236975865348],
  [1001, 0, 0.8480906080490601, 0.1664259035404641, 0.5030355247591523],
  [1001, 1, 0.8381238649171866, 0.20410896609281687, 0.5058536517776647],
  [1001, 2, 0.8836455531006902, 0.1935855872958036, 0.42625714876904286],
  [1002, 0, 0.8776643689422627, 0.21161132736922755, 0.4300301171060153],
  [1002, 1, 0.8411420579595639, 0.18153160826112497, 0.5094372518119176],
  [1002, 2, 0.8656786345339356, 0.21760427463848364, 0.4508313225259752],
  [1003, 0, 0.8763084610803522, 0.1543129730130201, 0.4563671629279077],
  [1003, 1, 0.8814066878268678, 0.19509032201612825, 0.43018835050442006],
  [1003, 2, 0.8407285979741136, 0.1935855872958036, 0.5056679196269225],
];

describe('weapon spread parity (T-1.17)', () => {
  it('reproduces the committed vectors bit for bit on this engine', () => {
    for (const [tick, pellet, x, y, z] of GOLDEN) {
      const d = pelletDirection(YAW, PITCH, CONE, pelletSeed(tick, ENTITY, SHOT, pellet));
      expect(d.x).toBe(x);
      expect(d.y).toBe(y);
      expect(d.z).toBe(z);
    }
  });

  it('seeds identically from the integer tuple alone', () => {
    // Nothing is sent over the wire to make the two sides agree; both derive
    // the seed from numbers they already have.
    expect(pelletSeed(1000, ENTITY, SHOT, 0)).toBe(642617094);
    expect(pelletSeed(1000, ENTITY, SHOT, 1)).toBe(pelletSeed(1000, ENTITY, SHOT, 1));
  });

  it('collapses to the exact aim direction at zero cone', () => {
    expect(pelletDirection(YAW, PITCH, 0, pelletSeed(1, 1, 1, 1))).toEqual(dirFromYawPitch(YAW, PITCH));
  });
});
