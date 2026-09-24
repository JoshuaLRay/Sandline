import { describe, expect, it } from 'vitest';
import { inspectLightmapBake } from './bake-light.ts';

describe('T-4.12 lightmap spike', () => {
  it('records why mission-01 takes the planned per-piece AO fallback', async () => {
    const report = await inspectLightmapBake('mission-01');

    expect(report.placements).toBeGreaterThan(0);
    expect(report.uniqueAssets).toBeGreaterThan(0);
    expect(report.repeatedPlacements).toBeGreaterThan(0);
    expect(report.assetsWithoutUv2.length).toBeGreaterThan(0);
    expect(report.outcome).toBe('fallback-piece-ao');
    expect(report.reasons.join(' ')).toMatch(/TEXCOORD_1/);
    expect(report.reasons.join(' ')).toMatch(/instancing/);
  });
});
