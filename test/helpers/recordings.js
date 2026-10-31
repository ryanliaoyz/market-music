import { PRESETS, LIVE_PRESETS } from "../../src/presets.js";
import { mapSoundFrame } from "../../src/sound.js";
import { musicalMapping } from "../../src/live-music.js";
import { encodeRecording } from "../../src/recording-codec.js";

export function sampleFrame(preset, index = 0) {
  const mapping = preset.rhythm ? musicalMapping({ degree: index % 15, chordDegree: [0, 3, 4, 5][index % 4],
    tradeRate: 20, accent: 3, event: index % 2 ? "drop" : "spike" }, preset.id) :
    mapSoundFrame({ close: index % 16, return: index % 2 ? -1 : 1, rollingVolatility: 1,
      volume: 1, vwap: null, event: index % 2 ? "drop" : "spike" },
    { low: 0, high: 15, peakVolatility: 1, volumeReference: 1 }, { presetId: preset.id });
  return { offsetMs: index * 500, price: 100 + index, presetId: preset.id, note: mapping.note,
    harmony: mapping.harmony, intensity: mapping.intensity, event: index % 2 ? "drop" : "spike",
    ...(preset.rhythm ? { chord: mapping.chord, mask: mapping.mask, accent: mapping.accent } : {}) };
}

export function recordingCorpus() {
  return [...PRESETS, ...LIVE_PRESETS].map(preset => ({ durationMs: 30000,
    frames: Array.from({ length: 60 }, (_, i) => sampleFrame(preset, i)) }));
}

export function mutateHash(hash, at, value) {
  const split = hash.indexOf(".") + 1;
  const bytes = Uint8Array.from(atob(hash.slice(split).replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
  bytes[at] = value;
  return hash.slice(0, split) + btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function fuzzHashes(count = 256) {
  let seed = 0x4d30;
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  const presets = [...PRESETS, ...LIVE_PRESETS];
  return Array.from({ length: count }, (_, i) => {
    const preset = presets[i % presets.length];
    const hash = encodeRecording({ durationMs: 1000, frames: [sampleFrame(preset)] });
    return mutateHash(hash, random(preset.rhythm ? 33 : 28), random(256));
  });
}
