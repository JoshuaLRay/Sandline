import { VOICES, VOICE_CONSENT_TEXT, passFile, passLines } from '@sandline/shared';
import './voiceSubmission.css';

const WORDS: Record<string, string> = {
  contact: 'Contact!', 'contact-front': 'Contact front!', 'contact-left': 'Contact left!', 'contact-right': 'Contact right!',
  'enemy-spotted': 'Enemy spotted!', 'machine-gun': 'Machine gun!', 'covering-fire': 'Covering fire!', suppressing: 'Suppressing!',
  'heads-down': 'Keep their heads down!', moving: 'Moving!', 'moving-up': 'Moving up!', 'on-me': 'On me!',
  'go-go-go': 'Go, go, go!', 'taking-cover': 'Taking cover!', 'get-down': 'Get down!', reloading: 'Reloading!',
  'changing-mag': 'Changing mag!', 'cover-me-reloading': 'Cover me, reloading!', 'frag-out': 'Frag out!',
  grenade: 'Grenade!', 'grenade-get-back': 'Grenade — get back!', 'im-hit': "I'm hit!", 'man-down': 'Man down!',
  'im-down': "I'm down!", 'need-help': 'I need help here!', 'pain-grunt': 'A short grunt as a round hits',
  'pain-breath': 'A sharp breath in', 'pain-groan': 'A groan', 'downed-cry': 'A cry when going down hurt',
  'dying-sigh': 'One long, fading breath out', 'got-you': "I've got you!", 'hang-on': 'Hang on!',
  'youre-up': "You're up!", 'enemy-down': 'Enemy down!', 'got-him': 'Got him!', 'target-down': 'Target down!',
  copy: 'Copy!', roger: 'Roger!', 'on-it': 'On it!', 'moving-to-position': 'Moving to position!',
  'holding-here': 'Holding here!', regrouping: 'Regrouping!', 'cant-get-there': "Negative, can't get there!",
  'compound-clear': 'Compound clear!', 'holding-objective': 'Holding the objective!', 'objective-secure': 'Objective secure!',
  'open-fire': 'Open fire!', 'there-they-are': 'There they are!', 'flank-them': 'Flank them!', 'push-forward': 'Push forward!',
};

const PASSES = VOICES.sections.flatMap((section) => (['normal', 'shout', 'hurt'] as const)
  .filter((style) => section.render.includes(style) && passLines(section, style).length > 0)
  .map((style) => ({ id: passFile(section.id, style), label: `${section.id} — ${style}`, lines: passLines(section, style) })));

function node<K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, content?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (content) el.textContent = content;
  parent.append(el);
  return el;
}

