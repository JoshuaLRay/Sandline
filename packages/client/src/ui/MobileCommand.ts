import { AGGRESSION_KINDS, ORDER_KINDS, type SquadAggression, type OrderAddress, type OrderKind } from '@sandline/shared';
import { commandKey, watchedStatus, type CommandRow } from './menu/commandModel.ts';
import './mobileCommand.css';

/** Squad decisions for touch spectators, without soldier controls. */
export function createMobileCommand(parent: HTMLElement, actions: {
  watch: (slot: number) => void;
  assign: (bot: number, commander: number) => void;
  aggression: (mode: SquadAggression, address: OrderAddress) => void;
  order: (kind: OrderKind, address: OrderAddress, x: number, y: number) => boolean;
  settings: () => void;
  leave: () => void;
  recenter: () => void;
}) {
  const root = document.createElement('aside');
  root.className = 'mobile-command';
  root.hidden = true;
  root.setAttribute('aria-label', 'Spectator and squad command');
  const overview = document.createElement('p');
  overview.className = 'mobile-overview';
  overview.textContent = 'Drag to orbit · Pinch to zoom';
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
  const settings = document.createElement('button');
  settings.type = 'button';
  settings.className = 'mobile-settings';
  settings.setAttribute('aria-label', 'Settings');
  settings.textContent = '⚙';
  settings.addEventListener('click', actions.settings);
  const recenter = document.createElement('button');
  recenter.type = 'button';
  recenter.className = 'mobile-recenter';
  recenter.textContent = '↺';
  recenter.setAttribute('aria-label', 'Recenter camera');
  recenter.addEventListener('click', actions.recenter);
  const feedback = document.createElement('p');
  feedback.className = 'mobile-feedback';
  feedback.setAttribute('role', 'status');
  const marker = document.createElement('div');
  marker.className = 'mobile-order-marker';
  marker.hidden = true;
  const squad = document.createElement('div');
  squad.className = 'mobile-squad';
  squad.setAttribute('aria-label', 'Watch and select squad member');
  const quickOrders = document.createElement('div');
  quickOrders.className = 'mobile-quick-orders';
  quickOrders.setAttribute('aria-label', 'Quick orders');
  const status = document.createElement('p');
  status.className = 'mobile-watch-status';
  const who = document.createElement('button');
  const what = document.createElement('button');
  for (const button of [who, what]) {
    button.type = 'button';
    button.className = 'mobile-trigger';
  }
  who.setAttribute('aria-label', 'Squad options and commander assignments');
  what.setAttribute('aria-label', 'Choose order');
  const controls = document.createElement('div');
  controls.className = 'mobile-controls';
  const placementHelp = document.createElement('p');
  placementHelp.className = 'mobile-placement-help';
  placementHelp.textContent = 'Drag an order to command, or tap it then tap the scene';
  controls.append(who, placementHelp, what);
  const menu = document.createElement('div');
  menu.className = 'mobile-command-menu';
  menu.hidden = true;
  root.append(overview, status, fullscreen, settings, recenter, fullscreenHelp, squad, quickOrders, feedback, marker, controls, menu);
  parent.append(root);
  let rows: readonly CommandRow[] = [];
  let aggressions: readonly SquadAggression[] = [];
  let watched = -1;
  let mySlot = -1;
  let address: OrderAddress = { to: 'all' };
  let kind: OrderKind = 'move';
  let open: 'who' | null = null;
  let drawn = '';
  let armed = false;
  let drag: { id: number; x: number; y: number; moved: boolean; kind: OrderKind; address: OrderAddress } | null = null;
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  const announce = (text: string): void => {
    feedback.textContent = text;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { feedback.textContent = ''; }, 2400);
  };
  const eligible = (target: OrderAddress): boolean => target.to === 'all'
    ? rows.some(row => !row.human && !row.captured && row.commander === mySlot)
    : rows.some(row => row.slot === target.index && !row.human && !row.captured && row.commander === mySlot);
  const submit = (order: OrderKind, target: OrderAddress, x: number, y: number): boolean => {
    const sent = eligible(target) && actions.order(order, target, x, y);
    announce(sent ? `${order[0]!.toUpperCase()}${order.slice(1)} order sent` : 'Order unavailable here — choose a valid target');
    return sent;
  };
  const cancelPlacement = (): void => {
    drag = null;
    armed = false;
    marker.hidden = true;
    what.hidden = true;
    placementHelp.hidden = false;
    quickOrders.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', 'false'));
  };
  for (const option of ORDER_KINDS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = option[0]!.toUpperCase() + option.slice(1);
    button.setAttribute('aria-label', `${button.textContent}: drag to target or tap then tap scene`);
    button.title = 'Drag onto the scene, or tap then tap your destination';
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      cancelPlacement();
      open = null;
      kind = option;
      render();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, kind, address };
      button.setPointerCapture(event.pointerId);
    });
    button.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 12) drag.moved = true;
      if (!drag.moved) return;
      marker.hidden = false;
      marker.textContent = option;
      marker.style.left = `${event.clientX}px`;
      marker.style.top = `${event.clientY}px`;
    });
    button.addEventListener('pointerup', event => {
      if (!drag || event.pointerId !== drag.id) return;
      const released = drag;
      cancelPlacement();
      if (released.moved) {
        // Hit test with capture ignored: dropping on another control never orders.
        if (document.elementFromPoint(event.clientX, event.clientY) instanceof HTMLCanvasElement) {
          submit(released.kind, released.address, event.clientX, event.clientY);
        }
      } else {
        armed = true;
        button.setAttribute('aria-pressed', 'true');
        what.hidden = false;
        placementHelp.hidden = true;
        announce(`${button.textContent}: tap the scene to place · drag the scene to cancel`);
      }
    });
    button.addEventListener('pointercancel', cancelPlacement);
    button.addEventListener('lostpointercapture', () => { if (drag) cancelPlacement(); });
    button.addEventListener('click', event => {
      // Keyboard activation has no pointer gesture.
      if (event.detail !== 0) return;
      cancelPlacement();
      kind = option;
      armed = true;
      button.setAttribute('aria-pressed', 'true');
      what.hidden = false;
      placementHelp.hidden = true;
      announce(`${button.textContent}: tap the scene to place`);
    });
    quickOrders.append(button);
  }
  addEventListener('blur', cancelPlacement);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelPlacement(); });

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
    const watchedRow = rows.find(row => row.slot === watched);
    status.textContent = watchedRow ? `Watching ${watchedRow.label}` : watchedStatus(rows, watched, mySlot);
    squad.replaceChildren();
    const all = document.createElement('button');
    all.type = 'button';
    all.textContent = 'All';
    all.setAttribute('aria-label', 'Select all commanded bots');
    all.setAttribute('aria-pressed', String(address.to === 'all'));
    all.addEventListener('click', () => { cancelPlacement(); address = { to: 'all' }; render(); });
    squad.append(all);
    for (const row of rows) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = row.label.split(' · ').at(-1) ?? String(row.slot + 1);
      button.disabled = row.captured;
      button.setAttribute('aria-label', `Watch ${row.label}${!row.human && row.commander === mySlot ? ' and select for orders' : ''}`);
      button.setAttribute('aria-pressed', String(address.to === 'slot' && address.index === row.slot));
      button.classList.toggle('watching', watched === row.slot);
      button.addEventListener('click', () => {
        cancelPlacement();
        actions.watch(row.slot);
        watched = row.slot;
        if (!row.human && row.commander === mySlot) address = { to: 'slot', index: row.slot };
        render();
      });
      squad.append(button);
    }
    const selectedSlot = address.to === 'slot' ? address.index : -1;
    const selectedRow = rows.find(row => row.slot === selectedSlot);
    const recipient = selectedSlot < 0 ? 'All my bots' : selectedRow && !selectedRow.human && selectedRow.commander === mySlot ? selectedRow.label : 'Unavailable bot';
    who.textContent = `Squad · ${recipient}`;
    what.textContent = 'Cancel';
    what.hidden = !armed;
    placementHelp.hidden = armed;
    who.setAttribute('aria-expanded', String(open === 'who'));
    what.setAttribute('aria-label', 'Cancel order placement');
    menu.replaceChildren();
    menu.hidden = open === null;
    if (open !== 'who') return;
    heading(`Aggression · ${recipient}`);
    const targets = rows.filter(row => !row.human && !row.captured && row.commander === mySlot &&
      (address.to === 'all' || row.slot === address.index));
    const modes = targets.map(row => aggressions[row.slot] ?? 'aggressive');
    const modeStatus = document.createElement('p');
    modeStatus.className = 'mobile-aggression-status';
    modeStatus.textContent = modes.length === 0 ? 'No commanded bots available' :
      new Set(modes).size > 1 ? 'Current: mixed' : `Current: ${aggressionLabel(modes[0]!)}`;
    menu.append(modeStatus);
    const policies = document.createElement('div');
    policies.className = 'mobile-aggression';
    policies.setAttribute('role', 'group');
    policies.setAttribute('aria-label', 'Aggression of selected bots');
    for (const mode of AGGRESSION_KINDS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mobile-choice';
      button.textContent = aggressionLabel(mode);
      button.disabled = !eligible(address);
      button.setAttribute('aria-pressed', String(modes.length > 0 && modes.every(value => value === mode)));
      button.addEventListener('click', () => {
        if (!eligible(address)) return;
        cancelPlacement();
        actions.aggression(mode, address);
        announce(`${aggressionLabel(mode)} requested for ${recipient}`);
      });
      policies.append(button);
    }
    menu.append(policies);
    heading('Order recipients');
    choice('All commanded bots', address.to === 'all', () => { address = { to: 'all' }; open = null; render(); });
    for (const row of rows) {
      if (row.human || row.captured || row.commander !== mySlot) continue;
      choice(row.label, selectedSlot === row.slot, () => {
        address = { to: 'slot', index: row.slot }; open = null; render();
      });
    }
    heading('Watch');
    for (const row of rows.filter(row => !row.captured)) choice(`${row.label} · ${row.human ? 'Human' : row.commander === mySlot ? 'Your bot' : 'Other player’s bot'}`, watched === row.slot, () => {
      actions.watch(row.slot); watched = row.slot; open = null; render();
    });
    heading('Commander assignments');
    for (const row of rows) {
      if (row.human || row.slot === mySlot) continue;
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
  who.addEventListener('click', () => { cancelPlacement(); open = open === 'who' ? null : 'who'; render(); });
  what.addEventListener('click', () => { cancelPlacement(); render(); });
  render();
  return {
    root,
    cancelPlacement,
    issueAt(x: number, y: number): boolean {
      cancelPlacement();
      render();
      return submit(kind, address, x, y);
    },
    tapAt(x: number, y: number): boolean {
      if (!armed) return false;
      cancelPlacement();
      render();
      submit(kind, address, x, y);
      return true;
    },
    update(next: readonly CommandRow[], slot: number, commanderSlot: number, nextAggressions: readonly SquadAggression[] = []) {
      if (root.hidden) cancelPlacement();
      if (mySlot !== commanderSlot) { cancelPlacement(); address = { to: 'all' }; drawn = ''; }
      mySlot = commanderSlot;
      const modesChanged = aggressions.join('|') !== nextAggressions.join('|');
      aggressions = [...nextAggressions];
      const key = commandKey(next);
      if (key !== drawn) {
        cancelPlacement();
        drawn = key;
        rows = next;
        render();
      }
      if (modesChanged) render();
      if (watched !== slot) {
        watched = slot;
        render();
      }
    },
  };
}

function aggressionLabel(mode: SquadAggression): string {
  return mode === 'hold-fire' ? 'Hold fire' : mode === 'defensive' ? 'Defensive' : 'Aggressive';
}
