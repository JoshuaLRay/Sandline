/**
 * The squad, six rows always (T-1.5.06, ADR-001).
 *
 * Never a growing list. The session is six slots from the moment it exists,
 * and a human joining takes over a bot's soldier rather than adding a seat. A
 * panel that showed "2 players" would teach everyone watching the wrong model
 * of the game — the one thing this milestone is demonstrating — so every row
 * exists whether a person or a bot is driving it, and a leave is a row
 * flipping back to "bot", not a row disappearing.
 *
 * Also the way OUT: the room code, a link to paste to the other player, and
 * Leave, which returns to the lobby. Rendered from `NetClient.roster`, which
 * is whatever the host last said (a `Roster` message on every change).
 */
import { MAX_SLOTS, type RosterEntry } from '@sandline/shared';
import { type Panel, createPanel } from './Panel.ts';

export interface SquadPanelOptions {
  onLeave: () => void;
  /** The link to hand the other player, or null on an in-page session. */
  link: () => string | null;
}

export interface SquadPanel extends Panel {
  update(roster: readonly RosterEntry[], mySlot: number, room: string, statusLine: string): void;
}

export function createSquadPanel(options: SquadPanelOptions): SquadPanel {
  const panel = createPanel('squad', 'Squad');

  const status = document.createElement('p');
  status.className = 'squad-status';

  const code = document.createElement('div');
  code.className = 'squad-code';
  const codeLabel = document.createElement('span');
  codeLabel.textContent = 'room';
  const codeValue = document.createElement('b');
  code.append(codeLabel, codeValue);

  const rows: { root: HTMLElement; who: HTMLElement; tag: HTMLElement }[] = [];
  const list = document.createElement('ol');
  list.className = 'squad-list';
  for (let i = 0; i < MAX_SLOTS; i++) {
    const li = document.createElement('li');
    const who = document.createElement('span');
    who.className = 'squad-who';
    const tag = document.createElement('span');
    tag.className = 'squad-tag';
    li.append(who, tag);
    list.append(li);
    rows.push({ root: li, who, tag });
  }

  const actions = document.createElement('div');
  actions.className = 'squad-actions';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'panel-reset';
  copy.textContent = 'Copy link';
  copy.addEventListener('click', () => {
    const link = options.link();
    if (link === null) return;
    const done = (): void => {
      copy.textContent = 'Copied';
      setTimeout(() => (copy.textContent = 'Copy link'), 1500);
    };
    // Clipboard access needs a secure context and a user gesture; this is a
    // click on an https page or localhost, so it normally has both. When it
    // does not, the link is put where it can be selected by hand.
    navigator.clipboard?.writeText(link).then(done, () => {
      window.prompt('Copy this link:', link);
    });
  });
  const leave = document.createElement('button');
  leave.type = 'button';
  leave.className = 'panel-reset squad-leave';
  leave.textContent = 'Leave';
  leave.addEventListener('click', options.onLeave);
  actions.append(copy, leave);

  panel.body.append(status, code, list, actions);

  return {
    ...panel,
    update(roster, mySlot, room, statusLine) {
      status.textContent = statusLine;
      code.hidden = room === '';
      codeValue.textContent = room;
      copy.hidden = options.link() === null;
      for (let i = 0; i < MAX_SLOTS; i++) {
        const row = rows[i];
        if (!row) continue;
        const entry = roster[i];
        const human = entry?.human ?? false;
        row.root.classList.toggle('human', human);
        row.root.classList.toggle('me', i === mySlot);
        row.who.textContent = human ? entry?.name || 'player' : 'bot';
        row.tag.textContent = i === mySlot ? 'you' : human ? 'human' : '';
      }
    },
  };
}
