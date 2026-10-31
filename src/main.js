import { loadCatalog, loadSession } from "./data.js";
import { computeFeatures } from "./features.js";
import { createPlayback } from "./playback.js";
import { createVisuals, createLiveVisuals } from "./visuals.js";
import { createDebugPanel, createLiveDebugPanel } from "./debug.js";
import { createLiveFeed } from "./live-feed.js";
import { createLivePlayback } from "./live-playback.js";
import { PRESETS, LIVE_PRESETS } from "./presets.js";
import { createRecorder } from "./recording.js";
import { encodeRecording, decodeRecording } from "./recording-codec.js";
import { createRecordingPlayback } from "./recording-playback.js";
import { renderWav } from "./wav.js";
import { registerPwa } from "./pwa.js";

const preset = document.getElementById("preset");
for (const value of PRESETS) preset.add(new Option(value.label, value.id));

const day = document.getElementById("day");
const controls = document.getElementById("controls");
const play = document.getElementById("play");
const speed = document.getElementById("speed");
const seek = document.getElementById("seek");
const time = document.getElementById("time");
const status = document.getElementById("status");
const chart = document.getElementById("chart");
const debugPanel = document.getElementById("debug");
let debug = null;
let visuals = null;
let playback = null;
let selection = 0;
let loading = true;
let error = null;
let resumeNeeded = false, lifecycleReason = "ready", pwa = null;
function renderLifecycle() {
  document.getElementById("lifecycle-debug").textContent = JSON.stringify({
    visibility: document.visibilityState, resumeNeeded, reason: lifecycleReason, pwa,
  }, null, 2);
  if (resumeNeeded) status.textContent = `Playback interrupted (${lifecycleReason}). Tap ${mode.value === "live" ? "Start" : "Play"} to continue.`;
}
function interrupt(why) {
  const snapshot = playback?.inspect();
  if (!snapshot || !(snapshot.active || ["playing", "starting"].includes(snapshot.state))) return;
  resumeNeeded = true; lifecycleReason = why;
  feed?.stop();
  if (snapshot.mode === "live") playback.stop();
  else playback.pause();
  renderLifecycle();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) interrupt("background");
  renderLifecycle();
});
window.addEventListener("pagehide", () => interrupt("page hidden"));
window.addEventListener("pageshow", renderLifecycle);
registerPwa(snapshot => { pwa = snapshot; renderLifecycle(); });
const mode = document.getElementById("mode");
const feedDebug = document.getElementById("feed-debug");
let feed = null;
let sessions = null;
const recorder = createRecorder();
let sharedClip = null, exporting = false, encodedSize = 0;
const record = document.getElementById("record");
const download = document.getElementById("download-wav");
const share = document.getElementById("share-recording");
const recordingError = document.getElementById("recording-error");
const currentClip = () => mode.value === "recording" ? sharedClip : recorder.clip;
function renderRecording(snapshot = playback?.inspect()) {
  const time = snapshot?.audio?.currentTime ?? 0;
  recorder.update(time);
  const info = recorder.inspect(time);
  const recording = ["armed", "recording"].includes(info.state);
  document.getElementById("recording-controls").hidden = mode.value === "historical" && !recordingError.textContent;
  record.hidden = mode.value !== "live";
  record.disabled = !snapshot?.active || snapshot.state !== "playing" && !recording;
  record.textContent = recording ? "Stop recording" : "Record";
  document.getElementById("recording-status").textContent = mode.value === "recording" ? `${(sharedClip.durationMs / 1000).toFixed(1)} s clip` : `${info.state} · ${(info.durationMs / 1000).toFixed(1)} / 30 s`;
  download.disabled = !currentClip() || exporting;
  share.disabled = !currentClip();
  document.getElementById("recording-debug").textContent = JSON.stringify({ ...info, exporting, encodedSize,
    replay: mode.value === "recording" ? { state: snapshot?.state, elapsedMs: snapshot?.elapsedMs, reason: snapshot?.reason } : null }, null, 2);
}

