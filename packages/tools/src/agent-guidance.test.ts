import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(path, 'utf8');

describe('agent documentation contracts', () => {
  const agents = read('AGENTS.md');
  const handoff = read('.agents/skills/next-task-context-transfer-text-box/SKILL.md');
  const next = read('.agents/skills/next-task/SKILL.md');

  it('keeps a single, compact entry point for Claude and Codex', () => {
    expect(agents.length).toBeLessThan(7800);
    expect(read('CLAUDE.md')).toContain('@AGENTS.md');
    expect(read('packages/shared/CLAUDE.md')).toContain('@AGENTS.md');
    expect(read('.claude/commands/next-task-context-transfer-text-box.md'))
      .toContain('.agents/skills/next-task-context-transfer-text-box/SKILL.md');
  });

  it('retains mandatory safety, ownership, and latest-head gates', () => {
    for (const job of ['verify', 'streaming', 'parity-non-v8', 'mission']) {
      expect(agents).toContain('`' + job + '`');
    }
    for (const rule of [
      'latest head SHA', 'If main advances', 'REVIEW', 'CANCELLED',
      'pnpm verify', 'PROTOCOL_VERSION', 'recommended default',
      'human', 'packages/shared/AGENTS.md',
    ]) expect(agents.toLowerCase()).toContain(rule.toLowerCase());
  });

  it('uses progressive disclosure and references that exist', () => {
    for (const path of [
      '.agents/skills/next-task/SKILL.md',
      '.agents/skills/report-feedback/SKILL.md',
      '.agents/skills/next-task-context-transfer-text-box/SKILL.md',
      'docs/AGENT-REFERENCE.md', 'docs/CODEMAP.md', 'docs/COMMANDS.md',
      'docs/VISION.md', 'packages/shared/AGENTS.md',
    ]) {
      expect(agents).toContain(path);
      expect(existsSync(path), path).toBe(true);
    }
    expect(agents).toContain('Never');
    expect(agents).toContain('preload');
    expect(next).toContain('pnpm task:next');
    expect(next).toContain('UNKNOWN');
  });

  it('avoids stale next-task reads for a completed merge', () => {
    expect(handoff).toContain('30–60-word');
    expect(handoff).toContain('Do not preselect the next task');
    expect(handoff).toContain('current main');
    expect(handoff).toContain('If the previous outcome is unverified');
  });

  it('specifies a resumable interrupted handoff with explicit checks', () => {
    expect(handoff).toContain('at most 15 lines');
    for (const field of [
      'Task:', 'Branch:', 'PR:', 'head:', 'Files changed:',
      'Completed:', 'Tests:', 'CI:', 'Blockers:', 'Next action:',
      'verify=', 'streaming=', 'parity-non-v8=', 'mission=',
    ]) expect(handoff).toContain(field);
    expect(handoff).toContain('unrun');
    expect(handoff).toContain('push');
  });
});
