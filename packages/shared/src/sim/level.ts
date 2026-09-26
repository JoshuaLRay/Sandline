/**
 * Level format v1 (T-4.09): a world file grown up.
 *
 * A level holds what a world file holds (an id, the floor, free boxes, the
 * mission block of T-3.31) and adds two things:
 *   - **kit piece instances**: an asset id from the manifest, where it
 *     stands, and a turn of 0, 90, 180 or 270 degrees;
 *   - **an encounter reference**: the encounter file its mission plays.
 *
 * `expandLevel` turns a level into the world file it stands for. Each
 * piece's collision boxes (the manifest's, T-4.02, from the same numbers as
 * its mesh, T-4.04) are turned and placed with it and become cover boxes,
 * each tagged with the instance it belongs to. `loadLevel` (`world.ts`)
 * then builds the `World` every consumer already reads: the controller,
 * shots, the camera, the navmesh and cover bakes and the AI change nothing.
 * A world file with no pieces still loads through `loadWorld` as before.
 *
 * ONLY QUARTER TURNS (§7.11 rule 1). Collision is axis-aligned boxes,
 * bit-exact on every engine (ADR-014). A quarter turn keeps a box
 * axis-aligned and is exact arithmetic: coordinates swap and change sign,
 * nothing is multiplied by a sine. Any other angle is refused.
 *
 * The turn follows the wire's yaw convention: 90° turns the piece's +Z
 * (its front) to face +X. That is the same as three's `rotation.y` in
 * radians, so a renderer places the mesh with `rotation.y = rot · π / 180`.
 */
import { ASSET_MANIFEST, type AssetManifest } from './assets.ts';
import type { BoxSpec } from './world.ts';

export type QuarterTurn = 0 | 90 | 180 | 270;

/** A kit piece standing in a level. */
export interface PlacedPiece {
  /** Unique within the level; its boxes are `<id>/<n>`. */
  id: string;
  /** The asset id in the manifest. */
  piece: string;
  /** The piece's origin (its base centre) in world metres. */
  x: number;
  y: number;
  z: number;
  rot: QuarterTurn;
}

export class LevelDataError extends Error {}

/** A cover box spec that remembers which piece it came from. */
export type LevelBoxSpec = BoxSpec & { piece?: string };

/** The world file a level stands for: what `loadWorld` reads, plus its pieces and encounter. */
export interface ExpandedLevel {
  id: string;
  $comment?: string;
  floor?: unknown;
  generate?: unknown;
  cover: LevelBoxSpec[];
  mission?: unknown;
  pieces: PlacedPiece[];
  encounter: string | null;
  /** T-4.29: the level's emplacements, as written; `loadWorld` validates them. */
  emplacements?: unknown;
}

const LEVEL_KEYS = ['id', 'format', 'floor', 'generate', 'boxes', 'pieces', 'mission', 'encounter', 'emplacements'] as const;
const PIECE_KEYS = ['id', 'piece', 'x', 'y', 'z', 'rot'] as const;
const TURNS: readonly number[] = [0, 90, 180, 270];
const INSTANCE_ID = /^[a-z0-9][a-z0-9-]*$/;

/** (x, z) turned by a quarter turn, +Z toward +X. Exact: swaps and signs only. */
export function turn(x: number, z: number, rot: QuarterTurn): [number, number] {
  switch (rot) {
    case 0:
      return [x, z];
    case 90:
      return [z, -x];
    case 180:
      return [-x, -z];
    case 270:
      return [-z, x];
  }
}

function finite(where: string, v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new LevelDataError(`${where}: expected a finite number`);
  return v;
}

