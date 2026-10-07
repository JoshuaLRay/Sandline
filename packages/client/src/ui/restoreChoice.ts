import { CAMPAIGN, RESTORE_MAP_CHANGED_MESSAGE, campaignMission, type CampaignDef, type Message, type RestoreChoice, type RunKind } from '@sandline/shared';
import type { RunChoiceOption } from './runChoice.ts';
import './restoreChoice.css';

export interface RestoreChoiceModel {
  message: string;
  host: boolean;
  waiting: string;
  inventory: string;
  restartAllowed: boolean;
  options: readonly RunChoiceOption[];
}

/** Shared by the desktop and touch dialog; all authority comes from the host. */
export function restoreChoiceModel(
  choice: RestoreChoice | null,
  offer: Extract<Message, { kind: 'RunOffer' }> | null,
  mySlot: number,
  hostName: string,
  campaign: CampaignDef = CAMPAIGN,
): RestoreChoiceModel | null {
  if (!choice) return null;
  const options: RunChoiceOption[] = [];
  const option = (run: RunKind, mission: string): RunChoiceOption => ({
    run, mission,
    label: `${run === 'campaign' ? 'Campaign' : 'Replay'} — ${campaignMission(mission, campaign)?.title ?? mission}`,
    briefing: campaignMission(mission, campaign)?.briefing ?? [],
  });
  // Match the current decision's host and mission: a stale offer cannot supply choices after a host change.
  if (offer?.host === choice.host && offer.mission === choice.mission) {
    if (offer.campaign) options.push(option('campaign', offer.campaign));
    for (const mission of offer.replay) options.push(option('replay', mission));
  }
  const host = mySlot === choice.host;
  return {
    message: RESTORE_MAP_CHANGED_MESSAGE,
    host,
    waiting: host ? '' : `${hostName || 'The host'} is choosing how to continue`,
    inventory: choice.restart === 'legacy'
      ? 'This older save has no mission-start snapshot. Restart uses pre-mission carry-over or class inventory.'
      : choice.restart === 'prisoner-placement'
        ? 'Restart is unavailable until this map has approved holding positions for carried prisoners. Their pool is preserved; choose another mission or leave this room.'
        : 'Restart uses the original mission-start inventory.',
    restartAllowed: choice.restart !== 'prisoner-placement',
    options: choice.restart === 'prisoner-placement' ? options.filter((option) => option.mission !== choice.mission) : options,
  };
}

export function createRestoreChoice(parent: HTMLElement): {
  root: HTMLElement;
  set(model: RestoreChoiceModel | null, restart: () => void, choose: (run: RunKind, mission: string) => void, leave: () => void): void;
} {
  const root = document.createElement('div');
  root.className = 'restore-choice';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Mission map changed');
  parent.append(root);
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...root.querySelectorAll<HTMLElement>('button:enabled, summary')]
      .filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  let shown = '';
  return {
    root,
    set(model, restart, choose, leave) {
      const key = model ? JSON.stringify(model) : '';
      if (key === shown) return;
      shown = key;
      root.replaceChildren();
      root.hidden = model === null;
      if (!model) return;
      const panel = document.createElement('div');
      panel.className = 'restore-choice-panel';
      root.append(panel);
      const heading = document.createElement('h2');
      heading.textContent = model.message;
      panel.append(heading);
      const detail = document.createElement('p');
      detail.textContent = model.inventory;
      panel.append(detail);
      const leaveButton = document.createElement('button');
      leaveButton.type = 'button';
      leaveButton.textContent = 'Leave room';
      leaveButton.addEventListener('click', leave);
      if (!model.host) {
        const waiting = document.createElement('p');
        waiting.textContent = model.waiting;
        panel.append(waiting);
        panel.append(leaveButton);
        leaveButton.focus();
        return;
      }
      const restartButton = document.createElement('button');
      restartButton.type = 'button';
      restartButton.textContent = 'Restart mission';
      restartButton.disabled = !model.restartAllowed;
      restartButton.addEventListener('click', restart);
      panel.append(restartButton);
      const select = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Mission select';
      select.append(summary);
      for (const option of model.options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = option.label;
        button.addEventListener('click', () => choose(option.run, option.mission));
        select.append(button);
        for (const line of option.briefing) {
          const p = document.createElement('p');
          p.textContent = line;
          select.append(p);
        }
      }
      if (model.options.length === 0) {
        const empty = document.createElement('p');
        empty.textContent = 'No other missions are available yet.';
        select.append(empty);
      }
      panel.append(select);
      panel.append(leaveButton);
      if (restartButton.disabled) summary.focus();
      else restartButton.focus();
    },
  };
}
