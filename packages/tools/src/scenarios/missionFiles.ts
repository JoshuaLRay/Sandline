/** T-4.17: discover files rather than relying on the browser's static mission registry. */
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMission } from '@sandline/shared';
import { MISSION_SCENARIO, type MissionConfig, type MissionRun, runMission, stalls } from './mission.ts';

export const MISSION_DIRECTORY = fileURLToPath(new URL('../../../shared/src/data/missions/', import.meta.url));

export async function missionFiles(directory = MISSION_DIRECTORY): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => resolve(directory, e.name)).sort();
}

export interface MissionFileResult {
  file: string;
  mission: string | null;
  runs: MissionRun[];
  failures: string[];
  warnings: string[];
}

/** Report why a mission never completed; malformed files/runner errors fail the job. */
export function judgeMissionFile(file: string, mission: string | null, runs: MissionRun[], errors: string[] = []): MissionFileResult {
  // U-001: a stall is the encounter's defect, not a lost fight: it fails the job.
  const failures = [...errors, ...stalls(runs)];
  const warnings: string[] = [];
  if (!runs.some((r) => r.outcome === 'complete')) {
    warnings.push(`no completed run${runs.length === 0 ? ' (no runs finished)' : ': ' + runs.map((r) => `${r.humans}h seed ${r.seed}: ${r.outcome}; ${r.detail}`).join(' | ')}`);
  }
  return { file, mission, runs, failures, warnings };
}

/** Load/validate/run each file independently so a broken one cannot hide later missions. */
export async function runMissionFiles(files: readonly string[], seeds = MISSION_SCENARIO.ciSeeds, config: MissionConfig = MISSION_SCENARIO): Promise<MissionFileResult[]> {
  if (!Number.isSafeInteger(seeds) || seeds < 1) throw new Error('--seeds must be a positive integer');
  if (files.length === 0) throw new Error('no mission files found');
  const results: MissionFileResult[] = [];
  for (const file of files) {
    const runs: MissionRun[] = [];
    const errors: string[] = [];
    let mission: string | null = null;
    try {
      const def = parseMission(JSON.parse(await readFile(file, 'utf8')));
      mission = def.id;
      for (const humans of config.budgets) for (let seed = 1; seed <= seeds; seed++) {
        try {
          runs.push(await runMission(seed, humans, config, def));
        } catch (error) {
          errors.push(`${humans}h seed ${seed}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
    results.push(judgeMissionFile(file, mission, runs, errors));
  }
  return results;
}

export function reportMissionFiles(results: readonly MissionFileResult[]): string {
  return results.map((r) => [
    `mission=${r.mission ?? '(invalid)'} file=${r.file}`,
    ...r.runs.map((run) => `  ${run.humans}h seed ${run.seed}: ${run.outcome} at ${run.seconds.toFixed(1)}s; ${run.detail}`),
    ...r.failures.map((e) => `  FAIL: ${e}`),
    ...r.warnings.map((w) => `  WARNING: ${w}`),
    `${r.failures.length > 0 ? 'ERROR' : r.warnings.length > 0 ? 'INCOMPLETE' : 'OK'}: completed ${r.runs.filter((run) => run.outcome === 'complete').length}/${r.runs.length} runs`,
  ].join('\n')).join('\n\n');
}
