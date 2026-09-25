import { MAX_SLOTS, type Message, type RosterEntry } from '@sandline/shared';

export interface RoomLobbyOptions {
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onLeave: () => void;
  link: () => string | null;
}

export interface RoomLobby {
  readonly root: HTMLElement;
  update(roster: readonly RosterEntry[], mySlot: number, room: string, state: Extract<Message, { kind: 'RoomState' }> | null): void;
  hide(): void;
}

/** T-4.19: the party is the room itself; this is the screen between JoinAck and mission start. */
export function createRoomLobby(options: RoomLobbyOptions): RoomLobby {
  const root = document.createElement('div');
  root.id = 'room-lobby';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-labelledby', 'room-lobby-title');

  const card = document.createElement('div');
  card.className = 'room-lobby-card';
  const title = document.createElement('h2');
  title.id = 'room-lobby-title';
  title.textContent = 'Squad room';
  const meta = document.createElement('p');
  meta.className = 'room-lobby-meta';

  const list = document.createElement('ol');
  list.className = 'room-lobby-list';
  const rows: { root: HTMLLIElement; who: HTMLSpanElement; className: HTMLSpanElement; state: HTMLSpanElement }[] = [];
  for (let i = 0; i < MAX_SLOTS; i += 1) {
    const li = document.createElement('li');
    const number = document.createElement('span');
    number.textContent = String(i + 1);
    const who = document.createElement('span');
    const className = document.createElement('span');
    className.className = 'room-lobby-class';
    const state = document.createElement('span');
    state.className = 'room-lobby-state';
    li.append(number, who, className, state);
    list.append(li);
    rows.push({ root: li, who, className, state });
  }

  const actions = document.createElement('div');
  actions.className = 'room-lobby-actions';
  const ready = document.createElement('button');
  ready.type = 'button';
  ready.className = 'lobby-primary';
  let readyValue = false;
  ready.addEventListener('click', () => options.onReady(!readyValue));
  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'lobby-secondary';
  start.textContent = 'Start mission now';
  start.addEventListener('click', options.onStart);
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'lobby-secondary room-lobby-copy';
  copy.textContent = 'Copy invite link';
  copy.addEventListener('click', () => {
    const link = options.link();
    if (!link) return;
    void navigator.clipboard?.writeText(link).then(() => {
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy invite link'; }, 1200);
    });
  });
  const leave = document.createElement('button');
  leave.type = 'button';
  leave.className = 'lobby-secondary';
  leave.textContent = 'Leave room';
  leave.addEventListener('click', options.onLeave);
  actions.append(ready, start, copy, leave);
  card.append(title, meta, list, actions);
  root.append(card);

  return {
    root,
    update(roster, mySlot, room, state) {
      if (!state || state.started) {
        root.hidden = true;
        return;
      }
      root.hidden = false;
      meta.textContent = `room ${room} · mission ${state.world} · waiting for squad`;
      readyValue = state.ready[mySlot] ?? false;
      ready.textContent = readyValue ? 'Ready — click to unready' : 'Ready up';
      start.hidden = mySlot !== state.creator;
      for (let i = 0; i < MAX_SLOTS; i += 1) {
        const row = rows[i];
        if (!row) continue;
        const entry = roster[i];
        const human = entry?.human ?? false;
        row.root.classList.toggle('me', i === mySlot);
        row.who.textContent = human ? (entry?.name || 'player') : 'bot';
        row.className.textContent = human ? (state.classes[i] || 'class: pending T-4.27') : '';
        row.state.textContent = human ? (state.ready[i] ? 'ready' : i === state.creator ? 'creator' : 'not ready') : 'bot';
      }
    },
    hide() {
      root.hidden = true;
    },
  };
}
