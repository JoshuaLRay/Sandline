import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = dirname(fileURLToPath(import.meta.url));

test('registration plan is inspectable without downloading, registering or needing root', () => {
  const r = spawnSync('bash', [join(root, 'install-runner.sh'), 'Gunball', '2.999.0',
    'a'.repeat(64), 'test-ci', '--plan'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /JoshuaLRay\/Gunball/);
  assert.match(r.stdout, /https:\/\/github.com\/actions\/runner\/releases\/download\/v2.999.0/);
});
test('registration rejects another repository, checksum errors and shell-shaped versions', () => {
  for (const args of [[], ['other', '2.999.0', 'a'.repeat(64)],
    ['Gunball', '2.999.0', 'bad'], ['Gunball', '2.999.0;exit', 'a'.repeat(64)]]) {
    const r = spawnSync('bash', [join(root, 'install-runner.sh'), ...args], { encoding: 'utf8' });
    assert.equal(r.status, 2, r.stderr);
  }
});
test('activation dry-run and failing inventories never modify repository variables', () => {
  const directory = mkdtempSync(join(tmpdir(), 'runner-gh-test-'));
  try {
    const mock = join(directory, 'gh'), writes = join(directory, 'writes');
    writeFileSync(mock, `#!/usr/bin/env node
import fs from 'node:fs';
const args=process.argv.slice(2);
if(args[0]==='variable')fs.appendFileSync(process.env.TEST_WRITES,JSON.stringify(args)+'\\n');
else console.log(args.includes('--slurp')?process.env.TEST_RUNNERS:process.env.TEST_METADATA);
`);
    // Extension-less executables use CommonJS regardless of the tested repository.
    writeFileSync(mock, readFileSync(mock, 'utf8').replace("import fs from 'node:fs';", "const fs=require('node:fs');"));
    chmodSync(mock, 0o755);
    const online = [{ runners: [{ status: 'online', labels: ['self-hosted', 'linux', 'x64', 'project-ci'].map(name => ({ name })) }] }];
    const run = (apply, runners = online, privateRepo = true) => spawnSync(process.execPath,
      [join(root, 'activate.mjs'), 'Gunball', ...(apply ? ['--apply'] : [])],
      { encoding: 'utf8', env: { ...process.env, PATH: directory + ':' + process.env.PATH,
        TEST_WRITES: writes, TEST_RUNNERS: JSON.stringify(runners),
        TEST_METADATA: JSON.stringify({ full_name: 'JoshuaLRay/Gunball', private: privateRepo }) } });
    assert.equal(run(false).status, 0);
    assert.equal(existsSync(writes), false);
    for (const [runners, privateRepo] of [[[{ runners: [] }], true], [online, false], [[{}], true]]) {
      assert.notEqual(run(true, runners, privateRepo).status, 0);
      assert.equal(existsSync(writes), false);
    }
    assert.equal(run(true).status, 0);
    const args = JSON.parse(readFileSync(writes, 'utf8').trim());
    assert.deepEqual(args, ['variable', 'set', 'CI_RUNNER_LABELS', '--repo', 'JoshuaLRay/Gunball',
      '--body', '["self-hosted","linux","x64","project-ci"]']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
