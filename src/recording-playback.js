import { createSoundEngine } from "./sound.js";
import { recordingMapping } from "./recording-codec.js";

export function createRecordingPlayback(clip, { context, onChange = () => {}, tone, volume = 1,
  setInterval: every = globalThis.setInterval, clearInterval: cancel = globalThis.clearInterval } = {}) {
  let engine = null;
  let state = "stopped", reason = "shared-recording", start = 0, timer = null, generation = 0, next = 0;
  const frames = clip.frames.map((frame, index) => ({ ...frame, id: index, slot: Math.round(frame.offsetMs / 500),
    exchangeTimeMs: frame.offsetMs, ...(clip.version === 3 ? { price: frame.change / 1000 } : { mapping: recordingMapping(frame) }) }));
  function inspect() {
    const elapsed = state === "playing" ? Math.max(0, (engine.inspect().currentTime - start) * 1000) : 0;
    const visible = frames.filter(frame => frame.offsetMs <= elapsed);
    const latest = state === "playing" ? visible.at(-1) ?? null : null;
    const audible = latest && elapsed < latest.offsetMs + 470 ? { ...latest, when: start + latest.offsetMs / 1000 } : null;
    return { mode: "recording", state, reason, elapsedMs: elapsed, durationMs: clip.durationMs,
      version: clip.version, renderer: clip.renderer, relativePrices: clip.version === 3,
      presetId: latest?.presetId ?? frames[0].presetId, frames: state === "playing" ? visible : [], latest, audible,
      waiting: state === "starting" ? "audio-context-resume" : null, audio: engine?.inspect() ?? null };
  }
  function stop(why = "replay-stop") { generation++; cancel(timer); timer = null; engine?.stop(); state = "stopped"; reason = why; onChange(inspect()); }
  function advance() {
    const now = engine.inspect().currentTime;
    if ((now - start) * 1000 >= clip.durationMs) { stop("replay-ended"); return; }
    while (next < frames.length && start + frames[next].offsetMs / 1000 <= now + 0.1) {
      const frame = frames[next++];
      if (clip.version === 3) engine.playEvents(frame.events, { presetId: frame.presetId, when: start + frame.offsetMs / 1000, skipIfLate: true });
      else engine.playMapping(frame.mapping, { when: start + frame.offsetMs / 1000, duration: 0.47, skipIfLate: true });
    }
    onChange(inspect());
  }
  return { inspect, stop, pause: stop,
    setVolume(value) { volume = value; engine?.setVolume(value); onChange(inspect()); },
    async play() {
      stop(); const request = ++generation; state = "starting"; onChange(inspect());
      engine ??= createSoundEngine({ bars: [], openingGapReturn: null }, { context, tone, volume, eventMode: clip.version === 3 });
      try { await engine.resume(); }
      catch (cause) { if (request === generation) stop("resume-failed"); throw cause; }
      if (request !== generation) return;
      start = engine.inspect().currentTime + 0.05; next = 0; state = "playing"; reason = "replay-start";
      engine.setEndpoint(start + clip.durationMs / 1000);
      timer = every(advance, 25); advance();
    },
    async dispose() { stop(); await engine?.dispose(); },
  };
}