function showError(cause) {
  error = cause.message;
  status.textContent = navigator.onLine === false ? "Offline. Connect to load historical sessions or start Live; shared recording links can replay offline." :
    `Unable to play: ${error}. ${mode.value === "live" ? "Press Stop, then Start to retry." : "Try selecting the day again or pressing Play."}`;
}

function render(snapshot) {
  if (!resumeNeeded && ["playing", "buffering", "waiting"].includes(snapshot.state) &&
      ["suspended", "interrupted"].includes(snapshot.audio?.contextState) && snapshot.waiting !== "audio-context-resume") {
    interrupt("audio paused by browser"); return;
  }
  renderLifecycle();
  renderRecording(snapshot);
  visuals?.render(snapshot);
  debug?.render(snapshot);
  const mapping = debug?.inspect();
  document.getElementById("preset-debug").textContent = `Selected: ${snapshot.presetId}; ${mapping?.presetId ?? "no audible preset"} · scale ${mapping?.scale?.join(", ") ?? "n/a"} · root ${mapping?.root ?? "n/a"} · ${mapping?.oscillator ?? "n/a"} · cutoff ${mapping?.cutoff ?? "n/a"} Hz`;
  if (snapshot.mode === "recording") {
    play.textContent = ["playing", "starting"].includes(snapshot.state) ? "Stop" : "Play";
    if (!resumeNeeded) status.textContent = `Shared recording · ${snapshot.state}`;
    return;
  }
  if (snapshot.mode === "live") {
    play.textContent = snapshot.active ? "Stop" : "Start";
    mode.disabled = snapshot.active;
    const messages = { stopped: "Live crypto ready. Press Start to subscribe.", starting: "Starting audio…",
      waiting: "Waiting for the first BTC-USD price…", buffering: "Buffering · 5 seconds…",
      playing: "Playing · 5 s delayed · BTC-USD · Coinbase", reconnecting: "Connection lost. Reconnecting to Coinbase…",
      error: `Live unavailable: ${snapshot.audioError ?? error ?? feed?.inspect().error ?? snapshot.reason}. Press Stop, then Start to retry.` };
    if (!resumeNeeded) status.textContent = messages[snapshot.state] ?? snapshot.state;
    if (feed) feedDebug.textContent = JSON.stringify({ ...feed.inspect(), retainedFrames: snapshot.frames.length,
      policy: snapshot.policy, references: snapshot.latest?.references ?? null,
      bufferedMs: snapshot.bufferedMs, queueSize: snapshot.queueSize, segmentId: snapshot.segmentId,
      newestReceived: snapshot.newestReceived, delayedCursorMs: snapshot.delayedCursorMs }, null, 2);
    return;
  }
  play.textContent = ["playing", "starting"].includes(snapshot.state) ? "Pause" : "Play";
  seek.value = snapshot.minute;
  speed.value = snapshot.speed;
  const wallMinute = 570 + snapshot.minute;
  time.textContent = snapshot.state === "ended" ? "16:00 — End" :
    `${String(Math.floor(wallMinute / 60)).padStart(2, "0")}:${String(wallMinute % 60).padStart(2, "0")}`;
  seek.setAttribute("aria-valuetext", time.textContent);
}

window.marketMusic = {
  inspect: () => ({ mode: mode.value, feed: feed?.inspect() ?? null, selectedSession: day.value, loading, error, playback: playback?.inspect() ?? null,
    lifecycle: { visibility: document.visibilityState, resumeNeeded, reason: lifecycleReason, pwa },
    visuals: visuals?.inspect() ?? null, debug: debug?.inspect() ?? null,
    recording: { ...recorder.inspect(playback?.inspect().audio?.currentTime), exporting, encodedSize }, sharedClip }),
};

