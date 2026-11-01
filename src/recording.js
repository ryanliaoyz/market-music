import { MAX_DURATION_MS, MAX_FRAMES } from "./recording-codec.js";
import { RENDERER, V3_DURATION_MS, V3_FRAMES, normalizeEvents } from "./event-score.js";

export function createRecorder() {
  const pending = new Map();
  let state = "idle", reason = "created", start = null, startOffsetMs = null, armedAt = 0, clip = null;
  let captured = new Map();
  let eventMode = false;
  const limit = () => eventMode ? V3_DURATION_MS : MAX_DURATION_MS;
  function schedule(frame) {
    pending.set(frame.scheduleId, frame);
    if (!["armed", "recording"].includes(state) || frame.when < armedAt) return;
    start ??= frame.when;
    if (captured.size === 0) eventMode = Array.isArray(frame.events);
    if (eventMode !== Array.isArray(frame.events)) throw new Error("Mixed recording versions");
    // Audio-clock conversion can shift on reschedule; the delayed deadline cannot.
    startOffsetMs ??= frame.playbackOffsetMs;
    if (frame.playbackOffsetMs - startOffsetMs >= limit()) return;
    captured.set(frame.scheduleId, frame); state = "recording";
  }
  function finish(time, why = "record-stop") {
    if (!["armed", "recording"].includes(state)) return;
    const durationMs = start === null ? 0 : Math.min(limit(), Math.max(0, Math.round((time - start) * 1000)));
    const heard = [...captured.values()].sort((a, b) => a.playbackOffsetMs - b.playbackOffsetMs)
      .filter(frame => frame.when < time && Math.round(frame.playbackOffsetMs - startOffsetMs) < durationMs).slice(0, eventMode ? V3_FRAMES : MAX_FRAMES);
    const frames = heard.map(frame => eventMode ? {
      offsetMs: Math.round(frame.playbackOffsetMs - startOffsetMs), presetId: frame.presetId,
      change: Math.max(-32768, Math.min(32767, Math.round((frame.price / heard[0].price - 1) * 100000))),
      events: normalizeEvents(frame.events).filter(event => Math.round(frame.playbackOffsetMs - startOffsetMs) + event.offset * 1000 < durationMs),
    } : ({ offsetMs: Math.round(frame.playbackOffsetMs - startOffsetMs), price: frame.price,
        presetId: frame.presetId, note: frame.mapping.note, harmony: frame.mapping.harmony,
        intensity: frame.mapping.intensity, event: frame.event,
        ...(frame.mapping.mask === undefined ? {} : { chord: [...frame.mapping.chord], mask: frame.mapping.mask, accent: frame.mapping.accent }) }));
    clip = frames.length ? { ...(eventMode ? { version: 3, renderer: RENDERER } : {}), durationMs, frames } : null;
    state = clip ? "ready" : "idle"; reason = why;
  }
  return {
    schedule,
    cancel(id) { pending.delete(id); captured.delete(id); },
    start(time) {
      captured = new Map(); clip = null; eventMode = false; start = startOffsetMs = null; armedAt = time; state = "armed"; reason = "record-start";
      for (const frame of pending.values()) if (frame.when >= time) schedule(frame);
    },
    update(time) {
      for (const [id, frame] of pending) if (frame.when < time) pending.delete(id);
      if (start !== null && time >= start + limit() / 1000) finish(start + limit() / 1000, "duration-cap");
    },
    finish,
    boundary(time, why) { finish(time, why); pending.clear(); },
    get clip() { return clip; },
    inspect(time = 0) { return { state, reason, frames: captured.size, pending: pending.size,
      version: eventMode ? 3 : null, renderer: eventMode ? RENDERER : null, limitMs: limit(),
      events: eventMode ? [...captured.values()].reduce((count, frame) => count + frame.events.length, 0) : null,
      durationMs: clip?.durationMs ?? (start === null ? 0 : Math.max(0, Math.min(limit(), Math.round((time - start) * 1000)))),
      waiting: state === "armed" ? "next-audible-frame" : null }; },
  };
}
