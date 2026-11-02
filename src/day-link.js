import { PRESETS } from "./presets.js";
import { SPEEDS } from "./playback.js";

// Historical share links carry only catalog choices: no prices or audio.
const PREFIX = "#day=";
const ID = /^[A-Z]+-\d{4}-\d{2}-\d{2}$/;

export function encodeDayLink({ sessionId, presetId, speed, from, to }) {
  validate({ sessionId, presetId, speed, from, to });
  return `${PREFIX}${sessionId}&sound=${presetId}&speed=${speed}&from=${from}&to=${to}`;
}

export function isDayLink(hash) { return hash.startsWith(PREFIX); }

export function decodeDayLink(hash, sessionIds) {
  if (!isDayLink(hash) || hash.length > 200) throw new Error("Invalid day link");
  const params = new URLSearchParams(hash.slice(1));
  const keys = [...params.keys()];
  if (keys.length !== 5 || new Set(keys).size !== 5 || !["day", "sound", "speed", "from", "to"].every(key => params.has(key))) {
    throw new Error("Invalid day link");
  }
  const integer = text => /^\d{1,3}$/.test(text) ? Number(text) : NaN;
  const link = { sessionId: params.get("day"), presetId: params.get("sound"), speed: Number(params.get("speed")),
    from: integer(params.get("from")), to: integer(params.get("to")) };
  validate(link);
  if (!sessionIds.includes(link.sessionId)) throw new Error("This trading day is not available");
  return link;
}

function validate({ sessionId, presetId, speed, from, to }) {
  if (typeof sessionId !== "string" || !ID.test(sessionId) || !PRESETS.some(preset => preset.id === presetId) ||
      !SPEEDS.includes(speed) || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > 389 || from >= to) {
    throw new Error("Invalid day link");
  }
}
