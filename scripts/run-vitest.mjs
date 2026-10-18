/**
 * Preserve the complete local Vitest suite; only CI's explicitly enumerated
 * four shards add the official Vitest --shard flag. Never filter test cases,
 * suites, assertions or seed budgets by changed files.
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';

const shard = process.env.SANDLINE_CI_TEST_SHARD;
if (shard !== undefined && !/^[1-4]\/4$/.test(shard)) {
  console.error('Invalid SANDLINE_CI_TEST_SHARD: expected 1/4, 2/4, 3/4 or 4/4');
  process.exit(1);
}
const args = ['node_modules/vitest/vitest.mjs', 'run', ...(shard ? [`--shard=${shard}`] : []), ...process.argv.slice(2)];
const outcome = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
if (outcome.error) console.error(outcome.error);
process.exit(outcome.status ?? 1);