async function selectDay(sessions) {
  const request = ++selection;
  loading = true;
  error = null;
  controls.disabled = true;
  status.textContent = "Loading session…";
  const previous = playback;
  playback = null;
  visuals = null;
  debug = null;
  chart.hidden = true;
  debugPanel.hidden = true;
  try {
    await previous?.dispose();
    const features = computeFeatures(await loadSession(sessions.find(session => session.id === day.value)));
    if (request !== selection) return;
    visuals = createVisuals(features, chart);
    debug = createDebugPanel(features, debugPanel);
    playback = createPlayback(features, { onChange: render, presetId: preset.value });
    render(playback.inspect());
    chart.hidden = false;
    debugPanel.hidden = false;
    controls.disabled = false;
    status.textContent = `${features.session.title} · ${features.bars.length} observed minutes`;
  } catch (cause) {
    if (request === selection) showError(cause);
  } finally {
    if (request === selection) loading = false;
  }
}

function configureMode(live) {
  for (const id of ["historical-source", "historical-speed", "historical-time", "seek", "historical-debug-help"]) {
    document.getElementById(id).hidden = live;
  }
  document.getElementById("live-product").hidden = !live;
  feedDebug.hidden = !live;
  document.getElementById("debug-bar-label").textContent = live ? "Current frame · UTC" : "Current bar · New York time";
  document.getElementById("debug-return-label").textContent = live ? "500 ms return" : "1-minute return";
  document.getElementById("debug-sigma-label").textContent = live ? "Trailing return σ" : "Day σ · population standard deviation";
  const labels = chart.querySelectorAll(".chart-labels text");
  [labels[2].textContent, labels[3].textContent, labels[4].textContent] = live ? ["−65 s", "−35 s", "−5 s"] : ["09:30", "12:45", "16:00"];
  chart.querySelector("figcaption").textContent = live ? "BTC-USD · 60-second window · 5 s delayed · UTC · USD" : "Close price · New York time · USD";
  document.getElementById("chart-title").textContent = live ? "BTC-USD delayed price" : "Session close price";
}

async function selectMode() {
  resumeNeeded = false; lifecycleReason = "mode change";
  const request = ++selection;
  feed?.stop(); feed = null;
  const previous = playback;
  playback = visuals = debug = null;
  controls.disabled = true; chart.hidden = debugPanel.hidden = true;
  loading = true; error = null;
  const live = mode.value === "live";
  const replay = mode.value === "recording";
  const selectedIndex = preset.selectedIndex;
  preset.replaceChildren();
  for (const value of live ? LIVE_PRESETS : PRESETS) preset.add(new Option(value.label, value.id));
  preset.selectedIndex = Math.max(0, selectedIndex);
  configureMode(live || replay);
  preset.disabled = replay;
  await previous?.dispose();
  if (request !== selection) return;
  mode.disabled = false;
  if (replay) {
    visuals = createLiveVisuals(chart); debug = createLiveDebugPanel(debugPanel);
    playback = createRecordingPlayback(sharedClip, { onChange: snapshot => { if (request === selection) render(snapshot); } });
    chart.querySelector("figcaption").textContent = "Recorded BTC-USD · relative time · USD";
    document.getElementById("chart-title").textContent = "Recorded BTC-USD prices";
    controls.disabled = false; chart.hidden = debugPanel.hidden = false; loading = false;
    render(playback.inspect()); return;
  }
  if (!live) {
    if (sessions) await selectDay(sessions);
    else { loading = false; status.textContent = "Historical catalog unavailable or still loading. Live crypto is available."; }
    return;
  }
  visuals = createLiveVisuals(chart);
  debug = createLiveDebugPanel(debugPanel);
  playback = createLivePlayback({ presetId: preset.value, onSchedule: recorder.schedule, onCancel: recorder.cancel,
    onBoundary: recorder.boundary, onChange: snapshot => { if (request === selection) render(snapshot); } });
  feed = createLiveFeed({
    onTick: tick => { if (request === selection) playback.accept(tick); },
    onTrade: trade => { if (request === selection) playback.acceptTrade(trade); },
    onStatus: snapshot => {
      if (request !== selection) return;
      error = snapshot.error;
      playback.setConnection(snapshot);
    },
  });
  controls.disabled = false; chart.hidden = debugPanel.hidden = false; loading = false;
  render(playback.inspect());
}

