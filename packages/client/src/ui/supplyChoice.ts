import type { SupplyItem } from '@sandline/shared';
import { supplyItemKey, supplyItemName, type SupplyChoiceModel } from './supplyModel.ts';
import './supplyChoice.css';

/** A gameplay HUD control. Tab supplies desktop mouse access; E remains the host's held-use input. */
export function createSupplyChoice(parent: HTMLElement, select: (cacheId: string, item: SupplyItem | null) => void) {
  const root = document.createElement('aside');
  root.className = 'supply-choice'; root.hidden = true;
  root.setAttribute('aria-label', 'Supply cache');
  const heading = document.createElement('h2');
  const empty = document.createElement('p'); empty.className = 'supply-empty'; empty.textContent = 'Empty supply cache';
  const rows = document.createElement('div'); rows.className = 'supply-rows';
  const progress = document.createElement('progress'); progress.max = 100; progress.setAttribute('aria-label', 'Cache use');
  const status = document.createElement('p'); status.className = 'supply-status'; status.setAttribute('role', 'status');
  const others = document.createElement('p'); others.className = 'supply-others';
  const help = document.createElement('p'); help.className = 'supply-help';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel selection';
  root.append(heading, empty, rows, progress, status, others, help, cancel); parent.append(root);
  let current: SupplyChoiceModel | null = null;
  let rowsKey = '';
  let pendingId: string | null = null;
  cancel.addEventListener('click', () => { if (current) select(current.id, null); pendingId = null; });
  return {
    root,
    set(model: SupplyChoiceModel | null) {
      if ((pendingId || current?.own) && (!model || model.id !== current?.id || model.readOnly)) {
        select(pendingId ?? current!.id, null); pendingId = null;
      }
      current = model; root.hidden = model === null;
      if (!model) { rowsKey = ''; return; }
      if (model.own) pendingId = null;
      root.classList.toggle('read-only', model.readOnly);
      heading.textContent = `Supplies · ${model.id}`; empty.hidden = !model.empty;
      const selected = model.own ? supplyItemKey(model.own.item) : '';
      const nextKey = JSON.stringify([model.id, model.readOnly, model.choices, selected]);
      if (nextKey !== rowsKey) {
        rowsKey = nextKey;
        const focusKey = root.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset['item'] : undefined;
        rows.replaceChildren();
        for (const choice of model.choices) {
          const row = document.createElement(model.readOnly ? 'div' : 'button'); row.className = 'supply-row';
          const key = supplyItemKey(choice.item); row.dataset['item'] = key;
          const label = document.createElement('span'); label.textContent = choice.name;
          const stock = document.createElement('span'); stock.textContent = choice.stock;
          const detail = document.createElement('small'); detail.textContent = choice.detail;
          row.append(label, stock, detail);
          if (row instanceof HTMLButtonElement) {
            row.type = 'button'; row.disabled = choice.status !== 'transferred';
            row.setAttribute('aria-pressed', String(selected === key));
            row.addEventListener('click', () => { pendingId = model.id; select(model.id, choice.item); });
          }
          rows.append(row);
          if (focusKey === key && row instanceof HTMLButtonElement && !row.disabled) row.focus();
        }
      }
      progress.hidden = !model.own; progress.value = model.own?.percent ?? 0;
      status.textContent = model.own ? `${supplyItemName(model.own.item)} · ${model.own.percent > 0 ? `${model.own.percent}%` : 'Hold E to use'}`
        : model.readOnly ? 'Watching supplies' : model.empty ? 'All supplies depleted' : 'Choose one item';
      others.textContent = model.others.map(use => `Slot ${use.slot + 1} · ${supplyItemName(use.item)} · ${use.percent}%`).join(' / ');
      others.hidden = model.others.length === 0;
      help.textContent = model.readOnly ? 'Stock and use progress update from the host.'
        : 'Hold Tab to choose · Release Tab, then hold E to use · Release E to interrupt';
      cancel.hidden = model.readOnly || !model.own;
    },
  };
}
