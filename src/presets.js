export const DEFAULT_PRESET_ID = "classic-v1";

// IDs are replay contracts: change the version when changing a sound definition.
export const PRESETS = Object.freeze([
  { id: DEFAULT_PRESET_ID, label: "Classic", scale: [0, 3, 5, 7, 10], root: 48, oscillator: "triangle", attack: 0.01, release: 0.1 },
  { id: "ambient-v1", label: "Ambient", scale: [0, 3, 5, 7, 10], root: 48, oscillator: "sine", attack: 0.08, release: 0.3 },
  { id: "plucky-v1", label: "Plucky", scale: [0, 2, 4, 7, 9], root: 48, oscillator: "triangle", attack: 0.002, release: 0.08 },
  { id: "bass-heavy-v1", label: "Bass-heavy", scale: [0, 3, 5, 7, 10], root: 36, oscillator: "sawtooth", attack: 0.01, release: 0.12 },
].map(preset => Object.freeze({ ...preset, scale: Object.freeze(preset.scale) })));

export function getPreset(id = DEFAULT_PRESET_ID) {
  const preset = PRESETS.find(value => value.id === id);
  if (!preset) throw new RangeError(`Unknown preset: ${id}`);
  return preset;
}
