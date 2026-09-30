/**
 * U-025: the squad's command, as the pause menu shows it — six rows, and for
 * each bot the human in command of it and the humans it could be handed to.
 * Pure: the roster and your slot in, rows out; the menu draws them and sends
 * a change as an `AssignCommander`, which the host checks and answers with
 * the roster it keeps.
 */
import { MAX_SLOTS, type RosterEntry, classById } from '@sandline/shared';

export interface CommandOption {
  slot: number;
  label: string;
}

export interface CommandRow {
  slot: number;
  /** "3  Bot · MM", "1  kai (you)". */
  label: string;
  human: boolean;
  /** The slot of the human in command of this bot; -1 for a human, or a bot nobody commands yet. */
  commander: number;
  /** Every seated human, you marked: who this bot can be handed to. Empty for a human's row. */
  options: CommandOption[];
  /** U-026: a bot you command: you may take control of it. */
  switchable: boolean;
  /** U-064: a prisoner: greyed out and not to be chosen; the label says why. */
  captured: boolean;
}

/** A seated human as the squad names them: their name, "(you)" for you. */
export function humanLabel(entry: RosterEntry | undefined, slot: number, mySlot: number): string {
  const name = entry?.name || `Player ${slot + 1}`;
  return slot === mySlot ? `${name} (you)` : name;
}

export function commandRows(roster: readonly RosterEntry[], mySlot: number): CommandRow[] {
  const humans: CommandOption[] = [];
  for (let slot = 0; slot < MAX_SLOTS; slot += 1) {
    if (roster[slot]?.human) humans.push({ slot, label: humanLabel(roster[slot], slot, mySlot) });
  }
  const rows: CommandRow[] = [];
  for (let slot = 0; slot < MAX_SLOTS; slot += 1) {
    const entry = roster[slot];
    const human = entry?.human ?? false;
    const short = classById(entry?.classId ?? '')?.short ?? '';
    const who = human ? humanLabel(entry, slot, mySlot) : 'Bot';
    const captured = entry?.captured === true;
    rows.push({
      slot,
      label: `${slot + 1}  ${who}${short ? ` · ${short}` : ''}${captured ? ' · Captured — rescue them to play' : ''}`,
      human,
      commander: human ? -1 : (entry?.commander ?? -1),
      options: human ? [] : humans,
      switchable: !human && !captured && mySlot >= 0 && entry?.commander === mySlot,
      captured,
    });
  }
  return rows;
}

/** A key that changes exactly when the rows would draw differently: the menu redraws on it, not every frame. */
export function commandKey(rows: readonly CommandRow[]): string {
  return rows.map((r) => `${r.label}|${r.commander}|${r.switchable}|${r.captured}|${r.options.map((o) => `${o.slot}:${o.label}`).join(',')}`).join(';');
}

/** The spectator's relationship to the watched soldier, from the host roster. */
export function watchedStatus(rows: readonly CommandRow[], watched: number, mySlot: number): string {
  const row = rows.find((entry) => entry.slot === watched);
  if (!row) return '';
  if (watched === mySlot && !row.human) return 'Your bot · AI-controlled while spectating';
  if (row.human) return watched === mySlot ? 'Human-controlled seat · AI while spectating' : 'Human controlled · watch only';
  if (row.commander === mySlot) return 'Under your command · orders and takeover available';
  return 'Under another player’s command · takeover on PC transfers command';
}
