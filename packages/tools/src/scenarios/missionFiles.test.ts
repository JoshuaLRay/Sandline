import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { missionFor, missions } from '@sandline/shared';
import { MISSION_SCENARIO, runMission } from './mission.ts';
import { judgeMissionFile, missionFiles, reportMissionFiles, runMissionFiles } from './missionFiles.ts';

describe('every mission file (T-4.17)', () => {
  it('discovers every committed file, including files outside the static registry', async () => {
    const committed = await missionFiles();
    expect(committed.length).toBeGreaterThanOrEqual(missions().length);
    const dir = await mkdtemp(join(tmpdir(), 'sandline-missions-'));
    try {
      const good = join(dir, 'z-new-mission.json');
      const bad = join(dir, 'a-invalid.json');
      await writeFile(bad, '{');
      await writeFile(join(dir, 'notes.txt'), 'ignored');
      await writeFile(good, JSON.stringify({ ...missionFor('greybox-01'), id: 'new-mission', objectives: [{ type: 'survive', label: 'wait', seconds: 0.1 }] }));
      const files = await missionFiles(dir);
      expect(files).toEqual([bad, good]);
      const results = await runMissionFiles(files, 3, { ...MISSION_SCENARIO, runSeconds: 1 });
      expect(results[0]!.failures.length).toBeGreaterThan(0);
      expect(results[1]!.failures).toEqual([]);
      expect(results[1]!.runs).toHaveLength(6);
      expect(results[1]!.runs.map((r) => [r.humans, r.seed])).toEqual([[1, 1], [1, 2], [1, 3], [6, 1], [6, 2], [6, 3]]);
      const report = reportMissionFiles(results);
      expect(report).toContain(bad);
      expect(report).toContain('mission=new-mission');
      expect(report).toContain('OK: completed 6/6');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports zero completions even below the old rate minimum without failing on gameplay losses', async () => {
    const def = { ...missionFor('greybox-01')!, id: 'too-long', objectives: [{ type: 'survive' as const, label: 'wait', seconds: 20 }] };
    const run = await runMission(1, 1, { ...MISSION_SCENARIO, runSeconds: 1 }, def);
    expect(run.outcome).toBe('timeout');
    expect(run.detail).toContain('simulation time limit');
    expect(run.objective).toMatchObject({ objective: 0, type: 'survive', progress: 30, goal: 600 });
    const failed = judgeMissionFile('long.json', def.id, [run]);
    expect(failed.failures).toEqual([]);
    expect(failed.warnings.join(' ')).toMatch(/1h seed 1: timeout.*objective 1\/1 survive/);
    expect(reportMissionFiles([failed])).toContain('INCOMPLETE: completed 0/1 runs');
    expect(judgeMissionFile('long.json', def.id, [run, { ...run, outcome: 'complete' }]).warnings).toEqual([]);
    expect(judgeMissionFile('bad.json', def.id, [{ ...run, outcome: 'complete' }], ['seed 2 could not run']).failures).toEqual(['seed 2 could not run']);
  });

  it('rejects empty discovery and invalid seed counts instead of silently passing', async () => {
    await expect(runMissionFiles([])).rejects.toThrow('no mission files');
    for (const seeds of [0, -1, NaN, 1.5]) await expect(runMissionFiles(['unused'], seeds)).rejects.toThrow('positive integer');
  });
});
