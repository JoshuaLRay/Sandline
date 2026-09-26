/**
 * Reading what people upload (T-2.48). The script asks for WAV and accepts
 * a phone's M4A or MP3. WAV is read here in any of its common shapes —
 * 8/16/24/32-bit integer or 32/64-bit float PCM, plain or extensible, any
 * rate, any number of channels (mixed to mono) — and resampled to 48 kHz.
 * Anything else goes through `ffmpeg` when it is installed, and is refused
 * by name, with what to do, when it is not.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { AUDIO_SAMPLE_RATE } from '@sandline/shared';
import { resample } from './analysis.ts';

export const RAW_EXTENSIONS = ['.wav', '.m4a', '.mp3', '.aac', '.ogg', '.opus', '.flac', '.webm', '.caf'] as const;

export class VoiceInputError extends Error {}

/** A WAV file's samples, mono, at its own rate. */
export function decodeWav(bytes: Uint8Array, name = 'recording'): { rate: number; samples: Float64Array } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new VoiceInputError(`${name}: not a WAV file`);
  let format = -1;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let data: { at: number; length: number } | null = null;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = tag(at);
    const size = v.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ') {
      format = v.getUint16(body, true);
      channels = v.getUint16(body + 2, true);
      rate = v.getUint32(body + 4, true);
      bits = v.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the sub-format GUID's first two bytes.
      if (format === 0xfffe && size >= 40) format = v.getUint16(body + 24, true);
    } else if (id === 'data') {
      data = { at: body, length: Math.min(size, bytes.length - body) };
    }
    at = body + size + (size & 1);
  }
  if (format < 0 || data === null) throw new VoiceInputError(`${name}: WAV has no ${format < 0 ? 'fmt' : 'data'} chunk`);
  if (channels < 1 || rate < 8000) throw new VoiceInputError(`${name}: WAV says ${channels} channels at ${rate} Hz`);
  const width = bits / 8;
  const read = (at: number): number => {
    if (format === 1) {
      if (bits === 8) return (v.getUint8(at) - 128) / 128;
      if (bits === 16) return v.getInt16(at, true) / 32768;
      if (bits === 24) return ((v.getUint8(at) | (v.getUint8(at + 1) << 8) | (v.getInt8(at + 2) << 16)) as number) / 8388608;
      if (bits === 32) return v.getInt32(at, true) / 2147483648;
    }
    if (format === 3) {
      if (bits === 32) return v.getFloat32(at, true);
      if (bits === 64) return v.getFloat64(at, true);
    }
    throw new VoiceInputError(`${name}: WAV format ${format} at ${bits} bits is not read — export 16- or 24-bit PCM`);
  };
  const frames = Math.floor(data.length / (width * channels));
  const samples = new Float64Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let s = 0;
    for (let c = 0; c < channels; c += 1) s += read(data.at + (i * channels + c) * width);
    samples[i] = s / channels;
  }
  return { rate, samples };
}

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** An uploaded recording as mono samples at 48 kHz. */
export function readRecording(path: string): Float64Array {
  const lower = path.toLowerCase();
  let decoded: { rate: number; samples: Float64Array };
  if (lower.endsWith('.wav')) {
    decoded = decodeWav(readFileSync(path), path);
  } else {
    if (!RAW_EXTENSIONS.some((ext) => lower.endsWith(ext))) throw new VoiceInputError(`${path}: not a recording this reads (${RAW_EXTENSIONS.join(', ')})`);
    if (!hasFfmpeg()) throw new VoiceInputError(`${path}: only WAV is read without ffmpeg, and ffmpeg is not installed — install it, or convert the file to WAV`);
    const wav = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(AUDIO_SAMPLE_RATE), '-f', 'wav', '-acodec', 'pcm_s16le', '-'], { maxBuffer: 1 << 30 });
    decoded = decodeWav(new Uint8Array(wav.buffer, wav.byteOffset, wav.byteLength), path);
  }
  return decoded.rate === AUDIO_SAMPLE_RATE ? decoded.samples : resample(decoded.samples, AUDIO_SAMPLE_RATE / decoded.rate);
}
