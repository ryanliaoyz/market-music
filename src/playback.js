import { createSoundEngine } from "./sound.js";
import { DEFAULT_PRESET_ID, getPreset } from "./presets.js";

export const DEFAULT_SPEED = 1.625;
export const SPEEDS = [0.5, 1, DEFAULT_SPEED, 2, 4];

export function createPlayback(features, {
  context, presetId = DEFAULT_PRESET_ID, volume = 1, tone, setInterval: repeat = globalThis.setInterval,
  clearInterval: cancel = globalThis.clearInterval, onChange = () => {},
} = {}) {
  getPreset(presetId);
  const indices = new Map(features.bars.map((bar, index) => [bar.minute, index]));
  let engine = null;
  let state = "paused";
  let minute = 0;
  let speed = DEFAULT_SPEED;
  let origin = 0;
  let startMinute = 0;
  let nextMinute = 0;
  let timer = null;
  let generation = 0;
  let reason = "session-loaded";

  const duration = () => 0.5 / speed;
  const clock = () => engine.inspect().currentTime;
  function cursor() {
    if (state !== "playing") return minute;
    return Math.min(390, startMinute + Math.max(0, clock() - origin) / duration());
  }
  function inspect() {
    const position = cursor();
    const currentMinute = Math.min(389, Math.floor(position));
    return {
      session: features.session.id, state, speed, position, presetId,
      minute: currentMinute, barIndex: indices.get(currentMinute) ?? null,
      nextMinute, reason, waiting: state === "starting" ? "audio-resume" :
        state === "playing" ? "audio-clock" : null,
      audio: engine?.inspect() ?? null,
    };
  }
  function notify() { onChange(inspect()); }
  function stop(reasonValue) {
    minute = Math.min(389, Math.floor(cursor()));
    generation++;
    if (timer !== null) cancel(timer);
    timer = null;
    if (["seek", "speed-change", "preset-change"].includes(reasonValue)) engine?.silence();
    else engine?.stop();
    state = "paused";
    reason = reasonValue;
  }
  function tick() {
    const now = clock();
    if (cursor() >= 390) {
      stop("session-ended");
      minute = 390;
      state = "ended";
      notify();
      return;
    }
    // A throttled tab skips expired beats rather than bursting overdue sounds.
    while (nextMinute < 390) {
      const when = origin + (nextMinute - startMinute) * duration();
      if (when > now + 0.1) break;
      const index = indices.get(nextMinute);
      if (when >= now && index !== undefined) {
        engine.playBar(index, { when, duration: duration(), skipIfLate: true });
      }
      nextMinute++;
    }
    notify();
  }
  function start() {
    startMinute = minute;
    nextMinute = minute;
    origin = clock() + 0.03;
    state = "playing";
    reason = "play";
    tick();
    timer = repeat(tick, 25);
  }
  return {
    inspect,
    setVolume(value) { volume = value; engine?.setVolume(value); notify(); },
    async play() {
      if (state === "disposed") throw new Error("Playback is disposed");
      if (state === "playing" || state === "starting") return;
      if (state === "ended") minute = 0;
      engine ??= createSoundEngine(features, { context, presetId, tone, volume });
      const request = ++generation;
      state = "starting";
      reason = "play-requested";
      notify();
      try {
        await engine.resume();
      } catch (error) {
        if (request === generation) {
          stop("resume-failed");
          notify();
        }
        throw error;
      }
      if (request !== generation) return;
      start();
    },
    pause() {
      if (state === "disposed") return;
      stop("pause");
      notify();
    },
    seek(value) {
      if (!Number.isInteger(value) || value < 0 || value > 389) throw new RangeError("Invalid seek minute");
      if (state === "disposed") throw new Error("Playback is disposed");
      const playing = state === "playing";
      stop("seek");
      minute = value;
      if (playing) start();
      reason = "seek";
      notify();
    },
    setSpeed(value) {
      if (!SPEEDS.includes(value)) throw new RangeError("Invalid playback speed");
      if (state === "disposed") throw new Error("Playback is disposed");
      const playing = state === "playing";
      const ended = state === "ended";
      stop("speed-change");
      speed = value;
      if (ended) {
        state = "ended";
        minute = 390;
      }
      if (playing) start();
      reason = "speed-change";
      notify();
    },
    setPreset(id) {
      getPreset(id);
      if (state === "disposed") throw new Error("Playback is disposed");
      const playing = state === "playing", ended = state === "ended";
      stop("preset-change");
      presetId = id;
      engine?.setPreset(id);
      if (ended) { state = "ended"; minute = 390; }
      if (playing) start();
      reason = "preset-change";
      notify();
    },
    async dispose() {
      if (state === "disposed") return;
      stop("disposed");
      state = "disposed";
      notify();
      await engine?.dispose();
    },
  };
}
