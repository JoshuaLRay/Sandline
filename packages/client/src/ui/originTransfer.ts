/**
 * Explicit, offline browser-origin transfer for the GitHub Pages -> Cloudflare Pages move.
 * localStorage cannot cross origins: nothing is transmitted, shared in a URL, or logged.
 * The exported JSON is a bearer-credential backup; users must guard and delete it.
 */
import { identityKey, type TokenStorage } from '../net/identity.ts';
import './originTransfer.css';

const FORMAT = 'sandline-site-transfer-v1';
const MAX_FILE_BYTES = 8192;
const IDENTITY = /^v1\.[A-Za-z0-9_-]{22}\.[0-9]{1,12}\.[0-9]{1,12}\.[A-Za-z0-9_-]{43}$/;
const VOICE_ID = /^[a-f0-9]{32}$/;
const VOICE_TOKEN = /^[a-f0-9]{64}$/;

interface VoiceCredential { id: string; token: string }
interface Transfer {
  format: typeof FORMAT;
  host: string;
  identity?: string;
  voice?: VoiceCredential;
}

function canonicalHost(host: string): string {
  const h = host.trim().replace(/\/+$/, '');
  if (!/^wss:\/\/[a-zA-Z0-9.-]+(?::[0-9]+)?$/.test(h)) throw new Error('A configured HTTPS multiplayer host is required');
  return h;
}
function voiceKey(host: string): string {
  return `sandline.voice-submission.${host.replace(/^ws/, 'http')}`;
}
function parseVoice(raw: unknown): VoiceCredential | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.id === 'string' && VOICE_ID.test(record.id) &&
      typeof record.token === 'string' && VOICE_TOKEN.test(record.token)) {
    return { id: record.id, token: record.token };
  }
  return null;
}

/** Export only tokens scoped to the configured game host, never join keys or unrelated storage. */
export function exportSiteTransfer(host: string, storage: Pick<TokenStorage, 'getItem'>): string | null {
  const selectedHost = canonicalHost(host);
  const identityRaw = storage.getItem(identityKey(selectedHost));
  const identity = identityRaw && IDENTITY.test(identityRaw) ? identityRaw : undefined;
  const voiceRaw = storage.getItem(voiceKey(selectedHost));
  let voice: VoiceCredential | null = null;
  if (voiceRaw) {
    try { voice = parseVoice(JSON.parse(voiceRaw) as unknown); } catch { /* Invalid stale value is excluded. */ }
  }
  if (!identity && !voice) return null;
  const bundle: Transfer = { format: FORMAT, host: selectedHost,
    ...(identity ? { identity } : {}),
    ...(voice ? { voice } : {}) };
  return JSON.stringify(bundle, null, 2);
}

/** Strictly validate the entire backup before writing any of its secrets to this origin. */
export function importSiteTransfer(host: string, storage: Pick<TokenStorage, 'setItem'>, json: string): { identity: boolean; voice: boolean } {
  const selectedHost = canonicalHost(host);
  if (json.length > MAX_FILE_BYTES) throw new Error('Transfer file is too large');
  let parsed: unknown;
  try { parsed = JSON.parse(json) as unknown; } catch { throw new Error('Invalid transfer JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid transfer format');
  const record = parsed as Record<string, unknown>;
  if (record.format !== FORMAT || record.host !== selectedHost) {
    throw new Error('Transfer file is for another game host or format');
  }
  const identity = record.identity;
  if (identity !== undefined && (typeof identity !== 'string' || !IDENTITY.test(identity))) {
    throw new Error('Invalid saved player identity');
  }
  const voice = record.voice === undefined ? null : parseVoice(record.voice);
  if (record.voice !== undefined && !voice) throw new Error('Invalid saved contributor credential');
  if (!identity && !voice) throw new Error('Transfer file contains no supported credentials');
  if (typeof identity === 'string') storage.setItem(identityKey(selectedHost), identity);
  if (voice) storage.setItem(voiceKey(selectedHost), JSON.stringify(voice));
  return { identity: typeof identity === 'string', voice: voice !== null };
}

/** Route: ?transfer-data on both old and new public game sites. */
export function showOriginTransfer(parent: HTMLElement, host: string): void {
  const modal = document.createElement('section');
  modal.className = 'sandline-transfer';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Transfer saved Sandline data between websites');
  const panel = document.createElement('div');
  panel.className = 'sandline-transfer-panel';
  modal.append(panel);
  const heading = document.createElement('h1');
  heading.textContent = 'Transfer Sandline saved identity';
  const intro = document.createElement('p');
  intro.textContent = 'Moving from the old game site? Download a private transfer file on the old site, then import it on the new site. This preserves this browser’s player identity and any unfinished voice-submission access for the same multiplayer host.';
  const caution = document.createElement('p');
  caution.className = 'sandline-transfer-warning';
  caution.textContent = 'Sensitive: this file can grant access to your campaign identity and private voice submissions. Keep it private, do not send it to anyone, and delete it after importing. No data is uploaded by this transfer tool.';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const exportButton = document.createElement('button');
  exportButton.textContent = 'Download private transfer file';
  exportButton.type = 'button';
  exportButton.onclick = () => {
    try {
      const data = exportSiteTransfer(host, localStorage);
      if (!data) { status.textContent = 'No saved player identity or voice submission access was found on this site.'; return; }
      const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'sandline-private-transfer.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      status.textContent = 'Private file prepared. Keep it safe until you have imported it on the new website.';
    } catch {
      status.textContent = 'Browser storage could not be read. Check privacy settings and try again.';
    }
  };
  const importer = document.createElement('input');
  importer.type = 'file';
  importer.accept = 'application/json,.json';
  importer.setAttribute('aria-label', 'Import private Sandline transfer JSON file');
  importer.onchange = async () => {
    const file = importer.files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('Transfer file is too large');
      const raw = await file.text();
      const result = importSiteTransfer(host, localStorage, raw);
      status.textContent = `Imported ${result.identity ? 'player identity' : ''}${result.identity && result.voice ? ' and ' : ''}${result.voice ? 'voice submission access' : ''}. Return to the lobby and connect to the same Fly host.`;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Could not import transfer file';
    } finally {
      importer.value = '';
    }
  };
  const close = document.createElement('button');
  close.textContent = 'Return to game';
  close.type = 'button';
  close.onclick = () => { const url = new URL(location.href); url.searchParams.delete('transfer-data'); location.assign(url.href); };
  const label = document.createElement('label');
  label.textContent = 'Import the transfer file on the new website';
  label.append(importer);
  panel.append(heading, intro, caution, exportButton, label, status, close);
  parent.append(modal);
}
