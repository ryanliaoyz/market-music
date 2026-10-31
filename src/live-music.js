import { getPreset } from "./presets.js";

export const degreeNote = (degree, preset) => preset.root + 12 * Math.floor(degree / 7) + preset.scale[((degree % 7) + 7) % 7];
const hz = note => 440 * 2 ** ((note - 69) / 12);

// Resolved pattern fields are also the v2 replay contract; no market history is needed.
export function musicalMapping(frame, presetId) {
  const preset = getPreset(presetId);
  const note = degreeNote(frame.degree, preset);
  const chord = [0, 2, 4].map(step => degreeNote(frame.chordDegree + step, preset));
  const density = frame.tradeRate > 8 ? 2 : frame.tradeRate > 2 ? 1 : 0;
  const mask = preset.rhythm[density];
  return patternMapping({ presetId, note, chord, mask, accent: frame.accent, event: frame.event });
}

export function patternMapping({ presetId, note, chord, mask, accent, event = null }) {
  const preset = getPreset(presetId);
  return { ...preset, presetId, note, frequency: hz(note), harmony: chord[0], harmonyFrequency: hz(chord[0]),
    chord: [...chord], mask, accent, gain: 0.11, intensity: accent / 3, cutoff: 1200 + accent * 1800,
    drive: accent * 3, droneNote: null, rules: [`${preset.texture}:mask-${mask}`, `accent-${accent}`,
      ...(event ? [event === "drop" ? "drop-crash" : "spike-bell"] : [])] };
}

export function patternVoices(mapping, duration) {
  const preset = getPreset(mapping.presetId), voices = [];
  const steps = [0, 1, 2, 3].filter(step => mapping.mask & (1 << step));
  for (const step of steps) {
    const note = preset.texture === "arpeggio" ? mapping.chord[step % 3] : mapping.note;
    voices.push({ hz: hz(note), gain: mapping.gain * (1 + mapping.accent / 6), offset: step * 0.125,
      duration: Math.min(duration - step * 0.125, (steps.length === 1 ? duration : 0.125) * preset.gate) });
  }
  const offset = preset.texture === "bass" ? 0.125 : 0;
  for (const note of mapping.chord) voices.push({ hz: hz(note), gain: mapping.gain * 0.22,
    offset, duration: (duration - offset) * preset.gate });
  return voices;
}
