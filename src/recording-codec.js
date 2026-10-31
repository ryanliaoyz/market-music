import { PRESETS, LIVE_PRESETS, getPreset } from "./presets.js";
import { patternMapping } from "./live-music.js";

export const MAX_DURATION_MS = 30000;
export const MAX_FRAMES = 60;
export const MAX_HASH_LENGTH = 4096;
const PREFIX = "#recording=v1.";
const STRIDE = 24;
const hz = note => 440 * 2 ** ((note - 69) / 12);

export function recordingMapping(frame) {
  if (frame.mask !== undefined) return patternMapping(frame);
  const preset = getPreset(frame.presetId);
  return { ...preset, presetId: preset.id, note: frame.note, frequency: hz(frame.note),
    harmony: frame.harmony, harmonyFrequency: frame.harmony === null ? null : hz(frame.harmony),
    intensity: frame.intensity, gain: 0.11, cutoff: 400 + 7600 * frame.intensity,
    drive: 24 * frame.intensity, droneNote: null,
    rules: frame.event ? [frame.event === "drop" ? "drop-crash" : "spike-bell"] : [] };
}

function validate(clip) {
  if (!Number.isInteger(clip.durationMs) || clip.durationMs < 1 || clip.durationMs > MAX_DURATION_MS ||
      !Array.isArray(clip.frames) || clip.frames.length < 1 || clip.frames.length > MAX_FRAMES) throw new Error("Invalid recording limits");
  let previous = -1;
  for (const frame of clip.frames) {
    const preset = getPreset(frame.presetId);
    if (Boolean(preset.rhythm) !== Boolean(getPreset(clip.frames[0].presetId).rhythm)) throw new Error("Mixed recording versions");
    if (preset.rhythm && (!Array.isArray(frame.chord) || frame.chord.length !== 3 ||
        ![frame.note, ...frame.chord].every(note => Number.isInteger(note) && note >= 0 && note <= 127 && preset.scale.includes(((note - preset.root) % 12 + 12) % 12)) ||
        !preset.rhythm.includes(frame.mask) || !Number.isInteger(frame.accent) || frame.accent < 0 || frame.accent > 3 ||
        frame.harmony !== frame.chord[0] || frame.intensity !== frame.accent / 3)) throw new Error("Invalid musical recording");
    if (!Number.isInteger(frame.offsetMs) || frame.offsetMs < 0 || frame.offsetMs >= clip.durationMs || frame.offsetMs <= previous ||
        !Number.isFinite(frame.price) || frame.price <= 0 || frame.price > 1e12 ||
        !Number.isInteger(frame.note) || frame.note < 0 || frame.note > 127 ||
        (frame.harmony !== null && (!Number.isInteger(frame.harmony) || frame.harmony < 0 || frame.harmony > 127)) ||
        !Number.isFinite(frame.intensity) || frame.intensity < 0 || frame.intensity > 1 ||
        ![null, "drop", "spike"].includes(frame.event)) throw new Error("Invalid recording frame");
    previous = frame.offsetMs;
  }
  return clip;
}

export function encodeRecording(clip) {
  validate(clip);
  const musical = Boolean(getPreset(clip.frames[0].presetId).rhythm);
  const stride = musical ? 29 : STRIDE, presets = musical ? LIVE_PRESETS : PRESETS;
  const bytes = new Uint8Array(4 + stride * clip.frames.length);
  const view = new DataView(bytes.buffer);
  bytes[0] = 1; // BTC-USD; the envelope version fixes the synthesis contract.
  view.setUint16(1, clip.durationMs); bytes[3] = clip.frames.length;
  clip.frames.forEach((frame, index) => {
    const at = 4 + index * stride;
    view.setUint16(at, frame.offsetMs); view.setFloat64(at + 2, frame.price);
    bytes[at + 10] = presets.findIndex(preset => preset.id === frame.presetId);
    bytes[at + 11] = frame.note; bytes[at + 12] = frame.harmony ?? 255;
    view.setFloat64(at + 13, frame.intensity);
    bytes[at + 21] = [null, "drop", "spike"].indexOf(frame.event);
    if (musical) {
      bytes.set(frame.chord, at + 24); bytes[at + 27] = frame.mask; bytes[at + 28] = frame.accent;
    }
  });
  const hash = (musical ? "#recording=v2." : PREFIX) + btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  if (hash.length > MAX_HASH_LENGTH) throw new Error("Recording link exceeds 4 KiB");
  return hash;
}

export function decodeRecording(hash) {
  const musical = hash.startsWith("#recording=v2.");
  if (hash.length > MAX_HASH_LENGTH || !(musical || hash.startsWith(PREFIX))) throw new Error("Invalid recording link or version");
  const stride = musical ? 29 : STRIDE, presets = musical ? LIVE_PRESETS : PRESETS;
  const text = hash.slice(PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) throw new Error("Invalid recording encoding");
  const bytes = Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
  if (bytes.length < 4 || bytes[0] !== 1 || bytes[3] > MAX_FRAMES || bytes.length !== 4 + bytes[3] * stride) throw new Error("Invalid recording payload");
  const view = new DataView(bytes.buffer);
  const frames = Array.from({ length: bytes[3] }, (_, index) => {
    const at = 4 + index * stride;
    if (!presets[bytes[at + 10]] || bytes[at + 21] > 2 || bytes[at + 22] || bytes[at + 23]) throw new Error("Invalid recording flags");
    return { offsetMs: view.getUint16(at), price: view.getFloat64(at + 2), presetId: presets[bytes[at + 10]].id,
      note: bytes[at + 11], harmony: bytes[at + 12] === 255 ? null : bytes[at + 12],
      intensity: view.getFloat64(at + 13), event: [null, "drop", "spike"][bytes[at + 21]],
      ...(musical ? { chord: [...bytes.slice(at + 24, at + 27)], mask: bytes[at + 27], accent: bytes[at + 28] } : {}) };
  });
  return validate({ durationMs: view.getUint16(1), frames });
}
