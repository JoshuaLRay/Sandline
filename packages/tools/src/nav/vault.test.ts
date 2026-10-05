/**
 * Vault links (T-3.04): an off-mesh link across every box the controller
 * would vault, found by asking the controller (`tryStartVault`), both ends on
 * the mesh, flagged so path following knows to walk into it.
 *
 * Read from the COMMITTED range bake wherever the question is about the
 * range, so these fail if the links in the bytes and the rule that made them
 * ever part company.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOVE_CONFIG,
  createMoveState,
  loadWorld,
  requireWorld,
  tryStartVault,
} from '@sandline/shared';
import { NavMesh, initNav, pathLength } from '../../../server/src/ai/nav/NavMesh.ts';
import { bakedNavFor, loadWorldNavMesh } from '../../../server/src/ai/nav/bakedNav.ts';
import { DEFAULT_HITBOX } from '../../../server/src/net/lagComp.ts';
import {
  DEFAULT_NAV_AGENT,
  bakeNavMesh,
  dropLinks,
  navAgentFrom,
  navBakeHash,
  navConfigFor,
  onMesh,
  vaultLinks,
  worldSoup,
} from './bake.ts';

const range = requireWorld('range');
/** Either side of the low wall (x −12..−6, z −1.15..−0.85), 3 m apart. */
const SOUTH = { x: -8, y: 0, z: -2.5 };
const NORTH = { x: -8, y: 0, z: 0.5 };

describe('vault links on the range (T-3.04)', () => {
  let mesh: NavMesh;
  let bare: NavMesh;
  beforeAll(async () => {
    await initNav();
    mesh = loadWorldNavMesh('range');
    // The same world with no links at all: what "going round" costs.
    bare = NavMesh.load(await bakeNavMesh(worldSoup(range), navConfigFor(DEFAULT_NAV_AGENT)));
  });

  it('crosses the low wall by its link, both ways, shorter than going round', () => {
    for (const [from, to] of [[SOUTH, NORTH], [NORTH, SOUTH]] as const) {
      const over = mesh.path(from, to)!;
      const round = bare.path(from, to)!;
      expect(over.vaults).toHaveLength(1);
      expect(round.vaults).toEqual([]);
      const lengthOver = pathLength(over.points);
      const lengthRound = pathLength(round.points);
      console.log(`[vault] ${from.z < to.z ? 'south→north' : 'north→south'}: over ${lengthOver.toFixed(2)} m, round ${lengthRound.toFixed(2)} m`);
      expect(lengthOver).toBeLessThan(lengthRound);
      // The vault leg runs straight across the wall's short axis.
      const a = over.points[over.vaults[0]!]!;
      const b = over.points[over.vaults[0]! + 1]!;
      expect(Math.min(a.z, b.z)).toBeLessThan(-1.15);
      expect(Math.max(a.z, b.z)).toBeGreaterThan(-0.85);
    }
  });

  it('bakes only vault links, with both ends of every one on the mesh', () => {
    const links = mesh.links();
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.vault).toBe(true);
      expect(onMesh(mesh, link.from, DEFAULT_NAV_AGENT.climb), `from ${JSON.stringify(link.from)}`).toBe(true);
      expect(onMesh(mesh, link.to, DEFAULT_NAV_AGENT.climb), `to ${JSON.stringify(link.to)}`).toBe(true);
    }
  });

  it('every baked link is a vault the controller itself would start there', () => {
    for (const link of mesh.links()) {
      const dx = link.to.x - link.from.x;
      const dz = link.to.z - link.from.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      // Axis-aligned by construction: +Z 0, +X 256, −Z 512, −X 768.
      const yaw = Math.abs(dz) > Math.abs(dx) ? (dz > 0 ? 0 : 512) : dx > 0 ? 256 : 768;
      const state = createMoveState(link.from.x, 0, link.from.z);
      expect(tryStartVault(state, yaw, dx / len, dz / len, DEFAULT_MOVE_CONFIG, range.boxes)).not.toBeNull();
    }
  });

  it('gives the 2.4 m walls no usable link from the range mesh', () => {
    // Elevated sampling can find raw candidates from a nearby narrow post.
    // These are not usable routes: both ends still have to be on the mesh.
    // Ground-level starts must continue to refuse the tall walls outright.
    const walls = ['west-wall-a', 'west-wall-b', 'east-wall-a', 'east-wall-b'];
    for (const id of walls) expect(range.boxes.find((b) => b.id === id)!.maxY).toBeGreaterThan(DEFAULT_MOVE_CONFIG.vaultMaxHeight + 0.45);
    const candidates = vaultLinks(range);
    expect(candidates.filter((l) => walls.includes(l.box) && l.from.y <= DEFAULT_NAV_AGENT.climb)).toEqual([]);
    const linked = new Set(candidates.filter((l) => onMesh(bare, l.from, DEFAULT_NAV_AGENT.climb) && onMesh(bare, l.to, DEFAULT_NAV_AGENT.climb)).map((l) => l.box));
    for (const id of walls) expect(linked.has(id), id).toBe(false);
  });
});

