import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseRows, dependencyIds } from './task-next.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const active = parseRows(readFileSync(join(root, 'BACKLOG.md'), 'utf8'));
const folder = join(root, 'docs/backlog/archive');
const archiveFiles = readdirSync(folder).filter((name) => name.endsWith('.md')).sort();
const archived = archiveFiles.flatMap((name) =>
  parseRows(readFileSync(join(folder, name), 'utf8')).map((row) => ({ row, file: name })));
const all = [...active.map((row) => ({ row, file: 'BACKLOG.md' })), ...archived];
const index = new Map(all.map(({ row }) => [row.id, row]));

describe('canonical task index', () => {
  it('keeps DONE and CANCELLED rows out of the active backlog', () => {
    expect(active.filter((row) => row.status === 'DONE' || row.status === 'CANCELLED'))
      .toEqual([]);
    expect(archived.filter(({ row }) => row.status !== 'DONE' && row.status !== 'CANCELLED'))
      .toEqual([]);
  });

  it('has one canonical status row per U-ID across active and archives', () => {
    const ids = all.map(({ row }) => row.id);
    expect(ids.length).toBe(new Set(ids).size);
    expect(archiveFiles).toContain('2026-10-16-done.md');
  });

  it('preserves all linked task cards, including archived rows', () => {
    const missing = all.filter(({ row, file }) => {
      const parent = file === 'BACKLOG.md' ? root : folder;
      return !existsSync(resolve(parent, row.card));
    }).map(({ row }) => row.id);
    expect(missing).toEqual([]);
  });

  it('resolves each dependency mentioned in active queue rows', () => {
    const missing = active.flatMap((row) =>
      dependencyIds(row.blocker).filter((id) => !index.has(id))
        .map((id) => row.id + ' -> ' + id));
    expect(missing).toEqual([]);
  });

  it('retains archived DONE dependencies as satisfied but never CANCELLED', () => {
    expect(archived.every(({ row }) => row.status === 'DONE' || row.status === 'CANCELLED'))
      .toBe(true);
    for (const row of active) {
      for (const id of dependencyIds(row.blocker)) {
        const dep = index.get(id);
        expect(dep).toBeDefined();
        if (dep?.status === 'CANCELLED') expect(row.status).not.toBe('READY');
      }
    }
  });
});
