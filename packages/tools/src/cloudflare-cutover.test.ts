import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const file = (path: string): string => readFileSync(path, 'utf8');

describe('Cloudflare Worker cutover contracts', () => {
  const ci = file('.github/workflows/ci.yml');
  const host = file('.github/workflows/host.yml');
  const guide = file('docs/CLOUDFLARE-SETUP.md');

  it('retires GitHub Pages and uses the exact existing public Worker', () => {
    expect(existsSync('.github/workflows/pages.yml')).toBe(false);
    expect(file('README.md')).toContain('https://sandline.joshualray21.workers.dev/');
    expect(guide).toContain('https://sandline.joshualray21.workers.dev');
    expect(ci).toContain('command: deploy --assets ./packages/client/dist --name sandline --compatibility-date 2026-10-12');
    expect(ci).not.toContain('pages deploy packages/client/dist');
  });

  it('does not let pull requests publish or skip any of the four release gates', () => {
    const worker = ci.split(/\n  deploy-worker:/)[1];
    expect(worker).toBeDefined();
    expect(worker).toContain("github.ref == 'refs/heads/main'");
    expect(worker).toContain("github.event_name == 'push'");
    expect(worker).toContain("github.event_name == 'workflow_dispatch'");
    expect(worker).toContain("vars.CLOUDFLARE_WORKER_DEPLOY_ENABLED == 'true'");
    expect(worker).toContain('needs: [verify, streaming, parity-non-v8, mission]');
    expect(worker).toContain('git fetch --depth=1 origin main');
    expect(worker).toContain('git rev-parse FETCH_HEAD');
    expect(worker).toContain('$GITHUB_SHA');
    expect(worker).toContain('pnpm --filter @sandline/client build');
    expect(worker).toContain('CLOUDFLARE_WORKERS_API_TOKEN');
    expect(worker).toContain('CLOUDFLARE_ACCOUNT_ID');
    expect(worker).toContain('SANDLINE_HOST');
  });

  it('preserves Fly deployment and dispatches the gated CI workflow', () => {
    expect(host).toContain('flyctl deploy --remote-only --ha=false');
    expect(host).toContain('VOICE_GITHUB_DISPATCH_TOKEN');
    expect(host).toContain('gh variable set SANDLINE_HOST');
    expect(host).toContain('gh workflow run ci.yml --ref main');
    expect(host).not.toContain('gh workflow run pages.yml');
  });

  it('documents missing secrets and independent Workers Builds as hard release blockers', () => {
    expect(guide).toContain('disable automatic Builds');
    expect(guide).toContain('CLOUDFLARE_WORKER_DEPLOY_ENABLED');
    expect(guide).toContain('Worker Editor');
    expect(guide).toContain('skipped');
    expect(guide).toContain('GitHub App/PAT');
    expect(guide).toContain('Do not delete the Worker');
    expect(file('docs/PRIVATE-REPO-MIGRATION.md')).toContain('owner-controlled');
  });
});
