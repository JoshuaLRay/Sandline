/**
 * The sound board (T-2.45, `?sounds`): every committed sound and each of its
 * variants, played in place, beside a picture of its waveform and the
 * numbers `gen:audio` measured, and below them every processed voice line
 * (T-2.48). It is how the owner listens and reports (ADR-017: Claude cannot
 * hear what it makes).
 */
import type { SoundsConfig } from '@sandline/shared';
import { type RendersManifest, type VoiceRendersManifest, soundBoardRows, voiceBoard, waveformColumns, wavSamples } from './soundBoardModel.ts';

export interface SoundBoardOptions {
  sounds: SoundsConfig;
  /** Fetches a committed file under `audio/`. */
  fetchBytes: (file: string) => Promise<ArrayBuffer>;
  /** Plays a sound's variant; the engine unlocks on the click that calls this. */
  play: (id: string, variant: number) => void;
  /** Plays a committed file under `audio/` as it is: a voice line (T-2.48). */
  playFile: (file: string) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  parent?.append(node);
  return node;
}

function drawWaveform(canvas: HTMLCanvasElement, samples: Float32Array): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(240, 180, 41, 0.9)';
  const mid = height / 2;
  waveformColumns(samples, width).forEach((col, x) => {
    const top = mid - col.max * mid;
    const bottom = mid - col.min * mid;
    ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
  });
}

export function createSoundBoard(parent: HTMLElement, options: SoundBoardOptions): HTMLElement {
  const root = el('section', 'sound-board', parent);
  root.id = 'sound-board';
  const close = el('button', 'sound-board-close', root);
  close.type = 'button';
  close.textContent = '×';
  close.title = 'Close the sound board';
  close.addEventListener('click', () => root.remove());
  const head = el('h2', 'sound-board-title', root);
  head.textContent = 'Sound board';
  const note = el('p', 'sound-board-note', root);
  note.textContent = 'Every committed sound. Click a variant to hear it; the numbers are what gen:audio measured.';
  const list = el('div', 'sound-board-list', root);

  void options
    .fetchBytes('renders.json')
    .then((bytes) => JSON.parse(new TextDecoder().decode(bytes)) as RendersManifest)
    .catch(() => null)
    .then((manifest) => {
      for (const row of soundBoardRows(options.sounds, manifest)) {
        const block = el('div', 'sound-board-row', list);
        const title = el('div', 'sound-board-id', block);
        title.textContent = `${row.id}  ·  ${row.cls}`;
        for (const v of row.variants) {
          const line = el('div', 'sound-board-variant', block);
          const play = el('button', 'sound-board-play', line);
          play.type = 'button';
          play.textContent = `▶ ${v.variant + 1}`;
          play.disabled = !v.rendered;
          play.addEventListener('click', () => options.play(row.id, v.variant));
          const canvas = el('canvas', 'sound-board-wave', line);
          canvas.width = 240;
          canvas.height = 36;
          const numbers = el('span', 'sound-board-numbers', line);
          numbers.textContent = v.numbers;
          if (v.rendered) void options.fetchBytes(v.file).then((bytes) => drawWaveform(canvas, wavSamples(bytes))).catch(() => undefined);
        }
      }
    });
  // T-2.48: the voice lines, or why there are none yet.
  const voiceHead = el('h3', 'sound-board-title', root);
  voiceHead.textContent = 'Voice lines';
  const voiceNote = el('p', 'sound-board-note', root);
  const voiceList = el('div', 'sound-board-list', root);
  void options
    .fetchBytes('voice/renders.json')
    .then((bytes) => JSON.parse(new TextDecoder().decode(bytes)) as VoiceRendersManifest)
    .catch(() => null)
    .then((manifest) => {
      const board = voiceBoard(manifest);
      voiceNote.textContent = board.summary;
      for (const row of board.rows) {
        const block = el('div', 'sound-board-row', voiceList);
        el('div', 'sound-board-id', block).textContent = row.key;
        for (const v of row.variants) {
          const line = el('div', 'sound-board-variant', block);
          const play = el('button', 'sound-board-play', line);
          play.type = 'button';
          play.textContent = `▶ ${v.variant + 1}`;
          play.addEventListener('click', () => options.playFile(v.file));
          const canvas = el('canvas', 'sound-board-wave', line);
          canvas.width = 240;
          canvas.height = 36;
          el('span', 'sound-board-numbers', line).textContent = v.numbers;
          void options.fetchBytes(v.file).then((bytes) => drawWaveform(canvas, wavSamples(bytes))).catch(() => undefined);
        }
      }
    });
  return root;
}
