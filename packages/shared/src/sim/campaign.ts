/**
 * The campaign as data (U-088): the order missions are played in, and the text around each.
 *
 * `data/campaign.json` lists the season's missions, a straight line (design doc D3). Each names a registered mission
 * by its world id and carries a title, a briefing and a debrief. After a mission, complete or failed, the team leader
 * (the room's host, Q2) chooses between a **campaign run** of the newest mission the campaign has reached and a
 * **replay run** of any mission already beaten. Nothing here skips ahead: a failed campaign run's newest mission is
 * still the same one, so the choice after a failure is a retry or a replay (Q3).
 *
 * The helpers are pure over a campaign and the set of completed mission ids (the campaign file's
 * `completedMissions`). A mission that is complete but not in this campaign (the grey box, say) is ignored.
 *
 * To add a mission: register it in `campaignRegistry.ts` and add ONE entry to `campaign.json`.
 */
import RAW_CAMPAIGN from '../data/campaign.json' with { type: 'json' };
import { missionFor } from './mission.ts';

/** One mission's place in the campaign, and what the players read around it. */
export interface CampaignMission {
  /** The mission's world id. */
  mission: string;
  title: string;
  briefing: readonly string[];
  debrief: readonly string[];
}

export interface CampaignDef {
  id: string;
  missions: readonly CampaignMission[];
}

/** The kind of run: the newest mission, or one already beaten. */
export type RunKind = 'campaign' | 'replay';

class CampaignDataError extends Error {}

function lines(at: string, v: unknown): string[] {
  if (!Array.isArray(v) || v.length === 0) throw new CampaignDataError(`${at}: expected a non-empty list of lines`);
  return v.map((line, i) => {
    if (typeof line !== 'string' || line.trim() === '') throw new CampaignDataError(`${at}[${i}]: expected a non-empty line of text`);
    return line;
  });
}

/**
 * Parse a campaign. `known` says which mission ids exist (the committed ones by default); an unknown id, a repeat or
 * an empty text is refused, so a typo is caught when the file is loaded and not when a squad reaches it.
 */
export function parseCampaign(raw: unknown, known: (id: string) => boolean = (id) => missionFor(id) !== undefined): CampaignDef {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new CampaignDataError('campaign: expected an object');
  const row = raw as Record<string, unknown>;
  for (const k of Object.keys(row)) if (!['$comment', 'id', 'missions'].includes(k)) throw new CampaignDataError(`campaign: unknown key "${k}"`);
  if (typeof row['id'] !== 'string' || row['id'] === '') throw new CampaignDataError('campaign.id must be a non-empty string');
  const list = row['missions'];
  if (!Array.isArray(list) || list.length === 0) throw new CampaignDataError('campaign.missions must be a non-empty list');
  const seen = new Set<string>();
  const missions = list.map((entry, i): CampaignMission => {
    const at = `campaign.missions[${i}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new CampaignDataError(`${at}: expected an object`);
    const e = entry as Record<string, unknown>;
    for (const k of Object.keys(e)) if (!['mission', 'title', 'briefing', 'debrief'].includes(k)) throw new CampaignDataError(`${at}: unknown key "${k}"`);
    const mission = e['mission'];
    if (typeof mission !== 'string' || mission === '') throw new CampaignDataError(`${at}.mission must be a mission id`);
    if (!known(mission)) throw new CampaignDataError(`${at}.mission "${mission}" is not a registered mission`);
    if (seen.has(mission)) throw new CampaignDataError(`${at}.mission "${mission}" is listed twice`);
    seen.add(mission);
    const title = e['title'];
    if (typeof title !== 'string' || title.trim() === '') throw new CampaignDataError(`${at}.title must be a non-empty string`);
    return { mission, title, briefing: lines(`${at}.briefing`, e['briefing']), debrief: lines(`${at}.debrief`, e['debrief']) };
  });
  return { id: row['id'], missions };
}

/** The committed campaign, validated once at import. */
export const CAMPAIGN: CampaignDef = parseCampaign(RAW_CAMPAIGN);

/** The mission ids in play order. */
export function campaignOrder(campaign: CampaignDef = CAMPAIGN): string[] {
  return campaign.missions.map((m) => m.mission);
}

/** The newest mission the campaign has reached: the first not yet completed, or null once all are. */
export function newestMission(completed: Iterable<string>, campaign: CampaignDef = CAMPAIGN): string | null {
  const done = new Set(completed);
  return campaign.missions.find((m) => !done.has(m.mission))?.mission ?? null;
}

/** The missions already beaten, in play order. */
export function beatenMissions(completed: Iterable<string>, campaign: CampaignDef = CAMPAIGN): string[] {
  const done = new Set(completed);
  return campaign.missions.filter((m) => done.has(m.mission)).map((m) => m.mission);
}

/** What the leader may choose to play next: a campaign run of the newest mission (none once the season is done) or a replay of any beaten one. */
export interface RunOptions {
  campaign: string | null;
  replay: string[];
}

export function runOptions(completed: Iterable<string>, campaign: CampaignDef = CAMPAIGN): RunOptions {
  const done = [...completed];
  return { campaign: newestMission(done, campaign), replay: beatenMissions(done, campaign) };
}

/** Whether a run of this kind on this mission is one the leader may choose now. Never a mission beyond the newest. */
export function isOffered(kind: RunKind, mission: string, completed: Iterable<string>, campaign: CampaignDef = CAMPAIGN): boolean {
  const options = runOptions(completed, campaign);
  return kind === 'campaign' ? options.campaign === mission : options.replay.includes(mission);
}

export function campaignMission(mission: string, campaign: CampaignDef = CAMPAIGN): CampaignMission | undefined {
  return campaign.missions.find((m) => m.mission === mission);
}
