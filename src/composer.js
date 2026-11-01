import { musicalMapping } from "./live-music.js";

// Resolved scores use event-score.js; replay never needs this composer interface.

export const COMPOSER_VERSION = "open-v1";

/**
 * Composer boundary: create({seed, version, preset}) -> advance, reset, inspect.
 * advance({beat, controls, lookahead, frame}) returns beat-relative events.
 * `frame` and result.mapping are compatibility adapters for the existing player.
 * The open implementation deliberately retains the existing public mapping.
 */
export function createComposer({ seed = 1, version = COMPOSER_VERSION, preset = "classic-v2" } = {}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("Seed must be uint32");
  if (version !== COMPOSER_VERSION) throw new RangeError("Unknown composer version");
  let last = null;
  return {
    advance({ beat, controls, frame, lookahead = [] }) {
      if (!Number.isInteger(beat) || beat < 0) throw new RangeError("Invalid beat");
      const mapping = musicalMapping({ ...frame, slot: beat, controls }, preset);
      // This stand-in has no lookahead decisions and delegates synthesis to the legacy rack.
      last = { version, preset, beat, mapping, events: [] };
      return structuredClone(last);
    },
    reset() { last = null; },
    inspect() { return structuredClone({ version, seed, preset, last, waiting: null, reason: "open-mapping" }); },
  };
}
