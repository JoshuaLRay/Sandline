import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { failureExcerpt, runLogged, runSummary, successCounters } from './agent-output.js';

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('bounded agent command output', () => {
  it('retains early errors as well as the tail, with a firm output cap', () => {
    const log = [
      'setup', 'AssertionError: the exact failing assertion', 'trace at test.ts',
      ...Array.from({ length: 800 }, (_, n) => 'routine success output ' + n),
      'final diagnosis',
    ].join('\n');
    const excerpt = failureExcerpt(log, 2500, 12);
    expect(excerpt).toContain('AssertionError: the exact failing assertion');
    expect(excerpt).toContain('final diagnosis');
    expect(excerpt.length).toBeLessThanOrEqual(2500);
    expect(excerpt).toContain('full local log retained');
  });

  it('reports missing output and bounded success counters', () => {
    expect(failureExcerpt('')).toContain('no output');
    const counters = successCounters('noise\n Test Files 23 passed\n Tests 144 passed\n');
    expect(counters).toEqual(['Test Files 23 passed', 'Tests 144 passed']);
    expect(runSummary('pnpm verify', 0, 2315, '.agent-logs/abc.log', counters))
      .toContain('[PASS] pnpm verify | exit=0 | 2.3s | full log: ');
    expect(runSummary('pnpm verify', 1, 100, '.agent-logs/abc.log', counters))
      .not.toContain('Tests 144 passed');
  });

  it('preserves complete logs and exit codes for successful and failed commands', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sandline-agent-log-'));
    temporary.push(dir);
    const ok = await runLogged([process.execPath, '-e',
      'process.stdout.write("success-output-xyz\\n")'], dir);
    const failed = await runLogged([process.execPath, '-e',
      'process.stderr.write("AssertionError: deliberate failure\\n");process.exit(7)'], dir);
    const logs = readdirSync(join(dir, '.agent-logs'));
    const contents = logs.map((name) => readFileSync(join(dir, '.agent-logs', name), 'utf8')).join('\n');
    expect(ok).toBe(0);
    expect(failed).toBe(7);
    expect(logs).toHaveLength(2);
    expect(contents).toContain('success-output-xyz');
    expect(contents).toContain('AssertionError: deliberate failure');
  });

  it('does not turn an unlaunchable command into success', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sandline-agent-log-'));
    temporary.push(dir);
    expect(await runLogged(['__sandline_missing_command__'], dir)).not.toBe(0);
    expect(readFileSync(join(dir, '.agent-logs',
      readdirSync(join(dir, '.agent-logs'))[0]!), 'utf8')).toContain('Spawn error:');
  });
});
