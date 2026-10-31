import { createSoundEngine } from "./sound.js";
import { createLiveFeatures, FRAME_MS, WINDOW_FRAMES, LIVE_POLICY } from "./live-features.js";

export const DELAY_MS = 5000;
const RETAINED_FRAMES = WINDOW_FRAMES + DELAY_MS / FRAME_MS + 2;

export function createLivePlayback({ context, onChange = () => {}, onTick = () => {}, onFrame = () => {},
  now = () => performance.now(), setInterval: every = globalThis.setInterval,
  clearInterval: cancel = globalThis.clearInterval } = {}) {
  let features = createLiveFeatures(), engine = null, timer = null;
  let state = "stopped", reason = "created", active = false, disposed = false, generation = 0;
  let sessionStart = 0, origin = null, segmentId = 0, connectionId = null;
  let frames = [], pending = new Map(), built = -1, nextAudio = 0;
  let audible = null, scheduled = [], newestReceived = null, audioReady = false;
  let audioError = null;

  function inspect() {
    const cursor = origin === null ? null : now() - origin - DELAY_MS;
    const visible = cursor === null || cursor < 0 ? [] : frames.filter(frame => frame.sourceOffsetMs <= cursor && frame.sourceOffsetMs > cursor - 60000);
    return { mode: "live", state, reason, active, segmentId, audioError, delayMs: DELAY_MS,
      policy: LIVE_POLICY, bufferedMs: origin === null ? 0 : Math.min(DELAY_MS, Math.max(0, now() - origin)),
      queueSize: frames.filter(frame => cursor === null || frame.sourceOffsetMs > cursor).length + pending.size,
      delayedCursorMs: cursor === null || cursor < 0 ? null : origin - sessionStart + cursor,
      newestReceived: structuredClone(newestReceived), frames: structuredClone(visible),
      latest: structuredClone(visible.at(-1) ?? null), audible: structuredClone(audible),
      waiting: !active || audioError ? null : !audioReady ? "audio-context-resume" : origin === null ? "first-price" : cursor < 0 ? "five-second-buffer" : null,
      audio: engine?.inspect() ?? null };
  }
  function notify() { onChange(inspect()); }
  function clearSegment(why) {
    engine?.stop(); features = createLiveFeatures();
    origin = null; frames = []; pending.clear(); built = -1; nextAudio = 0;
    audible = null; scheduled = []; reason = why;
  }
  function build(slot) {
    const tick = pending.get(slot);
    if (tick) features.accept(tick);
    pending.delete(slot);
    const frame = features.sample(slot * FRAME_MS);
    Object.assign(frame, { segmentId, sourceOffsetMs: slot * FRAME_MS,
      sessionOffsetMs: origin - sessionStart + slot * FRAME_MS,
      playbackOffsetMs: origin - sessionStart + slot * FRAME_MS + DELAY_MS });
    frames.push(frame);
    if (frames.length > RETAINED_FRAMES) frames.shift();
    built = slot;
    onFrame(structuredClone(frame));
  }
  function advance() {
    if (!active || origin === null) { notify(); return; }
    const time = now();
    const sourceSlot = Math.floor((time - origin) / FRAME_MS);
    // A backgrounded page skips expired source intervals instead of processing an unbounded backlog.
    const first = Math.max(built + 1, sourceSlot - RETAINED_FRAMES + 1);
    for (const slot of pending.keys()) if (slot < first) pending.delete(slot);
    for (let slot = first; slot <= sourceSlot; slot++) build(slot);
    const cursor = time - origin - DELAY_MS;
    if (audioReady && cursor >= 0 && state !== "error") state = "playing";
    if (!audioReady || engine.inspect().contextState !== "running") {
      engine?.stop(); audible = null; scheduled = [];
      nextAudio = Math.max(nextAudio, Math.floor(cursor / FRAME_MS) + 1);
      notify(); return;
    }
    const audioNow = engine.inspect().currentTime;
    for (const item of scheduled) if (audioNow >= item.when) audible = item.frame;
    scheduled = scheduled.filter(item => audioNow < item.when);
    if (audible && audioNow >= audible.until) audible = null;
    nextAudio = Math.max(nextAudio, Math.ceil(cursor / FRAME_MS));
    // Schedule only future deadlines. The monotonic cursor never moves to accommodate a late timer.
    while (nextAudio <= built && origin + nextAudio * FRAME_MS + DELAY_MS <= time + 100) {
      const slot = nextAudio++;
      const due = origin + slot * FRAME_MS + DELAY_MS;
      if (due < time) continue;
      const frame = frames.find(item => item.slot === slot);
      if (!frame?.mapping) continue;
      const when = audioNow + (due - time) / 1000;
      const mapping = engine.playMapping(frame.mapping, { when, duration: 0.47, skipIfLate: true });
      if (mapping) scheduled.push({ when, frame: { ...frame, when, until: when + 0.47 } });
    }
    reason = cursor < 0 ? "buffering" : "delayed-timeline";
    notify();
  }
  return {
    accept(tick) {
      if (!active || disposed) return;
      const received = now();
      if (connectionId !== tick.connectionId) {
        clearSegment("new-connection"); connectionId = tick.connectionId; segmentId++;
      }
      newestReceived = { price: tick.price, exchangeTimeMs: tick.exchangeTimeMs, elapsedMs: received - sessionStart };
      onTick(Object.freeze({ ...tick, elapsedMs: received - sessionStart, segmentId }));
      if (origin === null) {
        origin = received;
        if (!audioError) { state = "buffering"; reason = "first-price"; }
        pending.set(0, tick); build(0);
      } else {
        const slot = Math.max(built + 1, Math.ceil((received - origin) / FRAME_MS));
        pending.set(slot, { ...tick, discontinuity: tick.discontinuity || pending.get(slot)?.discontinuity || false });
        for (const old of pending.keys()) if (slot - old >= RETAINED_FRAMES) pending.delete(old);
      }
      if (audioError) { state = "error"; reason = "audio-resume-failed"; }
      notify();
    },
    setConnection(status) {
      if (!active || disposed) return;
      if (["connecting", "reconnecting", "error"].includes(status.state)) {
        clearSegment(status.reason);
        state = status.state === "connecting" ? "waiting" : status.state;
      }
      if (audioError) { state = "error"; reason = "audio-resume-failed"; }
      // Healthy heartbeats and a quiet ticker leave the delayed timeline and socket running.
      notify();
    },
    async start() {
      if (disposed) throw new Error("Live playback is disposed");
      if (active) return;
      const request = ++generation;
      active = true; audioReady = false; audioError = null; state = "starting"; sessionStart = now();
      connectionId = null; newestReceived = null; segmentId = 0; clearSegment("start");
      engine ??= createSoundEngine({ bars: [], openingGapReturn: null }, { context });
      timer = every(advance, 25); notify();
      try { await engine.resume(); }
      catch (cause) {
        if (request === generation) { audioError = cause.message; state = "error"; reason = "audio-resume-failed"; notify(); }
        throw cause;
      }
      if (!active || disposed || request !== generation) return;
      audioReady = true;
      if (state !== "error" && state !== "reconnecting") state = origin === null ? "waiting" : "buffering";
      notify();
    },
    stop() {
      generation++; active = false; audioReady = false; audioError = null; cancel(timer); timer = null;
      clearSegment("stop"); newestReceived = null; state = "stopped"; notify();
    },
    async dispose() {
      if (disposed) return;
      this.stop(); disposed = true; state = "disposed";
      await engine?.dispose();
    },
    inspect,
  };
}
