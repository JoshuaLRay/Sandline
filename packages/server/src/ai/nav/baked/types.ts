/**
 * A place to take cover (T-3.18): where a soldier stands against a box face,
 * the face's outward normal — the side the soldier is on, so the box shelters
 * them from fire coming from the other side, travelling along +normal — and
 * how tall the box is against a soldier's eyes.
 */
export interface CoverPoint {
  /** The box it is against, by id. */
  box: string;
  /** Feet position, on the mesh. */
  x: number;
  y: number;
  z: number;
  /** Outward normal of the face, one of the four axis directions. */
  nx: number;
  nz: number;
  /** `low`: crouching conceals, standing fires over. `high`: standing conceals, fire by stepping out. */
  height: 'low' | 'high';
}

/** One committed navmesh bake (T-3.03), as `pnpm gen:nav` writes it. */
export interface BakedNav {
  /** The named world it was baked from. */
  world: string;
  /**
   * sha256 of every input that decided the bake: the world's boxes and floor,
   * the agent and the voxel grid. `nav.test.ts` recomputes it; a mismatch
   * means the world or the agent changed without a re-bake.
   */
  hash: string;
  /** The agent it was baked for, derived from MoveConfig and the hitbox, vault rule included (T-3.04). */
  agent: {
    radius: number;
    height: number;
    climb: number;
    groundY: number;
    vaultMaxHeight: number;
    vaultDistance: number;
    vaultProbe: number;
  };
  /** Detour's export, base64 so the same module loads in Node and in the page. */
  base64: string;
  /** Every cover point of the world (T-3.18), baked from the same inputs and covered by `hash`. */
  cover: readonly CoverPoint[];
}

/** The bake's bytes, for `NavMesh.load`. */
export function bakedBytes(baked: BakedNav): Uint8Array {
  const bin = atob(baked.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
