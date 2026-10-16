import { describe, expect, it, vi } from 'vitest';
import { claimsFromRemote, dependencyIds, parseRows, selectTask, type Claim } from './task-next.js';

const row = (
  id: string, status = 'READY', blocker = '—', work = '—',
  outcome = 'Make the mission playable',
) => '| [' + id + '](docs/backlog/' + id + '.md) | ' + outcome +
  ' | Mission | P1 | ' + status + ' | ' + blocker + ' | ' + work + ' |';
const archiveRow = (id: string, status = 'DONE') =>
  '| [' + id + '](../' + id + '.md) | Archived | Mission | P1 | ' + status + ' | — | — |';
const table = (...rows: string[]) =>
  ['| Task | Outcome | Epic | Priority | Status | Depends / blocker | Work |',
    '|---|---|---|---|---|---|---|', ...rows].join('\n');
const choices = (
  rows: string[], opts: {
    archives?: string[]; claims?: Claim[]; lookupMerged?: (n: number) => boolean | null;
    id?: string; readCard?: (path: string) => string; explain?: boolean;
  } = {},
) => selectTask({
  backlog: table(...rows),
  archives: opts.archives ?? [], claims: opts.claims ?? [],
  lookupMerged: opts.lookupMerged ?? (() => null),
  readCard: opts.readCard ?? (() => '# Candidate task\n'),
  id: opts.id, explain: opts.explain,
});

describe('backlog parsing', () => {
  it('reads canonical seven-column rows in order and flags aggregate closure', () => {
    const rows = parseRows(table(
      row('U-100', 'DONE'),
      row('U-101', 'READY', 'Aggregate: U-100 DONE', '—', 'Aggregate mission closure'),
    ));
    expect(rows.map((x) => [x.id, x.status, x.aggregate])).toEqual([
      ['U-100', 'DONE', false], ['U-101', 'READY', true],
    ]);
  });
  it('rejects malformed rows and duplicate IDs', () => {
    expect(() => parseRows('| [U-100](card.md) | outcome | READY |')).toThrow('seven columns');
    expect(() => parseRows(table(row('U-100'), row('U-100')))).toThrow('Duplicate');
  });
  it('expands range and slash lists and ignores notes after a leading dash', () => {
    expect(dependencyIds('U-101–U-103 and U-105/U-106 DONE'))
      .toEqual(['U-101', 'U-102', 'U-103', 'U-105', 'U-106']);
    expect(dependencyIds('— (verdict batched in U-119)')).toEqual([]);
    expect(() => dependencyIds('U-001–U-090')).toThrow('Invalid dependency range');
  });
});

