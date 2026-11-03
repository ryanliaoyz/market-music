import { RENDERER } from "./event-score.js";

export const REWIND_MS = 180000;

export function createRewindBuffer() {
  let groups = new Map(), origin = null, base = 0, end = 0, lower = 0;
  let frozen = true, reason = "created", epoch = 0;
  function update(time) {
    if (frozen || origin === null || time <= origin) return;
    end = Math.max(end, base + Math.max(0, Math.round((time - origin) * 1000)));
    lower = Math.max(0, Math.ceil((end - REWIND_MS) / 500) * 500);
    for (const [id, group] of groups) if (group.offsetMs < lower) groups.delete(id);
  }
  function boundary(time, why) {
    update(time);
    for (const [id, group] of groups) {
      if (group.offsetMs >= end) groups.delete(id);
      else group.events = group.events.filter(event => group.offsetMs + event.offset * 1000 < end)
        .map(event => ({ ...event, duration: Math.min(event.duration,
          Math.max(0.005, Math.floor((end - group.offsetMs - event.offset * 1000) / 5) / 200)) }));
    }
    frozen = true; origin = null; reason = why; epoch++;
  }
  function inspect() {
    const heard = [...groups.values()].filter(group => group.offsetMs < end);
    return { startMs: lower, endMs: end, durationMs: end - lower, frozen, reason,
      groups: heard.length, events: heard.reduce((n, group) => n + group.events.filter(event => group.offsetMs + event.offset * 1000 < end).length, 0),
      pending: [...groups.values()].filter(group => group.offsetMs >= end).length,
      waiting: frozen ? "resume-live" : origin === null ? "next-audible-beat" : null };
  }
  return {
    update, boundary, inspect,
    schedule(frame) {
      if (origin === null) { base = Math.ceil(end / 500) * 500; origin = frame.when; frozen = false; }
      const offsetMs = base + Math.round((frame.when - origin) * 1000 / 500) * 500;
      // Price is kept for the on-page chart only; clip() never exports it.
      const price = Number.isFinite(frame.price) ? frame.price : null;
      groups.set(`${epoch}:${frame.scheduleId}`, { offsetMs, presetId: frame.presetId, change: 0, events: structuredClone(frame.events), price });
      reason = "scheduled";
    },
    cancel(id) { groups.delete(`${epoch}:${id}`); reason = "schedule-cancelled"; },
    clear() { groups = new Map(); origin = null; base = end = lower = 0; frozen = true; reason = "cleared"; },
    clip(startMs = lower, endMs = end) {
      if (!Number.isInteger(startMs) || startMs % 500 || startMs < lower || !Number.isInteger(endMs) || endMs > end || endMs <= startMs)
        throw new RangeError("Select a nonempty interval inside the rewind buffer");
      const frames = [...groups.values()].filter(group => group.offsetMs >= startMs && group.offsetMs < endMs)
        .sort((a, b) => a.offsetMs - b.offsetMs).map(group => ({ offsetMs: group.offsetMs - startMs, presetId: group.presetId, change: group.change,
          events: structuredClone(group.events.filter(event => group.offsetMs + event.offset * 1000 < endMs)) }));
      return frames.length ? { version: 3, renderer: RENDERER, durationMs: endMs - startMs, frames } : null;
    },
    // Heard beats with their display price, oldest first, for the paused chart.
    trace() {
      return [...groups.values()].filter(group => group.offsetMs >= lower && group.offsetMs < end)
        .sort((a, b) => a.offsetMs - b.offsetMs).map(group => ({ offsetMs: group.offsetMs, price: group.price }));
    },
  };
}
