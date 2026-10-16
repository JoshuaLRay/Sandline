/**
 * Read-only task selection for the canonical Sandline backlog.
 *
 * Only BACKLOG.md, the archive index, a candidate card (when a REVIEW
 * dependency might require a human verdict), and fresh GitHub claim/PR
 * metadata are consulted. Never infer that missing remote data means free.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATUS = new Set(['INBOX', 'READY', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE', 'CANCELLED']);
const TASK_RE = /^U-\d{3}$/;
const REPO = 'JoshuaLRay/Sandline';

export interface TaskRow {
  id: string;
  card: string;
  outcome: string;
  status: string;
  blocker: string;
  work: string;
  aggregate: boolean;
}
export interface Claim {
  id: string;
  kind: 'branch' | 'pr';
  reference: string;
}
export interface Selection {
  task_id: string | null;
  card?: string;
  outcome?: string;
  status: string;
  dependencies?: string;
  claim?: string;
  reason?: string;
  skipped?: string[];
}
export interface SelectionInput {
  backlog: string;
  archives: string[];
  claims: Claim[];
  lookupMerged: (number: number) => boolean | null;
  readCard: (path: string) => string;
  id?: string;
  explain?: boolean;
}

export function parseRows(markdown: string): TaskRow[] {
  const result: TaskRow[] = [];
  const seen = new Set<string>();
  for (const line of markdown.split(/\r?\n/)) {
    if (!/^\|\s*\[U-\d{3}\]\(/.test(line)) continue;
    const fields = line.split('|').slice(1, -1).map((part) => part.trim());
    if (fields.length !== 7) throw new Error('Malformed backlog row: expected seven columns');
    const [taskCell = '', outcome = '', _epic = '', _priority = '',
      status = '', blocker = '', work = ''] = fields;
    const task = /^\[(U-\d{3})\]\(([^)]+)\)$/.exec(taskCell);
    const id = task?.[1];
    const card = task?.[2];
    if (!id || !card || !STATUS.has(status)) {
      throw new Error('Malformed backlog row: invalid ID, card or status');
    }
    if (seen.has(id)) throw new Error('Duplicate backlog ID: ' + id);
    seen.add(id);
    result.push({
      id, card, outcome, status, blocker, work,
      aggregate: /\baggregate\b|\bumbrella\b|\bepic closure\b/i.test(outcome) ||
        /^\s*Aggregate\b/i.test(blocker),
    });
  }
  if (!result.length) throw new Error('No task rows found in backlog/archive');
  return result;
}

export function dependencyIds(blocker: string): string[] {
  // A leading dash means "no dependencies"; parenthetical notes may still
  // mention a review task, which is not a prerequisite.
  if (/^\s*[—–-](?:\s|$)/.test(blocker)) return [];
  const ids: string[] = [];
  for (const found of blocker.matchAll(/U-(\d{3})(?:\s*[–-]\s*U-(\d{3}))?/g)) {
    const first = Number(found[1]);
    const last = found[2] ? Number(found[2]) : first;
    if (last < first || last - first > 30) throw new Error('Invalid dependency range: ' + found[0]);
    for (let n = first; n <= last; n++) ids.push('U-' + String(n).padStart(3, '0'));
  }
  return [...new Set(ids)];
}

export function claimsFromRemote(
  prs: Array<{ title: string; number: number; html_url: string; head: { ref: string } }>,
  refs: Array<{ ref: string }>,
): Claim[] {
  const claims: Claim[] = [];
  const branchId = (ref: string) => /(?:^|\/)task\/(U-\d{3})(?:[-/]|$)/i.exec(ref)?.[1]?.toUpperCase();
  for (const ref of refs) {
    const id = branchId(ref.ref.replace(/^refs\/heads\//, ''));
    if (id) claims.push({ id, kind: 'branch', reference: ref.ref });
  }
  for (const pr of prs) {
    const id = branchId(pr.head.ref) ??
      /(?:^|\W)(U-\d{3})(?!\d)/i.exec(pr.title)?.[1];
    if (id) claims.push({ id: id.toUpperCase(), kind: 'pr', reference: pr.html_url || '#' + pr.number });
  }
  return claims;
}

function requiresVerdictFirst(card: string): boolean {
  return /(?:requires?|needs?|waits? for)\s+(?:an?\s+|the\s+)?(?:owner|human)[\s\S]{0,65}?(?:verdict|approval|sign.off)\s+before\b/i.test(card) ||
    /(?:human|owner)\s+(?:verdict|approval|sign.off)[\s\S]{0,45}?\b(?:required|must pass)\s+before\b/i.test(card);
}

export function selectTask(input: SelectionInput): Selection {
  const active = parseRows(input.backlog);
  const index = new Map(active.map((row) => [row.id, row]));
  for (const archive of input.archives) {
    for (const row of parseRows(archive)) {
      if (row.status !== 'DONE' && row.status !== 'CANCELLED') {
        throw new Error('Invalid archived task state for ' + row.id);
      }
      const prior = index.get(row.id);
      if (prior && prior.status !== row.status) throw new Error('Conflicting task states for ' + row.id);
      if (!prior) index.set(row.id, row);
    }
  }
  if (input.id && !TASK_RE.test(input.id)) throw new Error('Invalid task ID: ' + input.id);
  const candidates = input.id ? active.filter((task) => task.id === input.id) :
    active.filter((task) => task.status === 'READY');
  if (input.id && !candidates.length) {
    return { task_id: input.id, status: 'UNKNOWN', reason: 'ID absent from active backlog; inspect archive manually' };
  }

  const skipped: string[] = [];
  for (const task of candidates) {
    if (task.status !== 'READY') {
      return { task_id: task.id, status: task.status, reason: 'Not READY; do not override canonical status' };
    }
    if (task.aggregate) {
      if (input.id) return { task_id: task.id, status: 'BLOCKED', reason: 'Aggregate closure; claim an executable leaf' };
      skipped.push(task.id + ': aggregate closure');
      continue;
    }
    let problem: string | undefined;
    let uncertain = false;
    for (const id of dependencyIds(task.blocker)) {
      const dep = index.get(id);
      if (!dep) { problem = 'Missing dependency record: ' + id; uncertain = true; break; }
      if (dep.status === 'DONE') continue;
      if (dep.status === 'REVIEW') {
        // The dependent card, and only this candidate card, may explicitly
        // require a verdict rather than merely merged engineering.
        let card: string;
        try { card = input.readCard(task.card); }
        catch { problem = 'Cannot inspect verdict requirement in ' + task.card; uncertain = true; break; }
        if (requiresVerdictFirst(card)) { problem = id + ' needs human verdict first'; break; }
        const number = /#(\d+)/.exec(dep.work)?.[1] ?? /#(\d+)/.exec(dep.blocker)?.[1];
        if (!number) { problem = id + ' REVIEW merge cannot be verified'; uncertain = true; break; }
        const merged = input.lookupMerged(Number(number));
        if (merged === null) { problem = id + ' REVIEW merge status unknown'; uncertain = true; break; }
        if (merged) continue;
      }
      problem = id + ' is ' + dep.status + (dep.status === 'REVIEW' ? ' (not merged to main)' : '');
      break;
    }
    if (uncertain) {
      return { task_id: task.id, card: task.card, status: 'UNKNOWN', reason: problem ?? 'Dependency check incomplete', ...(input.explain ? { skipped } : {}) };
    }
    if (problem) {
      if (input.id) return { task_id: task.id, card: task.card, status: 'BLOCKED', reason: problem };
      skipped.push(task.id + ': ' + problem);
      continue;
    }
    const claim = input.claims.find((item) => item.id === task.id);
    if (claim) {
      if (input.id) {
        return { task_id: task.id, card: task.card, status: 'CLAIMED', claim: claim.kind + ': ' + claim.reference,
          reason: 'Resume the existing claim; do not start a competing branch' };
      }
      skipped.push(task.id + ': claimed by ' + claim.reference);
      continue;
    }
    return { task_id: task.id, card: task.card, outcome: task.outcome, status: 'READY',
      dependencies: 'satisfied', claim: 'unclaimed (remote checked)',
      ...(input.explain ? { skipped } : {}) };
  }
  return { task_id: null, status: 'NONE', reason: 'No eligible unclaimed READY leaf; inspect blockers',
    ...(input.explain ? { skipped } : {}) };
}

function api(repo: string, path: string, paginate = false): string {
  const args = ['api'];
  if (paginate) args.push('--paginate', '--jq', '.[] | @json');
  args.push('repos/' + repo + '/' + path);
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] });
}

function fetchClaims(repo: string): Claim[] {
  // --paginate exits nonzero if any page fails; never treat a partial result as clear.
  const output = api(repo, 'pulls?state=open&per_page=100', true);
  const prs = output.trim() ? output.trim().split(/\r?\n/).map((line) => JSON.parse(line)) as Array<{
    title: string; number: number; html_url: string; head: { ref: string };
  }> : [];
  const refs = JSON.parse(api(repo, 'git/matching-refs/heads/task/U-')) as Array<{ ref: string }>;
  if (!Array.isArray(refs)) throw new Error('GitHub branch response was incomplete');
  return claimsFromRemote(prs, refs);
}

function readArchives(root: string): string[] {
  const folder = join(root, 'docs/backlog/archive');
  return readdirSync(folder).filter((name) => name.endsWith('.md')).sort()
    .map((name) => readFileSync(join(folder, name), 'utf8'));
}

function main(): void {
  const flags = process.argv.slice(2);
  const idIndex = flags.indexOf('--id');
  const id = idIndex >= 0 ? flags[idIndex + 1] : undefined;
  if ((idIndex >= 0 && (!id || !TASK_RE.test(id))) ||
    flags.some((flag, i) => flag !== '--explain' && flag !== '--id' && !(idIndex >= 0 && i === idIndex + 1))) {
    throw new Error('Usage: pnpm task:next [--id U-NNN] [--explain]');
  }
  const root = process.cwd();
  // Fetch first: a missing gh CLI, stale auth or failed remote call MUST NOT
  // turn into a false "unclaimed" result.
  const claims = fetchClaims(REPO);
  const merged = new Map<number, boolean | null>();
  const lookupMerged = (number: number): boolean | null => {
    if (!merged.has(number)) {
      const pr = JSON.parse(api(REPO, 'pulls/' + number)) as {
        merged_at: string | null; base: { ref: string };
      };
      merged.set(number, Boolean(pr.merged_at) && pr.base.ref === 'main');
    }
    return merged.get(number) ?? null;
  };
  const result = selectTask({
    backlog: readFileSync(join(root, 'BACKLOG.md'), 'utf8'),
    archives: readArchives(root), claims, lookupMerged,
    readCard: (path) => readFileSync(join(root, path), 'utf8'),
    ...(id ? { id } : {}), explain: flags.includes('--explain'),
  });
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result.status === 'UNKNOWN') process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    process.stderr.write('task:next unknown — ' + (error instanceof Error ? error.message : String(error)) +
      '. Check GitHub authentication and use the manual next-task fallback.\n');
    process.exitCode = 2;
  }
}
