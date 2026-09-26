/**
 * The player's HUD on the page (T-4.25): the vitals, the magazine and the
 * pouch, the stance, the objective, the six squad rows, the compass, the hit
 * marker and the damage direction. Built once, and each frame given a
 * `HudFrame` that `hudModel.ts` computed from replicated state; this file
 * only puts those words and numbers into elements, touching the DOM when a
 * value changes and never otherwise.
 *
 * The QA readouts it replaces stay behind H and N (`main.ts`).
 */
import { MAX_SLOTS } from '@sandline/shared';
import { MARKER_COLOURS } from '../OrderMarkers.ts';
import type { AmmoView, CompassView, DamageDirectionView, SquadRow, Stance, VitalsView } from './hudModel.ts';

export interface HudFrame {
  vitals: VitalsView;
  ammo: AmmoView;
  stance: Stance;
  /** The mission's line, '' with none. */
  objective: string;
  squad: readonly SquadRow[];
  compass: CompassView;
  /** 0..1: the hit marker's opacity this frame. */
  hitMarker: number;
  damage: readonly DamageDirectionView[];
}

export interface PlayerHud {
  readonly root: HTMLElement;
  update(frame: HudFrame): void;
  setVisible(on: boolean): void;
}

const STANCE_TEXT: Readonly<Record<Stance, string>> = {
  standing: 'STANDING',
  crouched: 'CROUCHED',
  prone: 'PRONE',
  vaulting: 'VAULT',
  airborne: 'AIRBORNE',
  downed: 'DOWNED',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  parent?.append(node);
  return node;
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function setData(node: HTMLElement, key: string, value: string): void {
  if (node.dataset[key] !== value) node.dataset[key] = value;
}

const colour = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

/** How many hit-direction arcs are kept on the page; more hits than this reuse the oldest. */
const DAMAGE_ARCS = 6;

export function createHud(parent: HTMLElement): PlayerHud {
  const root = el('div', 'phud', parent);
  root.id = 'player-hud';
  root.setAttribute('aria-hidden', 'true');

  // -- Top: the compass, then the objective under it. --
  const compass = el('div', 'phud-compass', root);
  const strip = el('div', 'phud-compass-strip', compass);
  const heading = el('div', 'phud-compass-heading', compass);
  const tickNodes = new Map<string, HTMLElement>();
  const markerNodes = new Map<string, HTMLElement>();
  const objective = el('div', 'phud-objective', root);

  // -- Bottom left: vitals and stance. --
  const vitals = el('div', 'phud-vitals', root);
  const bar = el('div', 'phud-bar', vitals);
  const fill = el('div', 'phud-bar-fill', bar);
  const vitalsLabel = el('div', 'phud-vitals-label', vitals);
  const stance = el('div', 'phud-stance', vitals);

  // -- Bottom right: the weapon, the magazine and the pouch. --
  const weapon = el('div', 'phud-weapon', root);
  const weaponName = el('div', 'phud-weapon-name', weapon);
  const magazine = el('div', 'phud-magazine', weapon);
  const reload = el('div', 'phud-reload', weapon);
  const reloadFill = el('div', 'phud-reload-fill', reload);
  const pouch = el('div', 'phud-pouch', weapon);
  const pouchRows: { root: HTMLElement; name: HTMLElement; count: HTMLElement }[] = [];

  // -- Left: the squad. --
  const squad = el('ol', 'phud-squad', root);
  const squadRowNodes: { root: HTMLElement; name: HTMLElement; order: HTMLElement }[] = [];
  for (let i = 0; i < MAX_SLOTS; i += 1) {
    const row = el('li', 'phud-squad-row', squad);
    const name = el('span', 'phud-squad-name', row);
    const order = el('span', 'phud-squad-order', row);
    squadRowNodes.push({ root: row, name, order });
  }

  // -- Centre: the hit marker and the damage arcs around the reticle. --
  const centre = el('div', 'phud-centre', root);
  const hit = el('div', 'phud-hit', centre);
  for (const arm of ['tl', 'tr', 'bl', 'br']) el('span', `phud-hit-arm ${arm}`, hit);
  const arcs: HTMLElement[] = [];
  for (let i = 0; i < DAMAGE_ARCS; i += 1) arcs.push(el('div', 'phud-damage', centre));

  let shown = true;

  function updateCompass(view: CompassView): void {
    setText(heading, `${Math.round(view.heading) % 360}°`);
    const seenTicks = new Set<string>();
    for (const tick of view.ticks) {
      seenTicks.add(tick.text);
      let node = tickNodes.get(tick.text);
      if (!node) {
        node = el('span', `phud-tick${tick.major ? ' major' : ''}`, strip);
        node.textContent = tick.text;
        tickNodes.set(tick.text, node);
      }
      node.style.left = `${(50 + tick.offset * 50).toFixed(2)}%`;
    }
    for (const [text, node] of tickNodes) {
      if (!seenTicks.has(text)) {
        node.remove();
        tickNodes.delete(text);
      }
    }
    const seenMarkers = new Set<string>();
    for (const marker of view.markers) {
      seenMarkers.add(marker.key);
      let node = markerNodes.get(marker.key);
      if (!node) {
        node = el('span', 'phud-marker', strip);
        node.style.setProperty('--marker', colour(MARKER_COLOURS[marker.kind]));
        markerNodes.set(marker.key, node);
      }
      node.style.left = `${(50 + marker.offset * 50).toFixed(2)}%`;
      setText(node, `${marker.label} ${Math.round(marker.distanceM)}m`);
      setData(node, 'kind', marker.kind);
    }
    for (const [key, node] of markerNodes) {
      if (!seenMarkers.has(key)) {
        node.remove();
        markerNodes.delete(key);
      }
    }
  }

  function updatePouch(rows: AmmoView['pouch']): void {
    while (pouchRows.length < rows.length) {
      const row = el('div', 'phud-pouch-row', pouch);
      const name = el('span', 'phud-pouch-name', row);
      const count = el('span', 'phud-pouch-count', row);
      pouchRows.push({ root: row, name, count });
    }
    while (pouchRows.length > rows.length) pouchRows.pop()?.root.remove();
    rows.forEach((row, i) => {
      const node = pouchRows[i]!;
      setText(node.name, row.name);
      setText(node.count, `×${row.count}`);
      setData(node.root, 'selected', row.selected ? 'yes' : 'no');
      setData(node.root, 'empty', row.count === 0 ? 'yes' : 'no');
    });
  }

  return {
    root,
    update(frame) {
      if (!shown) return;
      // Vitals.
      fill.style.width = `${(frame.vitals.fraction * 100).toFixed(1)}%`;
      setData(vitals, 'tone', frame.vitals.tone);
      setText(vitalsLabel, frame.vitals.label);
      setText(stance, STANCE_TEXT[frame.stance]);
      // The weapon.
      setText(weaponName, frame.ammo.weapon);
      setText(magazine, frame.ammo.magazine);
      setData(weapon, 'ammo', frame.ammo.empty ? 'empty' : frame.ammo.low ? 'low' : 'ok');
      setData(weapon, 'reloading', frame.ammo.reloadFraction > 0 ? 'yes' : 'no');
      reloadFill.style.width = `${(frame.ammo.reloadFraction * 100).toFixed(1)}%`;
      updatePouch(frame.ammo.pouch);
      // The objective.
      setText(objective, frame.objective);
      setData(objective, 'shown', frame.objective.length > 0 ? 'yes' : 'no');
      // The squad.
      frame.squad.forEach((row, i) => {
        const node = squadRowNodes[i];
        if (!node) return;
        setText(node.name, `${row.slot + 1}  ${row.label}`);
        setText(node.order, row.order);
        setData(node.root, 'state', row.state);
        setData(node.root, 'you', row.you ? 'yes' : 'no');
        setData(node.root, 'human', row.human ? 'yes' : 'no');
      });
      updateCompass(frame.compass);
      // The centre.
      hit.style.opacity = frame.hitMarker.toFixed(3);
      arcs.forEach((arc, i) => {
        const d = frame.damage[frame.damage.length - 1 - i];
        if (!d) {
          if (arc.style.opacity !== '0') arc.style.opacity = '0';
          return;
        }
        arc.style.opacity = d.opacity.toFixed(3);
        arc.style.transform = `rotate(${d.angleDeg.toFixed(1)}deg)`;
      });
    },
    setVisible(on) {
      shown = on;
      root.classList.toggle('hidden', !on);
    },
  };
}
