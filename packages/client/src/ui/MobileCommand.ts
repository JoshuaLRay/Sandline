import { ORDER_KINDS, type OrderAddress, type OrderKind } from '@sandline/shared';
import { commandKey, watchedStatus, type CommandRow } from './menu/commandModel.ts';
import './mobileCommand.css';

/** Squad decisions for touch spectators, without soldier controls. */
export function createMobileCommand(parent: HTMLElement, actions: {
  watch: (slot: number) => void;
  assign: (bot: number, commander: number) => void;
  order: (kind: OrderKind, address: OrderAddress, x: number, y: number) => boolean;
  leave: () => void;
}) {
  const root = document.createElement('aside');
  root.className = 'mobile-command';
  root.hidden = true;
  root.setAttribute('aria-label', 'Spectator and squad command');
  const overview = document.createElement('p');
  overview.className = 'mobile-overview';
  overview.textContent = 'Spectator · Commander | Drag to look · Double tap to order';
  const fullscreen = document.createElement('button');
  fullscreen.type = 'button';
  fullscreen.className = 'mobile-fullscreen';
  const iphone = /iPhone|iPod/.test(navigator.userAgent);
  const fullscreenHelp = document.createElement('p');
  fullscreenHelp.className = 'mobile-fullscreen-help';
  fullscreenHelp.id = 'mobile-fullscreen-help';
  fullscreenHelp.hidden = true;
  fullscreenHelp.textContent = iphone
    ? 'To hide Chrome or Safari bars: tap Share → Add to Home Screen, then open Sandline from its Home Screen icon. iPhone browsers cannot toggle tab fullscreen.'
    : 'Fullscreen is unavailable here. Use your browser menu to add Sandline to your Home screen, then launch it from there.';
  fullscreen.setAttribute('aria-controls', fullscreenHelp.id);
  fullscreen.setAttribute('aria-expanded', 'false');
  const installed = matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  fullscreen.hidden = installed;
  const syncFullscreen = (): void => {
    const active = Boolean(document.fullscreenElement);
    fullscreen.setAttribute('aria-label', active ? 'Exit fullscreen' : iphone ? 'Fullscreen setup' : 'Enter fullscreen');
    fullscreen.setAttribute('aria-pressed', String(active));
    fullscreen.textContent = active ? '⤢' : '⛶';
    if (active) {
      fullscreenHelp.hidden = true;
      fullscreen.setAttribute('aria-expanded', 'false');
    }
  };
  const showFullscreenHelp = (): void => {
    fullscreenHelp.hidden = false;
    fullscreen.setAttribute('aria-expanded', 'true');
  };
  fullscreen.addEventListener('click', () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(showFullscreenHelp);
    } else if (document.documentElement.requestFullscreen) {
      // A browser fullscreen request must run directly from this tap.
      void document.documentElement.requestFullscreen().catch(showFullscreenHelp);
    } else {
      fullscreenHelp.hidden = !fullscreenHelp.hidden;
      fullscreen.setAttribute('aria-expanded', String(!fullscreenHelp.hidden));
    }
  });
  document.addEventListener('fullscreenchange', syncFullscreen);
  syncFullscreen();
  const status = document.createElement('p');
  status.className = 'mobile-watch-status';
  const who = document.createElement('button');
  const what = document.createElement('button');
  for (const button of [who, what]) {
    button.type = 'button';
    button.className = 'mobile-trigger';
  }
  who.setAttribute('aria-label', 'Choose who receives orders');
  what.setAttribute('aria-label', 'Choose order');
  const controls = document.createElement('div');
  controls.className = 'mobile-controls';
  controls.append(who, what);
  const menu = document.createElement('div');
  menu.className = 'mobile-command-menu';
  menu.hidden = true;
  root.append(overview, status, fullscreen, fullscreenHelp, controls, menu);
  parent.append(root);
  let rows: readonly CommandRow[] = [];
  let watched = -1;
  let mySlot = -1;
  let address: OrderAddress = { to: 'all' };
  let kind: OrderKind = 'move';
  let open: 'who' | 'order' | null = null;
  let drawn = '';

  function choice(text: string, selected: boolean, action: () => void): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mobile-choice';
    button.textContent = text;
    button.setAttribute('aria-pressed', String(selected));
    button.addEventListener('click', action);
    menu.append(button);
  }
  function heading(text: string): void {
    const label = document.createElement('div');
    label.className = 'mobile-heading';
    label.textContent = text;
    menu.append(label);
  }
  function render(): void {
    status.textContent = watchedStatus(rows, watched, mySlot);
    const selectedSlot = address.to === 'slot' ? address.index : -1;
    const selectedRow = rows.find(row => row.slot === selectedSlot);
    const recipient = selectedSlot < 0 ? 'All my bots' : selectedRow && !selectedRow.human && selectedRow.commander === mySlot ? selectedRow.label : 'Unavailable bot';
    who.textContent = `Who · ${recipient}`;
    what.textContent = `Order · ${kind[0]!.toUpperCase()}${kind.slice(1)}`;
    who.setAttribute('aria-expanded', String(open === 'who'));
    what.setAttribute('aria-expanded', String(open === 'order'));
    menu.replaceChildren();
    menu.hidden = open === null;
    if (open === 'order') {
      heading('Choose order, then double tap the scene');
      for (const option of ORDER_KINDS) choice(option[0]!.toUpperCase() + option.slice(1), kind === option, () => {
        kind = option; open = null; render();
      });
    }
    if (open !== 'who') return;
    heading('Order recipients');
    choice('All commanded bots', address.to === 'all', () => { address = { to: 'all' }; open = null; render(); });
    for (const row of rows) {
      if (row.human || row.commander !== mySlot) continue;
      choice(row.label, selectedSlot === row.slot, () => {
        address = { to: 'slot', index: row.slot }; open = null; render();
      });
    }
    heading('Watch');
    for (const row of rows) choice(`${row.label} · ${row.human ? 'Human' : row.commander === mySlot ? 'Your bot' : 'Other player’s bot'}`, watched === row.slot, () => {
      actions.watch(row.slot); watched = row.slot; open = null; render();
    });
    heading('Commander assignments');
    for (const row of rows) {
      if (row.human) continue;
      const assignment = document.createElement('label');
      assignment.className = 'mobile-assignment';
      assignment.textContent = row.label;
      const select = document.createElement('select');
      select.setAttribute('aria-label', `Commander of slot ${row.slot + 1}`);
      for (const option of row.options) select.add(new Option(option.label, String(option.slot)));
      select.value = String(row.commander);
      select.addEventListener('change', () => actions.assign(row.slot, Number(select.value)));
      assignment.append(select);
      menu.append(assignment);
    }
    choice('Leave session', false, actions.leave);
  }
  who.addEventListener('click', () => { open = open === 'who' ? null : 'who'; render(); });
  what.addEventListener('click', () => { open = open === 'order' ? null : 'order'; render(); });
  render();
  return {
    root,
    issueAt(x: number, y: number): boolean {
      const selectedSlot = address.to === 'slot' ? address.index : -1;
      if (selectedSlot >= 0 && !rows.some(row => row.slot === selectedSlot && !row.human && row.commander === mySlot)) return false;
      return actions.order(kind, address, x, y);
    },
    update(next: readonly CommandRow[], slot: number, commanderSlot: number) {
      mySlot = commanderSlot;
      const key = commandKey(next);
      if (key !== drawn) {
        drawn = key;
        rows = next;
        render();
      }
      if (watched !== slot) {
        watched = slot;
        render();
      }
    },
  };
}
