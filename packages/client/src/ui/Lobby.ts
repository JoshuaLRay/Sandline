/**
 * The screen before the session (T-1.5.06).
 *
 * THE ONLY WAY IN. Until this existed, joining a host meant editing a URL:
 * `?host=ws://…` built a remote session and everything else built the in-page
 * one. That is developer tooling, and a gate that depends on a tester editing
 * a URL is a gate that gets run once, by the person who wrote it (PLAN.md §6A,
 * amendment). So the lobby owns both the host address and the room code, and a
 * query parameter, where present, PRE-FILLS a field rather than bypassing the
 * screen. Two entry points means only one of them gets tested.
 *
 * FOUR BUTTONS, ONE MESSAGE. "Host a room", quick-join and "Join a room" send the same
 * `Join` — with an empty code and with one — because the difference is one
 * field (T-1.5.04). "Practice here" is the in-page session the harness has
 * always been, kept because the published page must still work with no host
 * at all, and because the movement and weapon tuning panels only mean anything
 * against a session in this page.
 *
 * T-4.19 adds mission-scoped quick-join here; ready-up itself lives in RoomLobby.
 * Regions and class picks remain later work. This is still a QA harness that
 * needs two humans in one room. The roster it leads to is six rows always —
 * see `SquadPanel` — because a lobby that says "2 players" teaches everyone the
 * wrong model of the game (ADR-001).
 */
import { checkRoomInput, HostUrlError, parseHostUrl } from '../net/RemoteServer.ts';

export type LobbyChoice =
  | { kind: 'local' }
  | { kind: 'remote'; host: string; room: string; name: string; key: string; world: string; quick: boolean };

/**
 * The maps a new room can be built with (T-3.35 follow-up), as the Join asks
 * for them: the host builds the room on the chosen world, with its mission
 * where it has one and the host runs its AI (`HOST_AI=1`). Joining a room
 * takes whatever map it was made with.
 */
export const LOBBY_MAPS: readonly { world: string; label: string }[] = [
  { world: 'mission-01', label: 'Mission 01 — clear and hold the qalat' },
  { world: 'greybox-01', label: 'Grey box — mission layout fixture' },
  { world: 'range', label: 'Range — the QA range, no mission' },
  { world: 'kit-gallery', label: 'Kit gallery — every kit piece, walkable' },
];

export interface LobbyOptions {
  /** The host baked into the build (T-1.5.07); empty when there is none. */
  defaultHost: string;
  /** `?host=` from the URL, already validated; overrides the default. */
  presetHost: string | null;
  /** Why `?host=` could not be used, if it could not. Shown, not fatal. */
  presetHostError: string | null;
  /** `?room=` from the URL. */
  presetRoom: string;
  /** Last name used, from storage. */
  name: string;
  /** Last join key used, from storage. */
  key: string;
  pageProtocol: string;
  buildStamp: string;
  onChoose: (choice: LobbyChoice) => void;
}

export interface Lobby {
  readonly root: HTMLElement;
  /** Show the screen, optionally with a message about why (a refusal, a leave). */
  show(message?: { text: string; tone: 'info' | 'error' }): void;
  hide(): void;
  /** The host and name as currently typed, for the share link. */
  readonly host: string;
  readonly name: string;
}

const NAME_KEY = 'sandline.name';
const JOIN_KEY = 'sandline.joinKey';

/**
 * The join key is remembered in this browser so a player types it once. It is
 * never put in the URL or the share link: a link gets pasted into chats, and a
 * key in it would be a key for everyone the chat reaches.
 */
export function readStoredKey(): string {
  try {
    return localStorage.getItem(JOIN_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeKey(key: string): void {
  try {
    if (key === '') localStorage.removeItem(JOIN_KEY);
    else localStorage.setItem(JOIN_KEY, key);
  } catch {
    // Preference only.
  }
}

export function readStoredName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Preference only.
  }
}

function field(label: string, input: HTMLElement): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'lobby-field';
  const text = document.createElement('span');
  text.textContent = label;
  wrap.append(text, input);
  return wrap;
}

function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

