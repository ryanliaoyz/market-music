import { MAX_DURATION_MS, MAX_FRAMES } from "./recording-codec.js";

export function createRecorder() {
  const pending = new Map();
  let state = "idle", reason = "created", start = null, startOffsetMs = null, armedAt = 0, clip = null;
  let captured = new Map();
  function schedule(frame) {
    pending.set(frame.scheduleId, frame);
    if (!["armed", "recording"].includes(state) || frame.when < armedAt) return;
    start ??= frame.when;
    // Audio-clock conversion can shift on reschedule; the delayed deadline cannot.
    startOffsetMs ??= frame.playbackOffsetMs;
    if (frame.playbackOffsetMs - startOffsetMs >= MAX_DURATION_MS) return;
    captured.set(frame.scheduleId, frame); state = "recording";
  }
  function finish(time, why = "record-stop") {
    if (!["armed", "recording"].includes(state)) return;
    const durationMs = start === null ? 0 : Math.min(MAX_DURATION_MS, Math.max(0, Math.round((time - start) * 1000)));
    const frames = [...captured.values()].sort((a, b) => a.playbackOffsetMs - b.playbackOffsetMs)
      .filter(frame => frame.when < time && Math.round(frame.playbackOffsetMs - startOffsetMs) < durationMs).slice(0, MAX_FRAMES)
      .map(frame => ({ offsetMs: Math.round(frame.playbackOffsetMs - startOffsetMs), price: frame.price,
        presetId: frame.presetId, note: frame.mapping.note, harmony: frame.mapping.harmony,
        intensity: frame.mapping.intensity, event: frame.event }));
    clip = frames.length ? { durationMs, frames } : null;
    state = clip ? "ready" : "idle"; reason = why;
  }
  return {
    schedule,
    cancel(id) { pending.delete(id); captured.delete(id); },
    start(time) {
      captured = new Map(); clip = null; start = startOffsetMs = null; armedAt = time; state = "armed"; reason = "record-start";
      for (const frame of pending.values()) if (frame.when >= time) schedule(frame);
    },
    update(time) {
      for (const [id, frame] of pending) if (frame.when < time) pending.delete(id);
      if (start !== null && time >= start + MAX_DURATION_MS / 1000) finish(start + MAX_DURATION_MS / 1000, "duration-cap");
    },
    finish,
    boundary(time, why) { finish(time, why); pending.clear(); },
    get clip() { return clip; },
    inspect(time = 0) { return { state, reason, frames: captured.size, pending: pending.size,
      durationMs: clip?.durationMs ?? (start === null ? 0 : Math.max(0, Math.min(MAX_DURATION_MS, Math.round((time - start) * 1000)))),
      waiting: state === "armed" ? "next-audible-frame" : null }; },
  };
}
