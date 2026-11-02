import { musicalMapping } from "./live-music.js";
import { normalizeEvents } from "./event-score.js";

export const LIVE_EVENT_PRESETS = Object.freeze([
  { id: "classic-v3", label: "Classic" }, { id: "ambient-v3", label: "Ambient" },
  { id: "arpeggio-v3", label: "Plucky" }, { id: "bass-heavy-v3", label: "Bass-heavy" },
]);
const legacy = { "classic-v3": "classic-v2", "ambient-v3": "ambient-v2", "arpeggio-v3": "plucky-v2", "bass-heavy-v3": "bass-heavy-v2" };

// Resolve the public mapping once; Live, rewind and exports all render this score.
export function createLiveEventSource() {
  let last = null;
  return {
    advance({ beat, controls, frame, preset }) {
      const mapping = musicalMapping(frame, legacy[preset]);
      const events = [];
      const part = preset === "bass-heavy-v3" ? "bass" : preset === "arpeggio-v3" ? "arp" : "lead";
      const steps = [0, 1, 2, 3].filter(step => mapping.mask & (1 << step));
      for (const step of steps) events.push({ part,
        note: part === "arp" ? mapping.chord[step % 3] : part === "bass" && mapping.note > 54 ? mapping.note - 12 : mapping.note,
        offset: step * 0.125, duration: part === "bass" ? 0.1 : 0.12,
        velocity: mapping.gain * (1 + mapping.accent / 6) });
      for (const note of mapping.chord) events.push({ part: "pad", note: note < 48 ? note + 12 : note,
        offset: 0, duration: preset === "ambient-v3" ? 0.7 : 0.3, velocity: mapping.gain * 0.22 });
      if (controls.energy >= 2) {
        events.push({ part: "kick", offset: 0, duration: 0.08, velocity: 0.125 });
        for (let step = 0; step < 4; step++) if (controls.hits[step] > 0 || step === 2)
          events.push({ part: "hat", offset: step * 0.125, duration: 0.02, velocity: 0.025 });
        if (controls.energy >= 3 && beat % 2 === 1) events.push({ part: "snare", offset: 0, duration: 0.06, velocity: 0.05 });
      }
      if (frame.event === "drop") events.push({ part: "snare", offset: 0, duration: 0.2, velocity: 0.08 });
      if (frame.event === "spike") events.push({ part: "stinger", note: 84, offset: 0, duration: 0.4, velocity: 0.06 });
      last = { beat, preset, events: normalizeEvents(events) };
      return structuredClone(last);
    },
    reset() { last = null; },
    inspect: () => ({ version: "open-events-v1", last: structuredClone(last), waiting: null, reason: "public-resolved-score" }),
  };
}
