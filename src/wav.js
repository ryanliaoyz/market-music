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

export async function renderWav(clip, { OfflineContext = globalThis.OfflineAudioContext, tone = globalThis.Tone } = {}) {
  const context = new OfflineContext(1, Math.ceil(clip.durationMs * 44.1), 44100);
  const engine = createSoundEngine({ bars: [], openingGapReturn: null }, { context, tone });
  try {
    await engine.prepare();
    for (const frame of clip.frames) engine.playMapping(recordingMapping(frame), { when: frame.offsetMs / 1000, duration: 0.47 });
    const buffer = await engine.renderOffline();
    return new Blob([encodeWav(buffer)], { type: "audio/wav" });
  } finally { await engine.dispose(); }
}
