/**
 * The briefing on the page (T-5.03): a card over the game when a mission
 * starts — the objectives, the routes, the squad and the first keys — gone
 * on its button, Enter, or Space. The session runs on underneath (a shared
 * room cannot wait for one reader); the squad starts on its spawn line.
 */
import type { Briefing } from './briefingModel.ts';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  parent?.append(node);
  return node;
}

/** Show a briefing; resolves when it is dismissed. */
export function showBriefing(parent: HTMLElement, briefing: Briefing, onClose: () => void = () => undefined): HTMLElement {
  const root = el('section', 'briefing', parent);
  root.id = 'briefing';
  root.setAttribute('role', 'dialog');
  const card = el('div', 'briefing-card', root);
  el('p', 'briefing-kicker', card).textContent = 'Briefing';
  el('h2', 'briefing-title', card).textContent = briefing.title;
  const list = el('ol', 'briefing-objectives', card);
  for (const o of briefing.objectives) el('li', '', list).textContent = o;
  if (briefing.routes) el('p', 'briefing-routes', card).textContent = briefing.routes;
  if (briefing.squad) el('p', 'briefing-squad', card).textContent = `Your squad: ${briefing.squad}. Bots fill every empty slot and take your orders.`;
  const keys = el('dl', 'briefing-keys', card);
  for (const k of briefing.controls) {
    el('dt', '', keys).textContent = k.keys;
    el('dd', '', keys).textContent = k.action;
  }
  const go = el('button', 'lobby-primary briefing-go', card);
  go.type = 'button';
  go.textContent = 'Move out';
  const close = (): void => {
    window.removeEventListener('keydown', onKey, true);
    root.remove();
    onClose();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  go.addEventListener('click', close);
  window.addEventListener('keydown', onKey, true);
  return root;
}