mode.addEventListener("change", () => { selectMode().catch(showError); });

play.addEventListener("click", async () => {
  if (document.hidden) return;
  resumeNeeded = false; lifecycleReason = "user gesture";
  const current = playback;
  const request = selection;
  try {
    if (mode.value === "live") {
      if (current.inspect().active) { feed.stop(); current.stop(); }
      else {
        error = null;
        const starting = current.start();
        feed.start();
        await starting;
      }
      return;
    }
    if (["playing", "starting"].includes(current.inspect().state)) current.pause();
    else {
      error = null;
      if (mode.value === "historical") status.textContent = day.selectedOptions[0].textContent;
      await current.play();
    }
  } catch (cause) {
    if (request === selection) showError(cause);
  }
});
seek.addEventListener("input", () => playback.seek(Number(seek.value)));
speed.addEventListener("change", () => playback.setSpeed(Number(speed.value)));
preset.addEventListener("change", () => {
  try { playback.setPreset(preset.value); } catch (cause) { showError(cause); }
});

async function initialize() {
  try {
    if (location.hash.startsWith("#recording=")) await loadRecordingHash();
    sessions = await loadCatalog();
    for (const session of sessions) {
      day.add(new Option(`${session.symbol} · ${session.date} · ${session.title}`, session.id));
    }
    day.disabled = false;
    day.addEventListener("change", () => selectDay(sessions));
    if (mode.value === "historical") await selectDay(sessions);
  } catch (cause) {
    if (mode.value === "historical") {
      loading = false; showError(cause);
      status.textContent = `Offline or unable to load historical sessions: ${cause.message}. Check your connection and reload; shared recording links can still replay.`;
    }
  }
}

record.addEventListener("click", () => {
  const time = playback.inspect().audio.currentTime;
  if (["armed", "recording"].includes(recorder.inspect().state)) recorder.finish(time);
  else { recorder.start(time); document.getElementById("recording-link").hidden = true; }
  recordingError.textContent = ""; renderRecording();
});
download.addEventListener("click", async () => {
  const clip = currentClip(), request = selection;
  exporting = true; recordingError.textContent = ""; renderRecording();
  try {
    const blob = await renderWav(clip);
    if (request !== selection || clip !== currentClip()) return;
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = "market-music.wav"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (cause) { recordingError.textContent = `WAV export failed: ${cause.message}`; }
  finally { exporting = false; renderRecording(); }
});
share.addEventListener("click", async () => {
  try {
    const hash = encodeRecording(currentClip()); encodedSize = hash.length;
    const link = new URL(location.href); link.hash = hash;
    const input = document.getElementById("recording-link");
    input.value = link.href; input.hidden = false; input.select();
    if (navigator.clipboard) {
      try { await navigator.clipboard.writeText(link.href); }
      catch { recordingError.textContent = "Select and copy the recording link below."; }
    }
    renderRecording();
  } catch (cause) { recordingError.textContent = cause.message; }
});
async function loadRecordingHash() {
  if (!location.hash.startsWith("#recording=")) return;
  try {
    const clip = decodeRecording(location.hash);
    sharedClip = clip; encodedSize = location.hash.length;
    mode.querySelector('[value="recording"]').disabled = false;
    mode.value = "recording"; await selectMode();
  } catch (cause) { recordingError.textContent = `Unable to open recording: ${cause.message}`; document.getElementById("recording-controls").hidden = false; }
}
window.addEventListener("hashchange", loadRecordingHash);
initialize();