export function createLobby(options: LobbyOptions): Lobby {
  const root = document.createElement('div');
  root.id = 'lobby';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-labelledby', 'lobby-title');

  const card = document.createElement('div');
  card.className = 'lobby-card';

  const title = document.createElement('h1');
  title.id = 'lobby-title';
  title.innerHTML = 'Sandline <span>M1.5</span>';
  const stamp = document.createElement('em');
  stamp.className = 'lobby-stamp';
  stamp.textContent = options.buildStamp;
  title.append(stamp);

  const message = document.createElement('p');
  message.className = 'lobby-message';
  message.hidden = true;

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 32;
  nameInput.setAttribute('autocomplete', 'nickname');
  nameInput.placeholder = 'what the roster calls you';
  nameInput.value = options.name;

  const hostInput = document.createElement('input');
  hostInput.type = 'text';
  hostInput.spellcheck = false;
  hostInput.autocomplete = 'off';
  hostInput.placeholder = options.defaultHost || 'wss://… or ws://192.168.x.x:8080';
  hostInput.value = options.presetHost ?? options.defaultHost;

  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.spellcheck = false;
  keyInput.autocomplete = 'off';
  keyInput.maxLength = 128;
  keyInput.placeholder = 'if the host needs one';
  keyInput.value = options.key;

  const mapInput = document.createElement('select');
  for (const m of LOBBY_MAPS) {
    const option = document.createElement('option');
    option.value = m.world;
    option.textContent = m.label;
    mapInput.append(option);
  }

  const roomInput = document.createElement('input');
  roomInput.type = 'text';
  roomInput.spellcheck = false;
  roomInput.autocomplete = 'off';
  roomInput.autocapitalize = 'characters';
  roomInput.maxLength = 8;
  roomInput.placeholder = 'room (4) or campaign (8) code';
  roomInput.value = options.presetRoom;
  roomInput.className = 'lobby-code';

  const say = (text: string, tone: 'info' | 'error'): void => {
    message.hidden = text === '';
    message.textContent = text;
    message.dataset['tone'] = tone;
  };

  const readName = (): string | null => {
    const name = nameInput.value.trim().slice(0, 32);
    if (name === '') {
      say('give the roster a name first', 'error');
      nameInput.focus();
      return null;
    }
    storeName(name);
    return name;
  };

  const readHost = (): string | null => {
    try {
      return parseHostUrl(hostInput.value, options.pageProtocol);
    } catch (e) {
      if (!(e instanceof HostUrlError)) throw e;
      say(hostInput.value.trim() === '' ? 'no host to join — type one, or practise here' : e.message, 'error');
      hostInput.focus();
      return null;
    }
  };

  const remote = (wantRoom: boolean, quick = false): void => {
    const name = readName();
    if (name === null) return;
    const host = readHost();
    if (host === null) return;
    let room = '';
    if (wantRoom) {
      const checked = checkRoomInput(roomInput.value);
      if (checked.error !== null || checked.room === '') {
        say(checked.error ?? 'type the code the other player gave you', 'error');
        roomInput.focus();
        return;
      }
      room = checked.room;
      roomInput.value = room;
    }
    const key = keyInput.value.trim();
    storeKey(key);
    say('', 'info');
    options.onChoose({ kind: 'remote', host, room, name, key, world: room === '' ? mapInput.value : '', quick });
  };

  const hostButton = button('Host a room', 'lobby-primary', () => remote(false));
  const quickButton = button('Quick join this mission', 'lobby-secondary', () => remote(false, true));
  const joinButton = button('Join', 'lobby-primary', () => remote(true));
  const localButton = button('Practise here — you and a bot, no host', 'lobby-secondary', () => {
    say('', 'info');
    options.onChoose({ kind: 'local' });
  });

  // Enter in the code field joins; Enter anywhere else hosts. Nobody should
  // have to reach for the mouse after pasting a code.
  roomInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') remote(true);
  });
  for (const input of [nameInput, hostInput, keyInput]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') remote(roomInput.value.trim() !== '');
    });
  }

  const joinRow = document.createElement('div');
  joinRow.className = 'lobby-join';
  joinRow.append(field('Room code', roomInput), joinButton);

  const help = document.createElement('p');
  help.className = 'lobby-help';
  help.textContent =
    'Host a room and share its link, or quick-join another room on the selected mission. ' +
    'Six slots, always: whoever is not a person is a bot.';

  const gap = document.createElement('p');
  gap.className = 'lobby-help lobby-gap';
  gap.textContent =
    options.defaultHost === ''
      ? 'This build has no default host. Run `pnpm host` and point the field at it, or practise here.'
      : `Default host: ${options.defaultHost}`;

  card.append(
    title,
    message,
    field('Name', nameInput),
    field('Host', hostInput),
    field('Key', keyInput),
    field('Mission', mapInput),
    hostButton,
    quickButton,
    joinRow,
    help,
    localButton,
    gap,
  );
  root.append(card);

  if (options.presetHostError !== null) {
    say(`Could not use ?host= — ${options.presetHostError}`, 'error');
  }

  return {
    root,
    show(msg) {
      root.hidden = false;
      if (msg) say(msg.text, msg.tone);
      // The field most likely to need attention: a pasted link has the code
      // filled in and wants Join; an empty page wants a name.
      if (nameInput.value.trim() === '') nameInput.focus();
      else if (roomInput.value.trim() !== '') joinButton.focus();
      else hostButton.focus();
    },
    hide() {
      root.hidden = true;
    },
    get host() {
      return hostInput.value.trim();
    },
    get name() {
      return nameInput.value.trim();
    },
  };
}
