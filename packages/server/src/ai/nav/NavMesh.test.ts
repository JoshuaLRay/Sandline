/**
 * The T-3.01 spike, as a test that runs in every runtime a session runs in.
 *
 * The same file runs under the default Node config and under
 * `vitest.browser.config.ts`'s `nav-browsers` project in Chromium, Firefox and
 * WebKit. Each loads the SAME committed bytes (baked once in Node by
 * `pnpm gen:nav-spike`), asks for the same path, and compares its length with
 * the Node length committed beside the bytes.
 *
 * AI is not parity-critical (§2.3), so the bound is a sanity bound — "the mesh
 * is the same mesh and Detour did the same thing with it" — not a netcode
 * gate. The measured divergence is logged per runtime.
 */
import { describe, expect, it } from 'vitest';
import { NavMesh, initNav, isNavReady, pathLength } from './NavMesh.ts';
import { SPIKE_FROM, SPIKE_MESH_BASE64, SPIKE_NODE_PATH_LENGTH, SPIKE_TO } from './spikeMesh.ts';

/** A centimetre. Detour is float32 throughout; this is far above its noise. */
const PATH_LENGTH_BOUND_M = 0.01;
const QUERY_REPS = 500;

function runtime(): string {
  const ua = globalThis.navigator?.userAgent ?? '';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\//.test(ua) && !/Node/.test(ua)) return 'chromium';
  if (/AppleWebKit\//.test(ua) && !/Chrome\//.test(ua)) return 'webkit';
  return 'node';
}

function spikeBytes(): Uint8Array {
  const bin = atob(SPIKE_MESH_BASE64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

describe(`NavMesh (${runtime()})`, () => {
  it('initialises, loads the committed bytes, and paths round the wall', async () => {
    const t0 = performance.now();
    await initNav();
    const initMs = performance.now() - t0;
    expect(isNavReady()).toBe(true);

    const t1 = performance.now();
    const mesh = NavMesh.load(spikeBytes());
    const loadMs = performance.now() - t1;

    const path = mesh.path(SPIKE_FROM, SPIKE_TO);
    expect(path).not.toBeNull();
    const length = pathLength(path!.points);
    const divergence = Math.abs(length - SPIKE_NODE_PATH_LENGTH);

    // Round a 2.4 m wall, not through it: longer than the straight 20 m, and
    // every corner is past the wall's far end (z = 10).
    expect(length).toBeGreaterThan(40);
    expect(path!.points.some((p) => p.z > 10)).toBe(true);
    expect(path!.corridor.length).toBeGreaterThan(1);
    expect(divergence).toBeLessThan(PATH_LENGTH_BOUND_M);

    const t2 = performance.now();
    for (let i = 0; i < QUERY_REPS; i++) mesh.path(SPIKE_FROM, SPIKE_TO);
    const usPerPath = ((performance.now() - t2) * 1000) / QUERY_REPS;

    console.log(
      `[nav ${runtime()}] init ${initMs.toFixed(1)} ms, load ${loadMs.toFixed(2)} ms, ` +
        `path ${length.toFixed(4)} m (node ${SPIKE_NODE_PATH_LENGTH.toFixed(4)}, divergence ${divergence.toExponential(2)} m), ` +
        `${usPerPath.toFixed(1)} µs/path`,
    );
    mesh.destroy();
  });

  it('snaps an off-mesh point to the mesh, and refuses one far from it', async () => {
    await initNav();
    const mesh = NavMesh.load(spikeBytes());
    // Half a metre above the floor: found, and put on the floor.
    const near = mesh.nearestPoint({ x: -10, y: 0.5, z: -10 });
    expect(near).not.toBeNull();
    expect(Math.abs(near!.point.y)).toBeLessThan(0.2);
    // Touching the wall's face, inside the agent-radius margin Recast erodes
    // round it: pushed back out to about a radius clear (x ≈ −1.35).
    const atWall = mesh.nearestPoint({ x: -1.1, y: 0, z: -10 });
    expect(atWall).not.toBeNull();
    expect(atWall!.point.x).toBeLessThan(-1.25);
    expect(atWall!.point.x).toBeGreaterThan(-1.5);
    // Far outside the floor: nothing.
    expect(mesh.nearestPoint({ x: 100, y: 0, z: 100 })).toBeNull();
    mesh.destroy();
  });

  it('raycasts: clear along open floor, stopped by the wall', async () => {
    await initNav();
    const mesh = NavMesh.load(spikeBytes());
    const clear = mesh.raycast({ x: -10, y: 0, z: -10 }, { x: -10, y: 0, z: -2 });
    expect(clear).not.toBeNull();
    expect(clear!.hit).toBe(false);
    expect(clear!.t).toBe(1);

    const blocked = mesh.raycast({ x: -10, y: 0, z: -10 }, { x: 10, y: 0, z: -10 });
    expect(blocked).not.toBeNull();
    expect(blocked!.hit).toBe(true);
    // Stops at the wall's near face less the agent radius: x ≈ −1.35.
    expect(blocked!.point.x).toBeLessThan(-1.2);
    expect(blocked!.point.x).toBeGreaterThan(-1.6);
    mesh.destroy();
  });

  it('returns no path to a point with no mesh under it', async () => {
    await initNav();
    const mesh = NavMesh.load(spikeBytes());
    expect(mesh.path(SPIKE_FROM, { x: 100, y: 0, z: 100 })).toBeNull();
    mesh.destroy();
  });
});
