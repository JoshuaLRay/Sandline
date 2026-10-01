/**
 * After a mission (U-090): the debrief, and what the room's host may play next.
 *
 * `runChoiceModel` is pure: the host's `RunOffer`, who we are and the campaign data in; the lines to show and the
 * buttons to offer out. The host sees one button per choice (a campaign run of the newest mission, or a replay of a
 * beaten one) with its briefing under it; everyone else sees who is choosing. `createRunChoice` is the DOM.
 */
import { CAMPAIGN, type CampaignDef, type Message, type RunKind, campaignMission } from '@sandline/shared';

export interface RunChoiceOption {
  run: RunKind;
  mission: string;
  label: string;
  briefing: readonly string[];
}

export interface RunChoiceModel {
  /** "Mission 01 — … — complete" or "— failed". */
  heading: string;
  /** The mission's authored debrief, when it was won. */
  debrief: readonly string[];
  /** Whether we may choose. */
  host: boolean;
  /** For everyone else: whom we are waiting on. */
  waiting: string;
  options: readonly RunChoiceOption[];
}

type Offer = Extract<Message, { kind: 'RunOffer' }>;

const title = (mission: string, campaign: CampaignDef): string => campaignMission(mission, campaign)?.title ?? mission;

export function runChoiceModel(
  offer: Offer | null,
  mySlot: number,
  hostName: string,
  campaign: CampaignDef = CAMPAIGN,
): RunChoiceModel | null {
  if (!offer) return null;
  const played = campaignMission(offer.mission, campaign);
  const options: RunChoiceOption[] = [];
  if (offer.campaign !== '') {
    // After a failure the newest mission is the one just lost: say it is a retry, not a new mission.
    const retry = offer.result === 'failed' && offer.campaign === offer.mission;
    options.push({
      run: 'campaign',
      mission: offer.campaign,
      label: `${retry ? 'Retry' : 'Campaign'} — ${title(offer.campaign, campaign)}`,
      briefing: campaignMission(offer.campaign, campaign)?.briefing ?? [],
    });
  }
  for (const mission of offer.replay) {
    options.push({ run: 'replay', mission, label: `Replay — ${title(mission, campaign)}`, briefing: campaignMission(mission, campaign)?.briefing ?? [] });
  }
  const host = mySlot === offer.host;
  return {
    heading: `${title(offer.mission, campaign)} — ${offer.result}`,
    debrief: offer.result === 'complete' ? (played?.debrief ?? []) : [],
    host,
    waiting: host ? '' : `${hostName === '' ? 'The host' : hostName} is choosing what to play next`,
    options,
  };
}

export interface RunChoice {
  readonly root: HTMLElement;
  /** Show the model (null hides it); `choose` is called with the host's pick. Redraws only when the model changes. */
  set(model: RunChoiceModel | null, choose: (run: RunKind, mission: string) => void): void;
}

export function createRunChoice(parent: HTMLElement): RunChoice {
  const root = document.createElement('div');
  root.className = 'scoreboard-runs hidden';
  parent.append(root);
  let shown = '';
  return {
    root,
    set(model, choose) {
      const key = model ? JSON.stringify(model) : '';
      if (key === shown) return;
      shown = key;
      root.replaceChildren();
      root.classList.toggle('hidden', model === null);
      if (!model) return;
      const heading = document.createElement('div');
      heading.className = 'scoreboard-runs-heading';
      heading.textContent = model.heading;
      root.append(heading);
      for (const line of model.debrief) {
        const p = document.createElement('p');
        p.className = 'scoreboard-runs-debrief';
        p.textContent = line;
        root.append(p);
      }
      if (!model.host) {
        const wait = document.createElement('div');
        wait.className = 'scoreboard-runs-waiting';
        wait.textContent = model.waiting;
        root.append(wait);
        return;
      }
      for (const option of model.options) {
        const wrap = document.createElement('div');
        wrap.className = 'scoreboard-runs-option';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = option.label;
        button.addEventListener('click', () => choose(option.run, option.mission));
        wrap.append(button);
        for (const line of option.briefing) {
          const p = document.createElement('p');
          p.className = 'scoreboard-runs-briefing';
          p.textContent = line;
          wrap.append(p);
        }
        root.append(wrap);
      }
    },
  };
}
