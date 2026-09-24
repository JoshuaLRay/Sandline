/**
 * The blocking asset load screen (T-4.06). It is deliberately tiny: one phase
 * label, one progress bar and byte/asset counts from PackLoader. The browser
 * remains on this screen until the chosen level pack is present.
 */
import type { PackProgress } from '../assets/packs.ts';

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}

export class LoadScreen {
  readonly root: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private readonly bar: HTMLProgressElement;
  private readonly status: HTMLParagraphElement;

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.id = 'load-screen';
    this.root.hidden = true;
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');

    const card = document.createElement('div');
    card.className = 'load-card';
    this.title = document.createElement('h1');
    this.title.textContent = 'Loading';
    this.bar = document.createElement('progress');
    this.bar.max = 1;
    this.bar.value = 0;
    this.status = document.createElement('p');
    card.append(this.title, this.bar, this.status);
    this.root.append(card);
    parent.append(this.root);
  }

  show(title: string): void {
    this.title.textContent = title;
    this.bar.value = 0;
    this.status.textContent = 'Preparing…';
    this.root.hidden = false;
  }

  update(progress: PackProgress): void {
    this.bar.max = Math.max(1, progress.totalBytes);
    this.bar.value = progress.loadedBytes;
    this.status.textContent =
      `${progress.loadedAssets}/${progress.totalAssets} assets · ${bytes(progress.loadedBytes)} / ${bytes(progress.totalBytes)}`;
  }

  hide(): void {
    this.root.hidden = true;
  }
}
