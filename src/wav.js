import { createSoundEngine } from "./sound.js";
import { recordingMapping } from "./recording-codec.js";

export function encodeWav(buffer) {
  const samples = buffer.getChannelData(0);
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const text = (at, value) => [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, bytes.byteLength - 8, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, index) => view.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, value)) * (value < 0 ? 32768 : 32767)), true));
  return bytes;
}

export const MAX_DAY_CLIP_SECONDS = 240;
const TAIL_SECONDS = 1.5;

// Renders an inclusive minute range of a historical day at the listener's speed and sound.
export async function renderDayWav(features, { presetId, speed, from, to },
  { OfflineContext = globalThis.OfflineAudioContext, tone = globalThis.Tone } = {}) {
  const beat = 0.5 / speed;
  const seconds = (to - from + 1) * beat;
  if (seconds > MAX_DAY_CLIP_SECONDS) {
    throw new RangeError(`This clip is ${Math.ceil(seconds / 60)} minutes of audio. Shorten it or raise the speed (limit ${MAX_DAY_CLIP_SECONDS / 60} minutes).`);
  }
  const context = new OfflineContext(1, Math.ceil((seconds + TAIL_SECONDS) * 44100), 44100);
  const engine = createSoundEngine(features, { context, tone, presetId });
  const indices = new Map(features.bars.map((bar, index) => [bar.minute, index]));
  try {
    await engine.prepare();
    for (let minute = from; minute <= to; minute++) {
      const index = indices.get(minute);
      if (index !== undefined) engine.playBar(index, { when: (minute - from) * beat, duration: beat });
    }
    const buffer = await engine.renderOffline();
    return new Blob([encodeWav(buffer)], { type: "audio/wav" });
  } finally { await engine.dispose(); }
}

export async function renderWav(clip, { OfflineContext = globalThis.OfflineAudioContext, tone = globalThis.Tone } = {}) {
  const context = new OfflineContext(1, Math.ceil(clip.durationMs * 44.1), 44100);
  const engine = createSoundEngine({ bars: [], openingGapReturn: null }, { context, tone, eventMode: clip.version === 3 });
  try {
    await engine.prepare();
    for (const frame of clip.frames) {
      if (clip.version === 3) engine.playEvents(frame.events, { presetId: frame.presetId, when: frame.offsetMs / 1000 });
      else engine.playMapping(recordingMapping(frame), { when: frame.offsetMs / 1000, duration: 0.47 });
    }
    const buffer = await engine.renderOffline();
    return new Blob([encodeWav(buffer)], { type: "audio/wav" });
  } finally { await engine.dispose(); }
}
