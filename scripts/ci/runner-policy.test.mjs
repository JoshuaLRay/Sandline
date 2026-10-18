import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labels, projects, readyRunners } from './runner-policy.mjs';
const runner = { name: 'pc-ci', status: 'online', labels: labels.map(name => ({ name })) };
const metadata = project => ({ full_name: `JoshuaLRay/${project}`, private: true });
test('activation accepts each private owner project and paginated online capacity', () => {
  for (const project of projects) assert.equal(readyRunners(project, metadata(project),
    [{ runners: [] }, { runners: [runner] }]).length, 1);
});
test('offline or incomplete capacity never activates routing', () => {
  for (const candidate of [{ ...runner, status: 'offline' }, { ...runner, labels: [] }])
    assert.throws(() => readyRunners('Gunball', metadata('Gunball'), [{ runners: [candidate] }]));
  assert.throws(() => readyRunners('Gunball', metadata('Gunball'), []));
});
test('unknown projects, public/fork repositories and malformed inventory fail closed', () => {
  assert.throws(() => readyRunners('other', metadata('other'), [{ runners: [runner] }]));
  for (const meta of [{ ...metadata('Gunball'), private: false }, metadata('Sandline')])
    assert.throws(() => readyRunners('Gunball', meta, [{ runners: [runner] }]));
  assert.throws(() => readyRunners('Gunball', metadata('Gunball'), [{}]));
});
test('busy online runners remain eligible for queued work', () => {
  assert.equal(readyRunners('Gunball', metadata('Gunball'),
    [{ runners: [{ ...runner, busy: true }] }]).length, 1);
});
