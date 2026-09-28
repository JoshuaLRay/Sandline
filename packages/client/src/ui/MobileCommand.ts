import { ORDER_KINDS, type OrderAddress, type OrderKind } from '@sandline/shared';
import { commandKey, type CommandRow } from './menu/commandModel.ts';
import './mobileCommand.css';

/** Touch controls deliberately expose squad decisions, never soldier controls. */
export function createMobileCommand(parent: HTMLElement, actions: {
  watch: (slot: number) => void;
  assign: (bot: number, commander: number) => void;
  order: (kind: OrderKind, address: OrderAddress) => void;
  leave: () => void;
}) {
  const root = document.createElement('aside');
  root.className = 'mobile-command';
  root.hidden = true;
  root.setAttribute('aria-label', 'Spectator and squad command');
  const title = document.createElement('strong');
  title.textContent = 'SPECTATOR · COMMAND';
  root.append(title);
  const watch = document.createElement('select');
  watch.setAttribute('aria-label', 'Watch squad member');
  watch.addEventListener('change', () => actions.watch(Number(watch.value)));
  root.append(watch);
  const address = document.createElement('select');
  address.setAttribute('aria-label', 'Order recipients');
  root.append(address);
  const orders = document.createElement('div');
  orders.className = 'mobile-orders';
  for (const kind of ORDER_KINDS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = kind;
    button.addEventListener('click', () => {
      const [to, index] = address.value.split(':');
      actions.order(kind, to === 'all' ? { to: 'all' } : { to: 'slot', index: Number(index) });
    });
    orders.append(button);
  }
  root.append(orders);
  const assignments = document.createElement('div');
  root.append(assignments);
  const leave = document.createElement('button');
  leave.type = 'button';
  leave.textContent = 'Leave session';
  leave.addEventListener('click', actions.leave);
  root.append(leave);
  parent.append(root);
  let drawn = '';
  return {
    root,
    update(rows: readonly CommandRow[], watched: number) {
      const key = commandKey(rows);
      if (key !== drawn) {
        drawn = key;
        watch.replaceChildren();
        address.replaceChildren();
        address.add(new Option('All commanded bots', 'all'));
        assignments.replaceChildren();
        for (const row of rows) {
          watch.add(new Option(row.label, String(row.slot)));
          if (row.human) continue;
          address.add(new Option(row.label, `slot:${row.slot}`));
          const label = document.createElement('label');
          label.textContent = `${row.label} · commander `;
          const pick = document.createElement('select');
          pick.setAttribute('aria-label', `Commander of slot ${row.slot + 1}`);
          if (row.commander < 0) pick.add(new Option('Nobody', '-1'));
          for (const option of row.options) pick.add(new Option(option.label, String(option.slot)));
          pick.value = String(row.commander);
          pick.addEventListener('change', () => actions.assign(row.slot, Number(pick.value)));
          label.append(pick);
          assignments.append(label);
        }
      }
      if (watched >= 0) watch.value = String(watched);
    },
  };
}
