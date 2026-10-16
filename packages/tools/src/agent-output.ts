/**
 * Opt-in bounded agent command output; never suppresses commands, changes their
 * exit code or discards diagnostics. Full stdout/stderr lives in .agent-logs/.
 * Usage: pnpm agent:run -- pnpm verify
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function failureExcerpt(log: string, maxChars = 6000, tailLines = 36): string {
  if (!log.trim()) return '(no output; inspect command and exit status)';
  const lines = log.replace(/\r\n/g, '\n').trimEnd().split('\n');
  const start = Math.max(0, lines.length - tailLines);
  const tail = lines.slice(start).join('\n');
  const failureIndex = lines.findIndex((line) =>
    /\b(?:AssertionError|Error:|FAIL\b|failed\b|TypeError:|ReferenceError:)\b/i.test(line) ||
    /(?:AssertionError|TypeError|ReferenceError):|\bFAIL\s/i.test(line));
  const prefix = failureIndex >= 0 && failureIndex < start
    ? lines.slice(Math.max(0, failureIndex - 2), Math.min(start, failureIndex + 6)).join('\n')
    : '';
  const separator = start > 0 ? '\n… omitted earlier output (full local log retained) …\n' : '';
  // Preserve a likely early error AND the final lines, even when either is huge.
  const prefixBudget = Math.min(1700, Math.floor(maxChars / 3));
  const heading = prefix ? prefix.slice(0, prefixBudget) + separator : start > 0 ? separator : '';
  const remaining = Math.max(0, maxChars - heading.length);
  const bottom = tail.length > remaining ? '… last output truncated; see full log …\n' + tail.slice(-Math.max(0, remaining - 42)) : tail;
  return (heading + bottom).slice(0, maxChars);
}

export function successCounters(log: string): string[] {
  const matches = log.split(/\r?\n/).filter((line) =>
    /^\s*(?:Test Files|Tests|Suites|Snapshots)\s+/i.test(line));
  return matches.slice(-3).map((line) => line.trim().slice(0, 160));
}

export function runSummary(command: string, code: number | null, durationMs: number, logPath: string, counters: string[]): string {
  const outcome = code === 0 ? 'PASS' : 'FAIL';
  const suffix = code === null ? 'signal/error' : 'exit=' + code;
  const counterText = code === 0 && counters.length ? ' | ' + counters.join('; ') : '';
  return '[' + outcome + '] ' + command + ' | ' + suffix + ' | ' +
    (durationMs / 1000).toFixed(1) + 's | full log: ' + logPath + counterText;
}

export async function runLogged(argv: string[], cwd = process.cwd()): Promise<number> {
  const parts = argv[0] === '--' ? argv.slice(1) : argv;
  if (!parts.length) {
    process.stderr.write('Usage: pnpm agent:run -- <program> [arguments...]\n');
    return 2;
  }
  const [command = '', ...args] = parts;
  const dir = resolve(cwd, '.agent-logs');
  mkdirSync(dir, { recursive: true });
  const logFile = resolve(dir, Date.now() + '-' + randomUUID() + '.log');
  const relativeLog = relative(cwd, logFile);
  const log = createWriteStream(logFile, { flags: 'wx' });
  const started = process.hrtime.bigint();
  let spawnError: Error | null = null;
  const child = spawn(command, args, { cwd, shell: false, stdio: ['inherit', 'pipe', 'pipe'] });
  child.stdout?.on('data', (chunk: Buffer) => { log.write(chunk); });
  child.stderr?.on('data', (chunk: Buffer) => { log.write(chunk); });
  child.on('error', (error: Error) => { spawnError = error; log.write('Spawn error: ' + error.message + '\n'); });
  const code: number | null = await new Promise((done) => {
    child.on('close', (exitCode: number | null) => done(exitCode));
  });
  await new Promise<void>((done) => log.end(done));
  const duration = Number(process.hrtime.bigint() - started) / 1e6;
  const output = readFileSync(logFile, 'utf8');
  const label = [command, ...args].map((part) => /\s/.test(part) ? JSON.stringify(part) : part).join(' ');
  process.stdout.write(runSummary(label, spawnError ? null : code, duration, relativeLog, successCounters(output)) + '\n');
  if (spawnError || code !== 0) {
    process.stderr.write('Diagnostic excerpt (full output is retained locally):\n' + failureExcerpt(output) + '\n');
  }
  return spawnError ? 1 : (code ?? 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLogged(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error: Error) => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; },
  );
}