describe('which boxes get a link (T-3.04)', () => {
  /** A thin wall of height `h` across the floor, clear ground both sides. */
  const wallOf = (h: number) =>
    loadWorld({ id: 'w', floor: { halfExtent: 10 }, cover: [{ id: 'wall', x: 0, y: 0, z: 0, w: 4, h, d: 0.3 }] });

  it('links a box at vault height and not one just above it', () => {
    const limit = DEFAULT_MOVE_CONFIG.vaultMaxHeight;
    expect(vaultLinks(wallOf(limit)).length).toBeGreaterThan(0);
    expect(vaultLinks(wallOf(limit + 0.05))).toEqual([]);
  });

  it('does not link a box low enough to step onto', () => {
    expect(vaultLinks(wallOf(DEFAULT_MOVE_CONFIG.stepHeight))).toEqual([]);
  });

  it('links both ways across a wall with clear ground on each side', () => {
    const yaws = new Set(vaultLinks(wallOf(1)).map((l) => l.yaw));
    expect(yaws.has(0)).toBe(true);
    expect(yaws.has(512)).toBe(true);
  });
});

describe('the staleness hash covers the vault (T-3.04)', () => {
  it('goes stale when any vault parameter is retuned', () => {
    const committed = bakedNavFor('range')!.hash;
    expect(navBakeHash(range)).toBe(committed);
    for (const change of [{ vaultMaxHeight: 1.4 }, { vaultDistance: 1.7 }, { vaultProbe: 0.4 }]) {
      const agent = navAgentFrom({ ...DEFAULT_MOVE_CONFIG, ...change }, DEFAULT_HITBOX);
      expect(navBakeHash(range, agent), JSON.stringify(change)).not.toBe(committed);
    }
  });
});

describe('drop links off raised tops (U-027)', () => {
  /** A block `w` × `d` and `h` high on open floor. */
  const blockOf = (h: number, w = 2.2, d = 1.6) =>
    loadWorld({ id: 'b', floor: { halfExtent: 10 }, cover: [{ id: 'block', x: 0, y: 0, z: 0, w, h, d }] });

  it('walks off every side of a top a soldier can vault onto, from inside the edge to the ground outside it', () => {
    const links = dropLinks(blockOf(1));
    expect(new Set(links.map((l) => l.yaw))).toEqual(new Set([0, 256, 512, 768]));
    for (const l of links) {
      expect(l.from.y).toBeCloseTo(1, 6);
      expect(l.to.y).toBeCloseTo(0, 6);
      // Starts on the top (inside the block's footprint), ends off it.
      expect(Math.abs(l.from.x) <= 1.1 && Math.abs(l.from.z) <= 0.8).toBe(true);
      expect(Math.abs(l.to.x) > 1.1 || Math.abs(l.to.z) > 0.8).toBe(true);
    }
  });

  it('none off a top low enough to step down from, and none off one higher than a vault', () => {
    expect(dropLinks(blockOf(DEFAULT_MOVE_CONFIG.stepHeight))).toEqual([]);
    expect(dropLinks(blockOf(DEFAULT_MOVE_CONFIG.vaultMaxHeight + 0.05))).toEqual([]);
    expect(dropLinks(blockOf(DEFAULT_MOVE_CONFIG.vaultMaxHeight)).length).toBeGreaterThan(0);
  });

  it('gives the kit gallery\'s large rubble a way down on every side, and every other world none', async () => {
    await initNav();
    const gallery = loadWorldNavMesh('kit-gallery').links();
    const drops = gallery.filter((l) => !l.vault);
    expect(drops).toHaveLength(4);
    for (const l of drops) {
      expect(Math.abs(l.from.x + 18) < 1.2 && Math.abs(l.from.z - 24) < 1).toBe(true);
      expect(l.from.y - l.to.y).toBeCloseTo(1, 1);
    }
    for (const w of ['range', 'greybox-01', 'mission-01']) expect(loadWorldNavMesh(w).links().every((l) => l.vault), w).toBe(true);
  });
});