/** Separate entry from the lobby, so a friend can open the game link and record without joining a room. */
export function showVoiceSubmission(parent: HTMLElement, host: string): void {
  const root = node('div', parent);
  root.className = 'voice-submit';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Contribute your voice to Sandline');
  const card = node('main', root);
  node('h1', card, 'Record a voice for Sandline');
  node('p', card, 'Record one section at a time. Say each line three times, with a full second of silence between takes. Choose any sections you want to contribute.');
  const close = node('button', card, 'Back to game');
  close.type = 'button';
  close.onclick = () => { recorder?.stop(); root.remove(); history.replaceState(null, '', location.pathname); };
  const name = node('input', card);
  name.placeholder = 'Your name or nickname';
  name.maxLength = 40;
  name.setAttribute('aria-label', 'Your name or nickname');
  const invite = node('input', card);
  invite.placeholder = 'Invitation code from the game owner';
  invite.type = 'password';
  invite.setAttribute('aria-label', 'Invitation code');
  const consent = node('label', card);
  const check = node('input', consent);
  check.type = 'checkbox';
  consent.append(document.createTextNode(` ${VOICE_CONSENT_TEXT}`));
  const start = node('button', card, 'Agree and start');
  const status = node('p', card);
  status.setAttribute('role', 'status');
  const panel = node('section', card);
  panel.hidden = true;
  const select = node('select', panel);
  select.setAttribute('aria-label', 'Recording section');
  for (const pass of PASSES) {
    const option = node('option', select, pass.label);
    option.value = pass.id;
  }
  const script = node('ol', panel);
  const redraw = (): void => {
    script.replaceChildren();
    const pass = PASSES.find((p) => p.id === select.value)!;
    for (const line of pass.lines) node('li', script, `${WORDS[line] ?? line} (three times)`);
  };
  select.onchange = redraw;
  redraw();
  const record = node('button', panel, 'Start recording');
  const preview = node('audio', panel);
  preview.controls = true;
  preview.hidden = true;
  const upload = node('button', panel, 'Upload this section');
  upload.disabled = true;
  const finish = node('button', panel, 'Finish and send to owner');
  finish.disabled = true;
  const api = host ? host.replace(/^ws/, 'http').replace(/\/$/, '') : '';
  let id = '';
  let token = '';
  let recorder: MediaRecorder | null = null;
  let blob: Blob | null = null;
  let previewUrl = '';
  let recordedPass = '';
  const request = async (url: string, init: RequestInit): Promise<Record<string, unknown>> => {
    const res = await fetch(`${api}${url}`, init);
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) throw new Error(String(data['error'] ?? 'Upload failed'));
    return data;
  };
  start.onclick = async () => {
    if (!api) { status.textContent = 'Voice submissions are unavailable on this build.'; return; }
    if (!check.checked || !name.value.trim() || !invite.value) { status.textContent = 'Enter your name and invitation code, then accept the terms.'; return; }
    start.disabled = true;
    try {
      const data = await request('/voice-submissions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.value.trim(), invite: invite.value, consent: VOICE_CONSENT_TEXT, agree: true }) });
      id = String(data['id']); token = String(data['token']);
      invite.value = '';
      panel.hidden = false;
      status.textContent = 'Consent saved. Choose a section and record it.';
    } catch (e) { start.disabled = false; status.textContent = (e as Error).message; }
  };
  select.onchange = () => { redraw(); blob = null; upload.disabled = true; preview.hidden = true; };
  record.onclick = async () => {
    if (recorder) { recorder.stop(); record.textContent = 'Start recording'; return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m));
      if (!mime) { stream.getTracks().forEach((t) => t.stop()); throw new Error('This browser cannot record a supported format.'); }
      const chunks: Blob[] = [];
      const current = new MediaRecorder(stream, { mimeType: mime });
      recorder = current;
      recordedPass = select.value;
      select.disabled = true;
      upload.disabled = true;
      current.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      current.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        recorder = null;
        select.disabled = false;
        blob = new Blob(chunks, { type: mime });
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(blob);
        preview.src = previewUrl;
        preview.hidden = false;
        upload.disabled = blob.size < 1000;
        status.textContent = 'Listen to your recording, then upload it or record again.';
      };
      current.start();
      record.textContent = 'Stop recording';
      status.textContent = 'Recording. Say each line three times, leaving a second of silence between takes.';
    } catch (e) { status.textContent = (e as Error).message; }
  };
  upload.onclick = async () => {
    if (!blob) return;
    upload.disabled = true;
    try {
      await request(`/voice-submissions/${id}/${recordedPass}`, { method: 'PUT', headers: { 'content-type': blob.type, 'x-submission-token': token }, body: blob });
      finish.disabled = false;
      status.textContent = `${recordedPass} saved privately. Record another section, or finish.`;
      blob = null;
    } catch (e) { upload.disabled = false; status.textContent = (e as Error).message; }
  };
  finish.onclick = async () => {
    finish.disabled = true;
    try {
      await request(`/voice-submissions/${id}/finish`, { method: 'POST', headers: { 'x-submission-token': token } });
      panel.hidden = true;
      status.textContent = 'Thank you. Your recordings were sent to the owner for review; they are not in the game yet.';
    } catch (e) { finish.disabled = false; status.textContent = (e as Error).message; }
  };
}
