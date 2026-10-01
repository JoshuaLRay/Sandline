/**
 * The Tab scoreboard (T-4.28): the six slots with the server's kills,
 * deaths, revives, orders given and carried, over the mission's clock.
 * Built once; `update` writes the rows `scoreboardRows` computed from the
 * host's `Stats` message and the roster, touching the DOM only on change.
 */
import { MAX_SLOTS, type MissionView, type RunKind, type ScoreboardRow, clockText } from '@sandline/shared';
import { missionLine } from './missionHud.ts';
import { type RunChoiceModel, createRunChoice } from './runChoice.ts';

export interface Scoreboard {
  readonly root: HTMLElement;
  update(rows: readonly ScoreboardRow[], clockSeconds: number, summary: string): void;
  setOutcome(mission: MissionView | null, restart: (full: boolean) => void): void;
  /** U-090: the debrief and the host's choice of the next run, or null while the mission is on. */
  setRunChoice(model: RunChoiceModel | null, choose: (run: RunKind, mission: string) => void): void;
  setVisible(on: boolean): void;
  readonly visible: boolean;
}

const COLUMNS = ['kills', 'deaths', 'revives', 'ordersGiven', 'ordersCarried'] as const;
const HEADINGS: Readonly<Record<(typeof COLUMNS)[number], string>> = {
  kills: 'K',
  deaths: 'D',
  revives: 'REV',
  ordersGiven: 'GAVE',
  ordersCarried: 'DID',
};

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function createScoreboard(parent: HTMLElement): Scoreboard {
  const root = document.createElement('div');
  root.id = 'scoreboard';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Scoreboard');
  root.classList.add('hidden');
  const head = document.createElement('div');
  head.className = 'scoreboard-head';
  const title = document.createElement('span');
  title.textContent = 'SQUAD';
  const clock = document.createElement('span');
  clock.className = 'scoreboard-clock';
  head.append(title, clock);
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const text of ['', 'SOLDIER', ...COLUMNS.map((c) => HEADINGS[c])]) {
    const th = document.createElement('th');
    th.textContent = text;
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement('tbody');
  const rows: { root: HTMLTableRowElement; name: HTMLTableCellElement; cells: HTMLTableCellElement[] }[] = [];
  for (let i = 0; i < MAX_SLOTS; i += 1) {
    const tr = document.createElement('tr');
    const number = document.createElement('td');
    number.textContent = String(i + 1);
    const name = document.createElement('td');
    name.className = 'scoreboard-name';
    tr.append(number, name);
    const cells: HTMLTableCellElement[] = [];
    for (const _column of COLUMNS) {
      const td = document.createElement('td');
      td.className = 'scoreboard-count';
      td.textContent = '0';
      tr.append(td);
      cells.push(td);
    }
    tbody.append(tr);
    rows.push({ root: tr, name, cells });
  }
  table.append(thead, tbody);
  const summary = document.createElement('div');
  summary.className = 'scoreboard-summary';
  const failure = document.createElement('div');
  failure.className = 'scoreboard-failure hidden';
  const actions = document.createElement('div');
  actions.className = 'scoreboard-actions hidden';
  const checkpoint = document.createElement('button');
  checkpoint.type = 'button';
  checkpoint.textContent = 'Restart from last checkpoint';
  const full = document.createElement('button');
  full.type = 'button';
  full.textContent = 'Restart mission';
  actions.append(checkpoint, full);
  root.append(head, failure, table, summary, actions);
  const runs = createRunChoice(root);
  parent.append(root);
  let shown = false;
  let onRestart: (full: boolean) => void = () => {};
  checkpoint.addEventListener('click', () => onRestart(false));
  full.addEventListener('click', () => onRestart(true));
  return {
    root,
    get visible() {
      return shown;
    },
    setOutcome(mission, restart) {
      onRestart = restart;
      const failed = mission?.state === 'failed';
      setText(failure, failed ? missionLine(mission).split('  ·  ')[0]! : '');
      failure.classList.toggle('hidden', !failed);
      actions.classList.toggle('hidden', !failed);
    },
    setRunChoice(model, choose) {
      runs.set(model, choose);
    },
    update(next, clockSeconds, summaryText) {
      if (!shown) return;
      setText(clock, clockText(clockSeconds));
      next.forEach((row, i) => {
        const node = rows[i];
        if (!node) return;
        setText(node.name, row.status ? `${row.label} — ${row.status}` : row.label);
        node.root.dataset['status'] = row.status;
        node.root.classList.toggle('you', row.you);
        node.root.classList.toggle('bot', !row.human);
        COLUMNS.forEach((column, c) => setText(node.cells[c]!, String(row[column])));
      });
      setText(summary, summaryText);
      summary.classList.toggle('hidden', summaryText.length === 0);
    },
    setVisible(on) {
      shown = on;
      root.classList.toggle('hidden', !on);
    },
  };
}
