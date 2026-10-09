import type { SupplyItem } from '@sandline/shared';
import type { MobileSupplyChoiceModel } from './mobileSupplyModel.ts';
import { supplyItemKey, supplyItemName } from './supplyModel.ts';
import './mobileSupplyChoice.css';

/** One explicit bot and one item. The host alone advances collection and changes stock. */
export function createMobileSupplyChoice(parent: HTMLElement, actions: {
  select: (slot: number, cacheId: string, item: SupplyItem | null) => void;
  onOpen: () => void;
}) {
  const root = document.createElement('aside');
  root.className = 'mobile-supply'; root.hidden = true;
  root.setAttribute('aria-label', 'Commander supplies');
  const trigger = document.createElement('button');
  trigger.type = 'button'; trigger.className = 'mobile-supply-trigger'; trigger.textContent = 'Supplies';
  trigger.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div');
  panel.className = 'mobile-supply-panel'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Choose bot and supply cache');
  const heading = document.createElement('h2'); heading.textContent = 'Command supplies';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'mobile-supply-close'; close.textContent = 'Close';
  const header = document.createElement('div'); header.className = 'mobile-supply-header'; header.append(heading, close);
  const recipient = document.createElement('select'); recipient.setAttribute('aria-label', 'Supply recipient');
  const recipientLabel = document.createElement('label'); recipientLabel.textContent = 'Bot'; recipientLabel.append(recipient);
  const cache = document.createElement('select'); cache.setAttribute('aria-label', 'Supply cache');
  const cacheLabel = document.createElement('label'); cacheLabel.textContent = 'Cache'; cacheLabel.append(cache);
  const selectors = document.createElement('div'); selectors.className = 'mobile-supply-selectors'; selectors.append(recipientLabel, cacheLabel);
  const availability = document.createElement('p'); availability.className = 'mobile-supply-availability';
  const rows = document.createElement('div'); rows.className = 'mobile-supply-rows';
  const progress = document.createElement('progress'); progress.max = 100; progress.setAttribute('aria-label', 'Host collection progress');
  const status = document.createElement('p'); status.className = 'mobile-supply-status'; status.setAttribute('role', 'status');
  const others = document.createElement('p'); others.className = 'mobile-supply-others';
  const cancelButton = document.createElement('button'); cancelButton.type = 'button'; cancelButton.className = 'mobile-supply-cancel'; cancelButton.textContent = 'Cancel collection';
  const help = document.createElement('p'); help.className = 'mobile-supply-help'; help.textContent = 'Choose one item. Your bot travels to the cache; stock and collection progress come from the host.';
  panel.append(header, progress, status, others, selectors, availability, rows, cancelButton, help);
  root.append(trigger, panel); parent.append(root);
  let current: MobileSupplyChoiceModel | null = null;
  let selectedSlot = -1;
  let selectedRecipientLabel = '';
  let selectedCache = '';
  let requested: { slot: number; cacheId: string; itemKey: string; accepted: boolean } | null = null;
  let confirmationTimer: ReturnType<typeof setTimeout> | undefined;
  let cancelledKey = '';
  let cancelledSession: object | null = null;
  let endedStatus = '';
  let rowsKey = ''; let recipientKey = ''; let cacheKey = '';

  const choice = () => current?.recipients.find(row => row.slot === selectedSlot)?.caches.find(row => row.id === selectedCache);
  const cancelRequest = (): void => {
    clearTimeout(confirmationTimer); confirmationTimer = undefined;
    const own = choice()?.own;
    const target = requested ?? (own ? { slot: own.slot, cacheId: own.cacheId } : null);
    if (target) {
      const key = `${target.slot}:${target.cacheId}`;
      if (cancelledKey !== key) actions.select(target.slot, target.cacheId, null);
      cancelledKey = key;
      cancelledSession = current?.sessionKey ?? null;
    }
    requested = null;
  };
  const cancel = (): void => {
    cancelRequest(); panel.hidden = true; trigger.setAttribute('aria-expanded', 'false');
  };
  function render(): void {
    if (!current) return;
    const nextRecipientKey = JSON.stringify(current.recipients.map(row => [row.slot, row.label, row.confirmed]));
    if (nextRecipientKey !== recipientKey) {
      recipientKey = nextRecipientKey;
      recipient.replaceChildren(new Option('Choose one commanded bot', '-1'));
      for (const row of current.recipients) recipient.add(new Option(row.label, String(row.slot)));
    }
    recipient.value = String(selectedSlot);
    recipient.disabled = current.recipients.length === 0;
    const nextCacheKey = JSON.stringify(current.caches.map(row => [row.id, row.empty]));
    if (nextCacheKey !== cacheKey) {
      cacheKey = nextCacheKey; cache.replaceChildren();
      for (const row of current.caches) cache.add(new Option(`${row.id}${row.empty ? ' · Empty' : ''}`, row.id));
    }
    cache.value = selectedCache; cache.disabled = current.caches.length === 0;
    const selected = current.recipients.find(row => row.slot === selectedSlot);
    const model = choice() ?? current.caches.find(row => row.id === selectedCache);
    availability.textContent = current.caches.length === 0 ? 'Supply caches unavailable' : current.recipients.length === 0 ? 'No eligible commanded bots' : !selected ? 'Choose one commanded bot to collect supplies' : !selected.confirmed ? 'Waiting for confirmed bot inventory' : model?.empty ? 'Empty supply cache' : '';
    availability.hidden = availability.textContent === '';
    const active = model?.own;
    const nextRowsKey = JSON.stringify([selectedSlot, selectedCache, selected?.confirmed, model?.choices, active && supplyItemKey(active.item)]);
    if (nextRowsKey !== rowsKey) {
      rowsKey = nextRowsKey;
      const focusKey = root.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset['item'] : undefined;
      rows.replaceChildren();
      for (const row of model?.choices ?? []) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'mobile-supply-row';
        const key = supplyItemKey(row.item); button.dataset['item'] = key;
        button.disabled = !selected?.confirmed || row.status !== 'transferred';
        button.setAttribute('aria-pressed', String(active !== null && active !== undefined && supplyItemKey(active.item) === key));
        const name = document.createElement('span'); name.textContent = row.name;
        const stock = document.createElement('span'); stock.textContent = row.stock;
        const detail = document.createElement('small'); detail.textContent = row.detail;
        button.append(name, stock, detail);
        button.addEventListener('click', () => {
          const latest = choice()?.choices.find(candidate => supplyItemKey(candidate.item) === key);
          if (!current?.recipients.find(candidate => candidate.slot === selectedSlot)?.confirmed || latest?.status !== 'transferred') return;
          if (requested?.slot === selectedSlot && requested.cacheId === selectedCache && requested.itemKey === key) return;
          const confirmed = choice()?.own;
          if (confirmed && supplyItemKey(confirmed.item) === key && cancelledKey !== `${confirmed.slot}:${confirmed.cacheId}`) return;
          cancelledKey = ''; cancelledSession = null; endedStatus = '';
          clearTimeout(confirmationTimer);
          requested = { slot: selectedSlot, cacheId: selectedCache, itemKey: key, accepted: false };
          actions.select(selectedSlot, selectedCache, latest.item);
          // The wire has no rejection ID. Bound only an unconfirmed request, never host collection time.
          confirmationTimer = setTimeout(() => {
            if (!requested || requested.accepted) return;
            cancelRequest(); endedStatus = 'Collection not confirmed · request cancelled'; render();
          }, 5000);
          render();
        });
        rows.append(button);
        if (focusKey === key && !button.disabled) button.focus();
      }
    }
    progress.hidden = !active; progress.value = active?.percent ?? 0;
    status.textContent = active ? `${supplyItemName(active.item)} · ${active.percent > 0 ? `Collecting · ${active.percent}%` : 'Host accepted · waiting to collect'}${cancelledKey === `${active.slot}:${active.cacheId}` ? ' · Cancellation requested' : ''}` : requested ? 'Request sent · waiting for host' : endedStatus;
    status.hidden = status.textContent === '';
    others.textContent = (model?.others ?? []).map(use => `Slot ${use.slot + 1} · ${supplyItemName(use.item)} · ${use.percent > 0 ? `Collecting ${use.percent}%` : 'Host accepted · waiting to collect'}`).join(' / ');
    others.hidden = others.textContent === '';
    cancelButton.hidden = !requested && !active;
    cancelButton.disabled = Boolean(active && cancelledKey === `${active.slot}:${active.cacheId}`);
  }
  trigger.addEventListener('click', () => {
    if (!panel.hidden) cancel();
    else { actions.onOpen(); panel.hidden = false; trigger.setAttribute('aria-expanded', 'true'); render(); }
  });
  close.addEventListener('click', () => { cancel(); trigger.focus(); });
  cancelButton.addEventListener('click', () => { cancelRequest(); render(); });
  recipient.addEventListener('change', () => {
    cancelRequest(); selectedSlot = Number(recipient.value);
    selectedRecipientLabel = current?.recipients.find(row => row.slot === selectedSlot)?.label ?? '';
    endedStatus = ''; render();
  });
  cache.addEventListener('change', () => { cancelRequest(); selectedCache = cache.value; endedStatus = ''; render(); });
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { cancel(); trigger.focus(); } });
  const visibility = (): void => { if (document.hidden) cancel(); };
  addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', visibility);
  return {
    root, cancel,
    set(model: MobileSupplyChoiceModel | null): void {
      const previousOwn = choice()?.own;
      if (!model || (current && (model.sessionKey !== current.sessionKey || model.commanderSlot !== current.commanderSlot))) {
        cancel(); selectedSlot = -1; selectedRecipientLabel = ''; selectedCache = ''; rowsKey = ''; recipientKey = ''; cacheKey = ''; endedStatus = '';
      }
      if (model && selectedSlot >= 0 && !model.recipients.some(row => row.slot === selectedSlot && row.confirmed && row.label === selectedRecipientLabel)) {
        cancelRequest(); selectedSlot = -1;
      }
      if (model && selectedCache && !model.caches.some(row => row.id === selectedCache)) { cancelRequest(); selectedCache = ''; }
      if (model && requested && !requested.accepted) {
        const nextChoice = model.recipients.find(row => row.slot === requested!.slot)?.caches.find(row => row.id === requested!.cacheId);
        if (!nextChoice?.own && nextChoice?.choices.find(row => supplyItemKey(row.item) === requested!.itemKey)?.status !== 'transferred') {
          cancelRequest(); endedStatus = 'Choice unavailable · request cancelled';
        }
      }
      current = model; root.hidden = model === null;
      if (!model) return;
      if (cancelledSession !== model.sessionKey) { cancelledKey = ''; cancelledSession = null; }
      if (!selectedCache) selectedCache = model.caches[0]?.id ?? '';
      const own = choice()?.own;
      if (previousOwn && !own && selectedSlot === previousOwn.slot && selectedCache === previousOwn.cacheId) endedStatus = 'Host ended collection';
      if (requested && own?.slot === requested.slot && own.cacheId === requested.cacheId && supplyItemKey(own.item) === requested.itemKey) {
        requested.accepted = true; clearTimeout(confirmationTimer); confirmationTimer = undefined;
      } else if (requested?.accepted) { requested = null; clearTimeout(confirmationTimer); confirmationTimer = undefined; }
      render();
    },
    dispose(): void {
      cancel(); removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', visibility); root.remove();
    },
  };
}
