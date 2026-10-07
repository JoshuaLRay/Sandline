import { VOICE_CONSENT_TEXT, VOICE_RECORDING_LINES, type VoiceContributorSubmission, type VoiceRecordingLine, type VoiceSavedClip } from '@sandline/shared';
import './voiceSubmission.css';

interface Take {
  id: string; type: string; bytes: number; saved: boolean; blob?: Blob; url?: string; error?: string;
}
interface Credential { id: string; token: string }

function node<K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, content?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (content) el.textContent = content;
  parent.append(el);
  return el;
}

/** A contributor can submit and revisit individual takes without joining a game. */
export function showVoiceSubmission(parent: HTMLElement, host: string): void {
  const api = host ? host.replace(/^ws/, 'http').replace(/\/$/, '') : '';
  const storageKey = `sandline.voice-submission.${api}`;
  const takes = new Map<string, Take[]>();
  const counts = new Map<string, HTMLElement>();
  let credential: Credential | null = null;
  let selected: VoiceRecordingLine | null = null;
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let capture: 'idle' | 'requesting' | 'recording' | 'stopping' = 'idle';
  let uploading = false;
  let closed = false;
  let playbackVersion = 0;

  const root = node('div', parent);
  root.className = 'voice-submit';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Contribute your voice to Sandline');
  const card = node('main', root);
  const header = node('header', card);
  node('p', header, 'SANDLINE / VOICE CONTRIBUTIONS').className = 'voice-eyebrow';
  node('h1', header, 'Record a voice for Sandline');
  node('p', header, 'Choose a line, record a take, then tap Submit. Every submitted recording is saved immediately.');
  const close = node('button', header, 'Back to game');
  close.type = 'button';
  if (api) {
    const review = node('a', header, 'Owner: review saved recordings');
    review.href = `${api}/voice-review`;
    review.target = '_blank';
    review.rel = 'noopener noreferrer';
  }
  const form = node('section', card);
  const name = node('input', form);
  name.placeholder = 'Your name or nickname';
  name.maxLength = 40;
  name.setAttribute('aria-label', 'Your name or nickname');
  const invite = node('input', form);
  invite.placeholder = 'Invitation code from the game owner';
  invite.type = 'password';
  invite.setAttribute('aria-label', 'Invitation code');
  const consent = node('label', form);
  const check = node('input', consent);
  check.type = 'checkbox';
  consent.append(document.createTextNode(` ${VOICE_CONSENT_TEXT}`));
  const start = node('button', form, 'Agree and start');
  const status = node('p', card);
  status.className = 'voice-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const list = node('section', card);
  list.className = 'voice-lines';
  list.hidden = true;
  const contributor = node('h2', list);
  node('p', list, 'Counts show recordings saved for you. Each line includes its delivery direction.');
  const detail = node('section', card);
  detail.className = 'voice-detail';
  detail.hidden = true;
  const back = node('button', detail, 'All lines');
  const title = node('h2', detail);
  const quote = node('blockquote', detail);
  const direction = node('p', detail);
  direction.className = 'voice-direction';
  const controls = node('div', detail);
  controls.className = 'voice-controls';
  const record = node('button', controls, 'Record');
  record.className = 'voice-record';
  const submit = node('button', controls, 'Submit');
  submit.className = 'voice-send';
  const ready = node('p', detail);
  ready.className = 'voice-ready';
  const player = node('audio', detail);
  player.className = 'voice-player';
  player.controls = true;
  player.hidden = true;
  node('h3', detail, 'Recordings for this line');
  const recordings = node('ol', detail);
  recordings.className = 'voice-takes';
  recordings.setAttribute('aria-label', 'Recordings for this line');

  const pending = (): number => [...takes.values()].flat().filter((take) => !take.saved).length;
  const stopPlayback = (): void => { playbackVersion += 1; player.pause(); };
  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const response = await fetch(`${api}${path}`, { ...init, cache: 'no-store',
      headers: { ...(credential ? { 'x-submission-token': credential.token } : {}), ...init.headers },
    });
    if (!response.ok) {
      const data = await response.json() as { error?: string };
      throw new Error(data.error ?? 'Could not save the recording. Please try again.');
    }
    return response;
  };
  const updateCounts = (): void => {
    for (const line of VOICE_RECORDING_LINES) {
      const entries = takes.get(line.id) ?? [];
      const saved = entries.filter((take) => take.saved).length;
      const unsaved = entries.length - saved;
      counts.get(line.id)!.textContent = `${saved} saved${unsaved ? ` · ${unsaved} not submitted` : ''}`;
    }
  };
  const play = async (take: Take): Promise<void> => {
    if (capture !== 'idle' || !credential || closed) return;
    if (take.url && player.src === take.url && !player.paused) { stopPlayback(); return; }
    stopPlayback();
    const version = playbackVersion;
    try {
      if (!take.url) {
        const response = await request(`/voice-submissions/${credential.id}/clips/${take.id}`);
        const blob = await response.blob();
        if (closed) return;
        if (!take.url) take.url = URL.createObjectURL(blob);
      }
      if (version !== playbackVersion || capture !== 'idle' || closed) return;
      player.src = take.url;
      player.hidden = false;
      await player.play();
    } catch (e) {
      if (!closed && version === playbackVersion) status.textContent = `Could not play this recording: ${(e as Error).message}`;
    }
  };
  player.onplay = () => { if (capture !== 'idle' || closed) player.pause(); };
  const redraw = (): void => {
    updateCounts();
    const capturing = capture !== 'idle';
    close.disabled = uploading;
    back.disabled = capturing || uploading;
    record.disabled = capture === 'requesting' || capture === 'stopping' || uploading;
    record.textContent = capture === 'recording' ? 'Stop' : capture === 'requesting' ? 'Opening microphone…' : capture === 'stopping' ? 'Stopping…' : 'Record';
    record.classList.toggle('is-recording', capture === 'recording');
    record.setAttribute('aria-pressed', String(capture === 'recording'));
    player.controls = !capturing;
    player.hidden = capturing || !player.getAttribute('src');
    const entries = selected ? takes.get(selected.id) ?? [] : [];
    const unsaved = entries.filter((take) => !take.saved).length;
    submit.disabled = capturing || uploading || unsaved === 0;
    submit.textContent = uploading ? 'Submitting…' : 'Submit';
    ready.textContent = capturing ? 'Listening is disabled while recording.' : unsaved ? `${unsaved} recording${unsaved === 1 ? '' : 's'} ready to submit.` : 'Record a take, then tap Submit to save it.';
    recordings.replaceChildren();
    if (!entries.length) node('li', recordings, 'No recordings yet.').className = 'voice-empty';
    entries.forEach((take, index) => {
      const row = node('li', recordings);
      const button = node('button', row);
      button.className = 'voice-play';
      button.disabled = capturing;
      button.setAttribute('aria-label', `Listen to recording ${index + 1}`);
      node('span', button, `▶  Recording ${index + 1}`).className = 'voice-take-name';
      node('span', button, `${take.type.split('/')[1]} · ${Math.ceil(take.bytes / 1024)} KB`).className = 'voice-take-info';
      node('span', button, take.saved ? 'Saved' : take.error ? 'Save failed · tap Submit to retry' : 'Not submitted').className = take.saved ? 'voice-saved' : 'voice-unsaved';
      button.onclick = () => { void play(take); };
    });
  };
  const openLine = (line: VoiceRecordingLine): void => {
    stopPlayback();
    player.removeAttribute('src');
    player.load();
    selected = line;
    root.classList.add('is-detail');
    list.hidden = true;
    detail.hidden = false;
    title.textContent = `${line.section.replaceAll('-', ' ')} · ${line.style}`;
    quote.textContent = `“${line.text}”`;
    direction.textContent = `(${line.direction})`;
    redraw();
    back.focus();
  };
  for (const section of new Set(VOICE_RECORDING_LINES.map((line) => line.section))) {
    const group = node('section', list);
    node('h3', group, section.replaceAll('-', ' '));
    for (const line of VOICE_RECORDING_LINES.filter((line) => line.section === section)) {
      const button = node('button', group);
      button.className = 'voice-line';
      button.dataset['line'] = line.id;
      node('span', button, `“${line.text}”`).className = 'voice-line-text';
      node('span', button, `(${line.style})`).className = 'voice-line-style';
      counts.set(line.id, node('span', button, '0 saved'));
      button.onclick = () => openLine(line);
    }
  }
  back.onclick = () => {
    stopPlayback();
    root.classList.remove('is-detail');
    detail.hidden = true;
    list.hidden = false;
    updateCounts();
    list.querySelector<HTMLButtonElement>(`[data-line="${selected!.id}"]`)!.focus();
  };
  const beforeUnload = (event: BeforeUnloadEvent): void => {
    if (pending() || capture !== 'idle' || uploading) { event.preventDefault(); event.returnValue = ''; }
  };
  window.addEventListener('beforeunload', beforeUnload);
  close.onclick = () => {
    if ((pending() || capture !== 'idle') && !window.confirm('Some recordings have not been submitted. Leave and discard them?')) return;
    closed = true;
    stopPlayback();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    stream?.getTracks().forEach((track) => track.stop());
    player.removeAttribute('src');
    player.load();
    for (const take of [...takes.values()].flat()) if (take.url) URL.revokeObjectURL(take.url);
    window.removeEventListener('beforeunload', beforeUnload);
    root.remove();
    history.replaceState(null, '', location.pathname);
  };

  const showLines = (submission: VoiceContributorSubmission): void => {
    if (closed) return;
    takes.clear();
    for (const clip of submission.clips) {
      if (!clip.line || !VOICE_RECORDING_LINES.some((line) => line.id === clip.line)) continue;
      const entries = takes.get(clip.line) ?? [];
      entries.push({ id: clip.pass, bytes: clip.bytes, type: clip.type, saved: true });
      takes.set(clip.line, entries);
    }
    form.hidden = true;
    list.hidden = false;
    contributor.textContent = `Lines for ${submission.name}`;
    status.textContent = 'Choose a line. Submitted recordings are saved and available here when you return on this browser.';
    redraw();
  };
  const restore = async (): Promise<void> => {
    start.disabled = true;
    status.textContent = 'Loading your saved recordings…';
    try {
      const response = await fetch(`${api}/voice-submissions/${credential!.id}`, { cache: 'no-store', headers: { 'x-submission-token': credential!.token } });
      if (response.status === 404) {
        credential = null;
        try { localStorage.removeItem(storageKey); } catch { /* Storage is optional. */ }
        start.textContent = 'Agree and start';
        status.textContent = 'Your previous submission is unavailable. Enter your details to start again.';
        return;
      }
      if (!response.ok) throw new Error('Could not load your recordings. Tap Retry to try again.');
      showLines(await response.json() as VoiceContributorSubmission);
    } catch (e) {
      start.textContent = 'Retry loading recordings';
      status.textContent = (e as Error).message;
    } finally { start.disabled = false; }
  };
  start.onclick = async () => {
    if (credential) { await restore(); return; }
    if (!api) { status.textContent = 'Voice submissions are unavailable on this build.'; return; }
    if (!check.checked || !name.value.trim() || !invite.value) { status.textContent = 'Enter your name and invitation code, then accept the terms.'; return; }
    start.disabled = true;
    try {
      const response = await request('/voice-submissions', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.value.trim(), invite: invite.value, consent: VOICE_CONSENT_TEXT, agree: true }),
      });
      const data = await response.json() as Credential;
      credential = { id: data.id, token: data.token };
      try { localStorage.setItem(storageKey, JSON.stringify(credential)); } catch { /* Recording still works without persistent browser storage. */ }
      invite.value = '';
      showLines({ id: data.id, name: name.value.trim(), agreedAt: '', complete: false, clips: [] });
    } catch (e) { status.textContent = (e as Error).message; }
    finally { start.disabled = false; }
  };
  record.onclick = async () => {
    if (capture === 'recording' && recorder) {
      capture = 'stopping';
      recorder.stop();
      redraw();
      return;
    }
    if (capture !== 'idle' || uploading || !selected) return;
    const line = selected;
    capture = 'requesting';
    stopPlayback();
    redraw();
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Microphone recording is unavailable. Use a supported browser over HTTPS.');
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (closed) { microphone.getTracks().forEach((track) => track.stop()); return; }
      stream = microphone;
      const mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mime) throw new Error('This browser cannot record a supported format.');
      const chunks: Blob[] = [];
      const current = new MediaRecorder(microphone, { mimeType: mime });
      let failed = false;
      recorder = current;
      current.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      current.onerror = () => {
        failed = true;
        status.textContent = 'Recording failed. Please record this take again.';
        if (current.state !== 'inactive') current.stop();
      };
      current.onstop = () => {
        microphone.getTracks().forEach((track) => track.stop());
        recorder = null;
        stream = null;
        capture = 'idle';
        if (closed) return;
        const blob = new Blob(chunks, { type: mime });
        if (!failed && blob.size >= 1000) {
          const entries = takes.get(line.id) ?? [];
          entries.push({ id: `take-${crypto.randomUUID().replaceAll('-', '')}`, blob, url: URL.createObjectURL(blob), type: mime, bytes: blob.size, saved: false });
          takes.set(line.id, entries);
          status.textContent = 'Recording ready. Tap Submit to save it, or listen first.';
        } else if (!failed) status.textContent = 'Recording was too short. Record a longer take.';
        redraw();
      };
      current.start();
      capture = 'recording';
      status.textContent = 'Recording… Tap Stop when you have finished this take.';
    } catch (e) {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      recorder = null;
      capture = 'idle';
      status.textContent = (e as Error).message;
    }
    if (!closed) redraw();
  };
  submit.onclick = async () => {
    if (capture !== 'idle' || uploading || !selected || !credential) return;
    const line = selected;
    const entries = takes.get(line.id) ?? [];
    const drafts = entries.filter((take) => !take.saved);
    if (!drafts.length) return;
    uploading = true;
    redraw();
    status.textContent = 'Submitting recording…';
    try {
      for (const take of drafts) {
        const response = await request(`/voice-submissions/${credential.id}/lines/${line.id}/${take.id.slice(5)}`, {
          method: 'PUT', headers: { 'content-type': take.type }, body: take.blob!,
        });
        const data = await response.json() as { clip: VoiceSavedClip };
        if (data.clip.pass !== take.id || data.clip.line !== line.id) throw new Error('Could not confirm this recording was saved. Tap Submit to retry.');
        take.saved = true;
        delete take.error;
      }
      status.textContent = `${drafts.length} recording${drafts.length === 1 ? '' : 's'} saved for “${line.text}”. You can record another take or choose another line.`;
    } catch (e) {
      const failed = drafts.find((take) => !take.saved);
      if (failed) failed.error = (e as Error).message;
      status.textContent = `Recording not submitted: ${(e as Error).message} Your take is still here. Tap Submit to retry.`;
    } finally { uploading = false; if (!closed) redraw(); }
  };

  try {
    const raw = localStorage.getItem(storageKey);
    const saved = raw ? JSON.parse(raw) as Credential : null;
    if (saved && /^[a-f0-9]{32}$/.test(saved.id) && /^[a-f0-9]{64}$/.test(saved.token)) credential = saved;
  } catch { /* Private browsing or disabled storage does not prevent contributions. */ }
  if (credential && api) { void restore(); }
}
