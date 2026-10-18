import { execFileSync } from 'node:child_process';
import { projects, labels, readyRunners } from './runner-policy.mjs';

const [project, action, ...extra] = process.argv.slice(2);
if (!projects.includes(project) || (action && action !== '--apply') || extra.length)
  throw Error('Usage: node scripts/ci/activate.mjs PROJECT [--apply]');
const repo = `JoshuaLRay/${project}`;
const read = args => JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));
const metadata = read(['api', `repos/${repo}`]);
const pages = read(['api', '--paginate', '--slurp', `repos/${repo}/actions/runners?per_page=100`]);
const online = readyRunners(project, metadata, pages);
console.log(`Ready: ${online.length} matching online runner(s) for ${repo}`);
if (action === '--apply') {
  execFileSync('gh', ['variable', 'set', 'CI_RUNNER_LABELS', '--repo', repo,
    '--body', JSON.stringify(labels)], { stdio: 'inherit' });
  console.log('Routing activated. Rerun the latest PR checks and verify the runner name in each job.');
} else console.log('No change made. Add --apply to activate after reviewing the inventory.');
