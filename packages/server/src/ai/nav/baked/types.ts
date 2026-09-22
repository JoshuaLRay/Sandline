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
  /** The agent it was baked for, derived from MoveConfig and the hitbox. */
  agent: { radius: number; height: number; climb: number; groundY: number };
  /** Detour's export, base64 so the same module loads in Node and in the page. */
  base64: string;
}

/** The bake's bytes, for `NavMesh.load`. */
export function bakedBytes(baked: BakedNav): Uint8Array {
  const bin = atob(baked.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
