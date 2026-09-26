/**
 * Emplacements as data and rules (T-4.29): the table parses and refuses by
 * name; the arc and elevation clamps hold in wire units, across the wrap;
 * heat rises a shot at a time, overheats at 1, cools on the clock and fires
 * again below the threshold; a placed gun's gunner stands behind it and its
 * rounds leave above it; a world file's emplacements are validated.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPLACEMENT_IDS,
  EMPLACEMENTS,
  clampPitch,
  clampYawToArc,
  coolHeat,
  createHeat,
  degToWire,
  emplacementByIndex,
  emplacementFacing,
  getEmplacement,
  gunMuzzle,
  gunnerPlace,
  heatShot,
  heatToWire,
  loadWorld,
  parseEmplacements,
  parsePlacedEmplacements,
  signedWire,
  withinArc,
} from '../index.ts';

const NEST = getEmplacement('mg-nest');

const row = (extra: Record<string, unknown> = {}) => ({
  'mg-nest': {
    id: 'mg-nest',
    name: 'Nest',
    weapon: 'lmg',
    traverseDeg: 60,
    elevationDownDeg: 10,
    elevationUpDeg: 20,
    mountRangeM: 1.6,
    gunnerBackM: 0.7,
    gunHeightM: 1.2,
    heat: { perShot: 0.02, coolPerSecond: 0.1, fireBelow: 0.4 },
    ai: { takeWithinM: 4, leaveAfterSeconds: 3 },
    ...extra,
  },
});

describe('the emplacement table', () => {
  it('holds a row for every wire id, firing a weapons.json row', () => {
    expect([...EMPLACEMENTS.keys()]).toEqual([...EMPLACEMENT_IDS]);
    expect(NEST.weapon).toBe('lmg');
    expect(emplacementByIndex(0)?.id).toBe('mg-nest');
    expect(emplacementByIndex(3)).toBeNull();
  });

  it('refuses unknown keys, a weapon it does not know, a value out of range and a missing row, each by name', () => {
    expect(() => parseEmplacements(row({ shield: 1 }))).toThrow("unknown key 'shield'");
    expect(() => parseEmplacements(row({ weapon: 'minigun' }))).toThrow('emplacements.mg-nest.weapon');
    expect(() => parseEmplacements(row({ traverseDeg: 200 }))).toThrow('traverseDeg must be in [1, 179]');
    expect(() => parseEmplacements(row({ heat: { perShot: 0.1, coolPerSecond: 0.1 } }))).toThrow("missing 'fireBelow'");
    expect(() => parseEmplacements({ nest: row()['mg-nest'] })).toThrow("'nest' is not a wire id");
    expect(() => parseEmplacements({})).toThrow("no row for 'mg-nest'");
  });
});

describe('the arc and the elevation, in wire units', () => {
  it('holds a yaw inside the arc and lays one outside on the nearer stop, across the wrap', () => {
    const facing = degToWire(0);
    const half = degToWire(60);
    expect(clampYawToArc(facing, degToWire(30), 60)).toBe(degToWire(30));
    expect(clampYawToArc(facing, degToWire(90), 60)).toBe(half);
    // Just past the left stop, written the wire's way (a large positive yaw).
    expect(clampYawToArc(facing, 1024 - degToWire(90), 60)).toBe(1024 - half);
    expect(withinArc(facing, 1024 - degToWire(59), 60)).toBe(true);
    expect(withinArc(facing, 1024 - degToWire(61), 60)).toBe(false);
    // A facing near the wrap: a yaw across it is measured the short way round.
    const west = degToWire(350);
    expect(withinArc(west, degToWire(20), 60)).toBe(true);
    expect(clampYawToArc(west, degToWire(80), 60)).toBe((west + half) % 1024);
    expect(signedWire(1000)).toBe(-24);
    expect(signedWire(24)).toBe(24);
  });

  it('holds the pitch between the elevation limits', () => {
    expect(clampPitch(degToWire(10), NEST)).toBe(degToWire(10));
    expect(clampPitch(degToWire(45), NEST)).toBe(degToWire(20));
    expect(clampPitch(1024 - degToWire(30), NEST)).toBe(-degToWire(10));
    expect(clampPitch(-5, NEST)).toBe(-5);
  });
});

describe('heat', () => {
  it('rises a shot at a time, overheats at 1, cools on the clock and fires again below the threshold', () => {
    const heat = createHeat();
    heatShot(NEST, heat);
    expect(heat.heat).toBeCloseTo(NEST.heat.perShot);
    expect(heat.overheated).toBe(false);
    for (let i = 0; i < 200; i += 1) heatShot(NEST, heat);
    expect(heat.heat).toBe(1);
    expect(heat.overheated).toBe(true);
    expect(heatToWire(heat)).toBe(100);
    // Cooling to just above the threshold: still overheated.
    coolHeat(NEST, heat, (1 - NEST.heat.fireBelow - 0.01) / NEST.heat.coolPerSecond);
    expect(heat.overheated).toBe(true);
    coolHeat(NEST, heat, 0.02 / NEST.heat.coolPerSecond);
    expect(heat.overheated).toBe(false);
    expect(heat.heat).toBeLessThan(NEST.heat.fireBelow);
    coolHeat(NEST, heat, 1000);
    expect(heat.heat).toBe(0);
    expect(heatToWire(heat)).toBe(0);
  });
});

describe('a placed gun', () => {
  it('faces its yaw, its gunner stands behind it and its rounds leave above it', () => {
    const placed = { id: 'g', kind: 'mg-nest', x: 3, y: 0, z: 70.5, yawDeg: 270 };
    expect(emplacementFacing(placed)).toBe(768);
    // Facing −X: the gunner is `gunnerBackM` toward +X.
    const place = gunnerPlace(placed, NEST);
    expect(place.x).toBeCloseTo(3 + NEST.gunnerBackM, 5);
    expect(place.z).toBeCloseTo(70.5, 5);
    const north = gunnerPlace({ ...placed, yawDeg: 0 }, NEST);
    expect(north.z).toBeCloseTo(70.5 - NEST.gunnerBackM, 5);
    expect(gunMuzzle(placed, NEST)).toEqual({ x: 3, y: NEST.gunHeightM, z: 70.5 });
  });

  it('is validated as part of its world file, unknown kinds and keys refused by name', () => {
    const world = (emplacements: unknown) => ({ id: 'yard', cover: [], floor: { halfExtent: 20 }, emplacements });
    expect(loadWorld(world(undefined)).emplacements).toEqual([]);
    const one = loadWorld(world([{ id: 'g', kind: 'mg-nest', x: 1, y: 0, z: 2, yawDeg: 90 }]));
    expect(one.emplacements).toEqual([{ id: 'g', kind: 'mg-nest', x: 1, y: 0, z: 2, yawDeg: 90 }]);
    expect(() => loadWorld(world([{ id: 'g', kind: 'howitzer', x: 1, y: 0, z: 2, yawDeg: 90 }]))).toThrow('kind must be one of mg-nest');
    expect(() => loadWorld(world([{ id: 'g', kind: 'mg-nest', x: 1, y: 0, z: 2, yawDeg: 90, rot: 90 }]))).toThrow("unknown key 'rot'");
    expect(() => loadWorld(world([{ id: 'g', kind: 'mg-nest', x: 1, y: 0, z: 2, yawDeg: 90 }, { id: 'g', kind: 'mg-nest', x: 5, y: 0, z: 2, yawDeg: 0 }]))).toThrow("id 'g' is used twice");
    expect(() => parsePlacedEmplacements('w', { id: 'g' })).toThrow('emplacements must be a list');
  });
});