function parsePiece(levelId: string, raw: unknown, i: number, manifest: AssetManifest): PlacedPiece {
  const where = `level '${levelId}' pieces[${i}]`;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new LevelDataError(`${where}: expected an object`);
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(PIECE_KEYS as readonly string[]).includes(k)) throw new LevelDataError(`${where}: unknown key '${k}'`);
  if (typeof o['id'] !== 'string' || !INSTANCE_ID.test(o['id'])) throw new LevelDataError(`${where}: id must match ${INSTANCE_ID}`);
  if (typeof o['piece'] !== 'string') throw new LevelDataError(`${where} '${o['id']}': piece must be an asset id`);
  const asset = manifest.assets.find((a) => a.id === o['piece']);
  if (!asset) throw new LevelDataError(`${where} '${o['id']}': no asset '${o['piece']}' in the manifest`);
  if (asset.class !== 'kit' && asset.class !== 'prop') {
    throw new LevelDataError(`${where} '${o['id']}': '${asset.id}' is a ${asset.class}, and a level places kit pieces and props`);
  }
  const rot = o['rot'] ?? 0;
  if (typeof rot !== 'number' || !TURNS.includes(rot)) {
    throw new LevelDataError(`${where} '${o['id']}': rot ${JSON.stringify(rot)} is not a quarter turn (0, 90, 180 or 270); collision stays axis-aligned`);
  }
  return {
    id: o['id'],
    piece: asset.id,
    x: finite(`${where}.x`, o['x']),
    y: finite(`${where}.y`, o['y'] ?? 0),
    z: finite(`${where}.z`, o['z']),
    rot: rot as QuarterTurn,
  };
}

/** A placed piece's collision boxes, turned and moved into the world, as cover specs. */
export function pieceBoxes(placed: PlacedPiece, manifest: AssetManifest = ASSET_MANIFEST): LevelBoxSpec[] {
  const asset = manifest.assets.find((a) => a.id === placed.piece);
  if (!asset) throw new LevelDataError(`piece '${placed.id}': no asset '${placed.piece}' in the manifest`);
  return asset.collision.map((c, n) => {
    const [ax, az] = turn(c.min[0], c.min[2], placed.rot);
    const [bx, bz] = turn(c.max[0], c.max[2], placed.rot);
    const minX = Math.min(ax, bx) + placed.x;
    const maxX = Math.max(ax, bx) + placed.x;
    const minZ = Math.min(az, bz) + placed.z;
    const maxZ = Math.max(az, bz) + placed.z;
    return {
      id: `${placed.id}/${n}`,
      piece: placed.id,
      x: (minX + maxX) / 2,
      y: c.min[1] + placed.y,
      z: (minZ + maxZ) / 2,
      w: maxX - minX,
      h: c.max[1] - c.min[1],
      d: maxZ - minZ,
    };
  });
}

/**
 * A level file to the world file it stands for. Validates the level's own
 * parts (format, pieces, encounter); the rest (id, floor, boxes, mission) is
 * validated by `loadWorld` as for any world.
 */
export function expandLevel(raw: unknown, manifest: AssetManifest = ASSET_MANIFEST): ExpandedLevel {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new LevelDataError('level file: expected an object');
  const o = raw as Record<string, unknown>;
  const id = typeof o['id'] === 'string' ? o['id'] : '?';
  for (const k of Object.keys(o)) {
    if (!(LEVEL_KEYS as readonly string[]).includes(k) && k !== '$comment') throw new LevelDataError(`level '${id}': unknown key '${k}'`);
  }
  if (o['format'] !== 1) throw new LevelDataError(`level '${id}': format ${JSON.stringify(o['format'])} is not 1`);
  const boxes = o['boxes'] ?? [];
  if (!Array.isArray(boxes)) throw new LevelDataError(`level '${id}': boxes must be a list`);
  const rawPieces = o['pieces'] ?? [];
  if (!Array.isArray(rawPieces)) throw new LevelDataError(`level '${id}': pieces must be a list`);
  const pieces = rawPieces.map((p, i) => parsePiece(id, p, i, manifest));
  const seen = new Set<string>();
  for (const p of pieces) {
    if (seen.has(p.id)) throw new LevelDataError(`level '${id}': piece id '${p.id}' is used twice`);
    seen.add(p.id);
  }
  const encounter = o['encounter'] ?? null;
  if (encounter !== null && (typeof encounter !== 'string' || encounter.length === 0)) {
    throw new LevelDataError(`level '${id}': encounter must name an encounter file`);
  }
  const out: ExpandedLevel = {
    id,
    cover: [...(boxes as LevelBoxSpec[]), ...pieces.flatMap((p) => pieceBoxes(p, manifest))],
    pieces,
    encounter,
  };
  if (o['floor'] !== undefined) out.floor = o['floor'];
  if (o['generate'] !== undefined) out.generate = o['generate'];
  if (o['mission'] !== undefined) out.mission = o['mission'];
  // T-4.29: the emplacements a level places; `loadWorld` validates them as for any world.
  if (o['emplacements'] !== undefined) out.emplacements = o['emplacements'];
  return out;
}
