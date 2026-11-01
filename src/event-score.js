// Public renderer contract, independent of any composer implementation.
export const RENDERER = "rack-v3";
export const EVENT_KITS = Object.freeze(["classic-v3", "ambient-v3", "bass-heavy-v3", "arpeggio-v3"]);
export const EVENT_PRESETS = Object.freeze(EVENT_KITS.map((id, index) => Object.freeze({ id, label: ["Classic", "Ambient", "Bass-heavy", "Arpeggio"][index] })));
export const EVENT_PARTS = Object.freeze(["lead", "pad", "bass", "kick", "hat", "snare", "arp", "riser", "stinger", "cadence"]);
export const EVENT_CAPS = Object.freeze({ pad: 10, lead: 4, arp: 8, bass: 2, riser: 2, stinger: 6, cadence: 2 });
export const V3_DURATION_MS = 120000;
export const V3_HASH_LENGTH = 65536;
export const V3_FRAMES = 240;
export const V3_EVENTS = 32;
export const eventKit = id => ({ id, attack: id === "ambient-v3" ? 0.08 : 0.01, release: 0.1 });

export function normalizeEvents(events) {
  return events.map(event => ({ part: event.part, ...(event.note === undefined ? {} : { note: event.note }), offset: Math.round(event.offset * 200) / 200,
    duration: Math.round(event.duration * 200) / 200, velocity: Math.round(event.velocity * 200) / 200 }));
}

export function validateEventScore(clip) {
  const integer = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;
  if (clip.version !== 3 || clip.renderer !== RENDERER || !integer(clip.durationMs, 1, V3_DURATION_MS) ||
      !Array.isArray(clip.frames) || !integer(clip.frames.length, 1, V3_FRAMES)) throw new Error("Invalid v3 recording limits");
  let previous = -1;
  const voices = Object.fromEntries(Object.keys(EVENT_CAPS).map(part => [part, []]));
  const timed = [];
  for (const frame of clip.frames) {
    if (!integer(frame.offsetMs, 0, clip.durationMs - 1) || frame.offsetMs % 500 !== 0 || frame.offsetMs <= previous ||
        !EVENT_KITS.includes(frame.presetId) || !integer(frame.change, -32768, 32767) ||
        !Array.isArray(frame.events) || frame.events.length > V3_EVENTS) throw new Error("Invalid v3 beat");
    previous = frame.offsetMs;
    for (const event of frame.events) {
      const drum = ["kick", "hat", "snare"].includes(event.part);
      const units = value => Math.abs(value * 200 - Math.round(value * 200)) < 1e-8;
      const minimumNote = event.part === "bass" ? 22 : 48;
      const maximumNote = event.part === "arp" ? 96 : event.part === "bass" ? 54 : 84;
      if (!EVENT_PARTS.includes(event.part) || (drum ? event.note !== undefined : !integer(event.note, minimumNote, maximumNote)) ||
          !Number.isFinite(event.offset) || event.offset < 0 || event.offset >= 0.5 || !units(event.offset) ||
          frame.offsetMs + event.offset * 1000 >= clip.durationMs ||
          !Number.isFinite(event.duration) || event.duration < 0.005 || event.duration > 2 || !units(event.duration) ||
          !Number.isFinite(event.velocity) || event.velocity < 0 || event.velocity > 1 || !units(event.velocity)) throw new Error("Invalid v3 event");
      if (!drum) timed.push({ ...event, time: frame.offsetMs / 1000 + event.offset });
    }
  }
  for (const event of timed.sort((a, b) => a.time - b.time)) {
    const active = voices[event.part].filter(until => until > event.time + 1e-8);
    if (active.length >= EVENT_CAPS[event.part]) throw new Error("V3 voice capacity exceeded");
    active.push(event.time + event.duration + 0.1); voices[event.part] = active;
  }
  return clip;
}
