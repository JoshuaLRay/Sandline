import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('private owner CI authorization boundary', () => {
  it('retains all source gates with the expected App and keeps hosted rollback manual', () => {
    const provider = JSON.parse(readFileSync('.github/ci-provider.json', 'utf8'));
    expect(provider.controller_repository).toBe('JoshuaLRay/Private-CI-Controller');
    expect(provider.github_app_id).toBe(5384278);
    expect(provider.required_checks).toEqual(['verify', 'streaming', 'parity-non-v8', 'mission']);
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(workflow).toContain('  workflow_dispatch:');
    expect(workflow).not.toMatch(/^ {2}(?:pull_request|pull_request_target|push|repository_dispatch|workflow_call):/m);
    expect(workflow).not.toContain('self-hosted');
  });
});