describe('deterministic next-task selection', () => {
  it('selects first READY executable leaf in table order, not numeric or P rank', () => {
    expect(choices([
      row('U-091', 'BLOCKED'), row('U-211', 'READY'), row('U-100', 'READY'),
    ]).task_id).toBe('U-211');
  });
  it('skips aggregates and blocked dependencies but not satisfied DONE', () => {
    const selection = choices([
      row('U-020', 'READY', 'Aggregate: U-005 DONE', '—', 'Aggregate closure'),
      row('U-005', 'BLOCKED'),
      row('U-021', 'READY', 'U-005'),
      row('U-022', 'READY', 'U-023 DONE'),
      row('U-023', 'DONE'),
    ], { explain: true });
    expect(selection.task_id).toBe('U-022');
    expect(selection.skipped).toHaveLength(2);
  });
  it('accepts an archived DONE dependency but never an archived CANCELLED', () => {
    expect(choices([row('U-201', 'READY', 'U-010')], {
      archives: [table(archiveRow('U-010'))],
    }).status).toBe('READY');
    expect(choices([row('U-201', 'READY', 'U-010'), row('U-202')], {
      archives: [table(archiveRow('U-010', 'CANCELLED'))],
    }).task_id).toBe('U-202');
  });
  it('fails closed on missing dependency record instead of falling through', () => {
    const result = choices([row('U-201', 'READY', 'U-099'), row('U-202')]);
    expect(result.status).toBe('UNKNOWN');
    expect(result.task_id).toBe('U-201');
  });
  it('checks merged REVIEW PR with base main and only reads the candidate card', () => {
    const lookupMerged = vi.fn(() => true);
    const readCard = vi.fn(() => '# Candidate\nVerdict batched with another task.');
    const result = choices([
      row('U-301', 'REVIEW', '—', '[#321](https://github.com/JoshuaLRay/Sandline/pull/321)'),
      row('U-302', 'READY', 'U-301'),
    ], { lookupMerged, readCard });
    expect(result.status).toBe('READY');
    expect(result.task_id).toBe('U-302');
    expect(lookupMerged).toHaveBeenCalledExactlyOnceWith(321);
    expect(readCard).toHaveBeenCalledExactlyOnceWith('docs/backlog/U-302.md');
  });
  it('blocks on unmerged REVIEW instead of selecting that dependency', () => {
    const result = choices([
      row('U-301', 'REVIEW', '—', '#321'), row('U-302', 'READY', 'U-301'),
      row('U-303'),
    ], { lookupMerged: () => false });
    expect(result.task_id).toBe('U-303');
  });
  it('does not treat unknown REVIEW merge status or unreadable card as satisfied', () => {
    const rows = [row('U-301', 'REVIEW', '—', '#321'), row('U-302', 'READY', 'U-301'), row('U-303')];
    expect(choices(rows).status).toBe('UNKNOWN');
    expect(choices(rows, { lookupMerged: () => true, readCard: () => {
      throw new Error('unreadable');
    } }).status).toBe('UNKNOWN');
  });
  it('honors dependent task explicit human-verdict gate even for merged REVIEW', () => {
    const result = choices([
      row('U-301', 'REVIEW', '—', '#321'), row('U-302', 'READY', 'U-301'),
      row('U-303'),
    ], { lookupMerged: () => true,
      readCard: () => 'This card requires owner approval before U-302 can start.' });
    expect(result.task_id).toBe('U-303');
  });
  it('skips claimed branches and PRs, with actionable resumption for explicit IDs', () => {
    const claims: Claim[] = [
      { id: 'U-301', kind: 'branch', reference: 'refs/heads/task/U-301-shooter' },
      { id: 'U-302', kind: 'pr', reference: 'https://github.com/JoshuaLRay/Sandline/pull/500' },
    ];
    const rows = [row('U-301'), row('U-302'), row('U-303')];
    expect(choices(rows, { claims }).task_id).toBe('U-303');
    const explicit = choices(rows, { claims, id: 'U-302' });
    expect(explicit.status).toBe('CLAIMED');
    expect(explicit.reason).toContain('Resume');
  });
  it('explicit ID cannot override blockers, READY state or unknown ID', () => {
    expect(choices([row('U-301', 'BLOCKED'), row('U-302')], { id: 'U-301' }).status).toBe('BLOCKED');
    expect(choices([row('U-301', 'READY', 'U-099'), row('U-302')], { id: 'U-301' }).status).toBe('UNKNOWN');
    expect(choices([row('U-301')], { id: 'U-777' }).status).toBe('UNKNOWN');
    expect(() => choices([row('U-301')], { id: 'not-an-id' })).toThrow('Invalid task ID');
  });
  it('detects archive conflicts instead of choosing a possibly unsafe task', () => {
    expect(() => choices([row('U-301', 'READY')], {
      archives: [table(archiveRow('U-301'))],
    })).toThrow('Conflicting');
  });
  it('reports no eligible READY leaf without inventing work', () => {
    expect(choices([row('U-301', 'BLOCKED'), row('U-302', 'INBOX')]).status).toBe('NONE');
  });
});

describe('remote claim normalization', () => {
  it('recognizes task branches and open PR titles without matching incidental body text', () => {
    const result = claimsFromRemote([
      { title: 'U-201: fix nav', number: 100, html_url: 'https://example.test/pr/100',
        head: { ref: 'claude/repair-nav' } },
      { title: 'Refactor cache for U-202', number: 101, html_url: 'https://example.test/pr/101',
        head: { ref: 'feature/cache' } },
      { title: 'Documentation cleanup', number: 102, html_url: 'https://example.test/pr/102',
        head: { ref: 'task/U-203-cleanup' } },
    ], [{ ref: 'refs/heads/task/U-204-work' }, { ref: 'refs/heads/feature/misc' }]);
    expect(result.map((x) => x.id)).toEqual(['U-204', 'U-201', 'U-202', 'U-203']);
  });
});
