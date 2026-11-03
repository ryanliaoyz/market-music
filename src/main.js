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
import { renderWav, renderDayWav } from "./wav.js";
import { encodeDayLink, decodeDayLink, isDayLink } from "./day-link.js";
import { EVENT_PRESETS } from "./event-score.js";
import { createLiveEventSource, LIVE_EVENT_PRESETS } from "./live-events.js";
import { registerPwa } from "./pwa.js";
import { createRewindView, defaultSelection } from "./rewind-view.js";

const preset = document.getElementById("preset");
const presetCards = document.getElementById("preset-cards");
const selectedPreset = () => preset.querySelector("input:checked").value;
function renderPresets(values, selectedIndex = 0) {
  const descriptions = ["Balanced & expressive", "Soft & spacious", "Bright & playful", "Deep & driving"];
  presetCards.replaceChildren(...values.map((value, index) => {
    const card = document.createElement("label");
    card.className = "preset-card";
    const radio = document.createElement("input");
    radio.type = "radio"; radio.name = "preset"; radio.value = value.id;
    radio.checked = index === selectedIndex;
    radio.setAttribute("aria-label", value.label);
    const content = document.createElement("span");
    content.className = "preset-content";
    const art = document.createElement("span");
    art.className = "preset-art"; art.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 9; i++) art.append(document.createElement("i"));
    const name = document.createElement("span");
    name.className = "preset-name"; name.textContent = value.label;
    const description = document.createElement("span");
    description.className = "preset-description"; description.textContent = descriptions[index];
    content.append(art, name, description); card.append(radio, content);
    return card;
  }));
}
renderPresets(PRESETS);

const dayPicker = document.getElementById("historical-source");
const dayCards = document.getElementById("day-cards");
const day = { get value() { return dayCards.querySelector("input:checked")?.value ?? ""; } };
const dateLabel = date => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
  .format(new Date(`${date}T00:00:00Z`));
const clock = minute => { const wall = 570 + minute; return `${String(Math.floor(wall / 60)).padStart(2, "0")}:${String(wall % 60).padStart(2, "0")}`; };
function renderDays(values) {
  dayCards.replaceChildren(...values.map((session, index) => {
    const card = document.createElement("label");
    card.className = "day-card";
    const radio = document.createElement("input");
    radio.type = "radio"; radio.name = "day"; radio.value = session.id; radio.checked = index === 0;
    radio.setAttribute("aria-label", `${session.title}, ${session.symbol}, ${dateLabel(session.date)}`);
    const content = document.createElement("span");
    content.className = "day-content";
    const meta = document.createElement("span");
    meta.className = "day-meta"; meta.textContent = `${session.symbol} · ${dateLabel(session.date)}`;
    const title = document.createElement("span");
    title.className = "day-title"; title.textContent = session.title;
    content.append(meta, title);
    if (session.summary) {
      const summary = document.createElement("span");
      summary.className = "day-summary"; summary.id = `day-summary-${session.id}`; summary.textContent = session.summary;
      radio.setAttribute("aria-describedby", summary.id);
      content.append(summary);
    }
    card.append(radio, content);
    return card;
  }));
}
function checkDay(id) {
  const radio = dayCards.querySelector(`input[value="${CSS.escape(id)}"]`);
  radio.checked = true;
  radio.closest(".day-card").scrollIntoView({ block: "nearest", inline: "nearest" });
}
const controls = document.getElementById("controls");
const play = document.getElementById("play");
const speed = document.getElementById("speed");
const seek = document.getElementById("seek");
const volume = document.getElementById("volume");
const listeningVolume = () => Number(volume.value) / 100;
const time = document.getElementById("time");
const status = document.getElementById("status");
const chart = document.getElementById("chart");
const scene = document.getElementById("scene");
const debugPanel = document.getElementById("debug");
// Diagnostics are for development: add ?debug to the address to show the panel.
const debugEnabled = new URLSearchParams(location.search).has("debug");
const showDebug = () => debugEnabled && debugPanel.open;
const hearing = document.getElementById("hearing");
const clipStart = document.getElementById("clip-start");
const clipEnd = document.getElementById("clip-end");
const shareFeedback = document.getElementById("share-feedback");
let currentFeatures = null, pendingDayLink = null, feedbackTimer = null;
let debug = null;
let visuals = null;
let playback = null;
let selection = 0;
let loading = true;
let error = null;
let resumeNeeded = false, lifecycleReason = "ready", pwa = null;
function renderLifecycle() {
  if (showDebug()) document.getElementById("lifecycle-debug").textContent = JSON.stringify({
    visibility: document.visibilityState, resumeNeeded, reason: lifecycleReason, pwa,
  }, null, 2);
  if (resumeNeeded) status.textContent = `Playback interrupted (${lifecycleReason}). Tap Start to continue.`;
}
function interrupt(why) {
  stopPreview();
  const snapshot = playback?.inspect();
  if (!snapshot || !(snapshot.active || ["playing", "starting"].includes(snapshot.state))) return;
  resumeNeeded = true; lifecycleReason = why;
  feed?.stop();
  playback.pause();
  renderLifecycle();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) interrupt("background");
  renderLifecycle();
});
window.addEventListener("pagehide", () => interrupt("page hidden"));
window.addEventListener("pageshow", renderLifecycle);
registerPwa(snapshot => { pwa = snapshot; renderLifecycle(); });
const modeTabs = [...document.querySelectorAll('#mode [role="tab"]')];
const mode = {
  value: "historical",
  set disabled(value) { for (const tab of modeTabs) tab.disabled = value; },
};
function renderTabs() {
  for (const tab of modeTabs) {
    const selected = tab.dataset.mode === mode.value;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
}
function chooseMode(value) {
  if (mode.value === value) return;
  mode.value = value; renderTabs();
  selectMode().catch(showError);
}
for (const tab of modeTabs) tab.addEventListener("click", () => chooseMode(tab.dataset.mode));
document.getElementById("mode").addEventListener("keydown", event => {
  const tabs = modeTabs.filter(tab => !tab.hidden && !tab.disabled);
  const index = tabs.indexOf(document.activeElement);
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  if (index < 0 || (!step && !["Home", "End"].includes(event.key))) return;
  event.preventDefault();
  const next = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs.at(-1) : tabs[(index + step + tabs.length) % tabs.length];
  next.focus(); chooseMode(next.dataset.mode);
});
const feedDebug = document.getElementById("feed-debug");
let feed = null;
let sessions = null;
const recorder = createRecorder();
let sharedClip = null, exporting = false, encodedSize = 0;
let preview = null, previewGeneration = 0, selectedClip = null, rewindWasPaused = false;
const pauseLive = document.getElementById("pause-live");
const LIVE_AXIS = ["−60 s", "−30 s", "latest"];
function setAxis(values) {
  const labels = chart.querySelectorAll(".chart-axis span");
  values.forEach((value, index) => { if (labels[index].textContent !== value) labels[index].textContent = value; });
}
const rewindView = createRewindView(chart, { onSelect: () => selectRewind() });
addEventListener("resize", () => { if (rewindWasPaused) renderRecording(); });
function stopPreview() {
  previewGeneration++;
  const previous = preview; preview = null;
  previous?.dispose().catch(showError);
  document.getElementById("preview-rewind").textContent = "Preview";
}
function selectRewind() {
  stopPreview();
  document.getElementById("recording-link").hidden = true;
  const selection = rewindView.selection;
  selectedClip = selection ? playback.rewind.clip(selection.startMs, selection.endMs) : null;
  recordingError.textContent = "";
  renderRecording();
}
function renderRewind(snapshot) {
  const paused = snapshot?.mode === "live" && snapshot.state === "paused";
  pauseLive.hidden = snapshot?.mode !== "live" || paused;
  pauseLive.disabled = snapshot?.state !== "playing";
  document.getElementById("rewind-controls").hidden = !paused;
  // While paused, the clip actions sit directly under the chart they act on.
  const actions = document.getElementById("recording-controls");
  if (paused && !rewindWasPaused) document.querySelector(".listening-space").after(actions);
  if (!paused && rewindWasPaused) controls.after(actions);
  if (paused && !rewindWasPaused) {
    // Pausing turns the price chart into the clip selector, starting with the last 30 seconds.
    const initial = defaultSelection(snapshot.rewind);
    rewindView.show(snapshot.rewind, initial);
    chart.querySelector("figcaption").textContent = "Drag across the chart to choose a clip";
    selectedClip = initial ? playback.rewind.clip(initial.startMs, initial.endMs) : null;
  }
  if (!paused && rewindWasPaused) {
    rewindView.hide();
    if (snapshot?.mode === "live") {
      setAxis(LIVE_AXIS);
      chart.querySelector("figcaption").textContent = "BTC-USD · last 60 seconds · USD";
    }
  }
  rewindWasPaused = paused;
  if (paused) {
    const previewing = preview && ["playing", "starting"].includes(preview.inspect().state);
    rewindView.render(playback.rewind.trace(), { previewMs: previewing ? preview.inspect().elapsedMs ?? 0 : null });
  }
  const text = selectedClip ? `${(selectedClip.durationMs / 1000).toFixed(1)} s selected` : "Nothing selected";
  const output = document.getElementById("rewind-selection");
  if (output.textContent !== text) output.textContent = text;
  document.getElementById("preview-rewind").disabled = !selectedClip;
  if (showDebug()) document.getElementById("rewind-debug").textContent = JSON.stringify({ ...snapshot?.rewind,
    selection: rewindView.selection,
    preview: preview?.inspect() ?? null, encodedSize }, null, 2);
}
const record = document.getElementById("record");
const download = document.getElementById("download-wav");
const share = document.getElementById("share-recording");
const recordingError = document.getElementById("recording-error");
const currentClip = () => mode.value === "recording" ? sharedClip : playback?.inspect().state === "paused" && mode.value === "live" ? selectedClip : recorder.clip;
const dayClip = () => mode.value === "historical" && playback && currentFeatures
  ? { sessionId: currentFeatures.session.id, presetId: selectedPreset(), speed: Number(speed.value), ...playback.inspect().range } : null;
function renderClip(range) {
  if (!range) return;
  clipStart.value = range.from; clipEnd.value = range.to;
  clipStart.setAttribute("aria-valuetext", clock(range.from));
  clipEnd.setAttribute("aria-valuetext", clock(range.to + 1));
  const seconds = (range.to - range.from + 1) * 0.5 / Number(speed.value);
  const text = `${clock(range.from)}–${clock(range.to + 1)} · ${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")} of audio`;
  const output = document.getElementById("clip-selection");
  if (output.textContent !== text) output.textContent = text;
}
function renderRecording(snapshot = playback?.inspect()) {
  renderRewind(snapshot);
  const time = snapshot?.audio?.currentTime ?? 0;
  recorder.update(time);
  const info = recorder.inspect(time);
  const recording = ["armed", "recording"].includes(info.state);
  const historical = mode.value === "historical";
  document.getElementById("recording-controls").hidden = historical && !playback && !recordingError.textContent;
  document.getElementById("clip-controls").hidden = !historical || !playback;
  if (historical) renderClip(snapshot?.range);
  const pausedLive = mode.value === "live" && snapshot?.state === "paused";
  record.hidden = mode.value !== "live" || pausedLive;
  record.disabled = !snapshot?.active || snapshot.state !== "playing" && !recording;
  record.textContent = recording ? "Stop recording" : "Record";
  document.getElementById("recording-status").hidden = pausedLive;
  document.getElementById("recording-status").textContent = historical ? "" : mode.value === "recording" ? `${(sharedClip.durationMs / 1000).toFixed(1)} s clip` : `${info.state} · ${(info.durationMs / 1000).toFixed(1)} / ${info.limitMs / 1000} s`;
  download.disabled = !(historical ? dayClip() : currentClip()) || exporting;
  share.disabled = !(historical ? dayClip() : currentClip());
  if (showDebug()) document.getElementById("recording-debug").textContent = JSON.stringify({ ...info, exporting, encodedSize,
     clip: currentClip() ? { version: currentClip().version ?? (currentClip().frames[0].presetId.endsWith("-v2") ? 2 : 1),
       renderer: currentClip().renderer, events: currentClip().frames.reduce((count, frame) => count + (frame.events?.length ?? 0), 0) } : null,
    replay: mode.value === "recording" ? { state: snapshot?.state, elapsedMs: snapshot?.elapsedMs, reason: snapshot?.reason } : null }, null, 2);
}

function showError(cause) {
  error = cause.message;
  status.textContent = navigator.onLine === false ? "Offline. Connect to load historical sessions or start Live; shared recording links can replay offline." :
    mode.value === "live" ? (playback?.inspect().state === "error" ? "Live unavailable. Press Retry." : "Live unavailable. Press Start to try again.") :
    "Unable to play. Try selecting the day again or pressing Start.";
  document.getElementById("audio-debug").textContent = JSON.stringify({ error }, null, 2);
}

function render(snapshot) {
  if (!resumeNeeded && ["playing", "buffering", "waiting"].includes(snapshot.state) &&
      ["suspended", "interrupted"].includes(snapshot.audio?.contextState) && snapshot.waiting !== "audio-context-resume") {
    interrupt("audio paused by browser"); return;
  }
  renderLifecycle();
  renderRecording(snapshot);
  // While Live is paused the chart belongs to the rewind selector.
  if (!(snapshot.mode === "live" && snapshot.state === "paused")) visuals?.render(snapshot);
  const intensity = visuals?.inspect()?.intensity ?? 0;
  scene.style.setProperty("--scene-hue", String(175 - intensity * 140));
  scene.style.setProperty("--scene-energy", String(0.2 + intensity * 0.3));
  debug?.render(snapshot);
  if (showDebug()) document.getElementById("audio-debug").textContent = JSON.stringify({ volume: listeningVolume(), audio: snapshot.audio, error }, null, 2);
  const mapping = debug?.inspect();
  scene.style.setProperty("--note-position", String((mapping?.note ?? 60) - 60));
  const retry = snapshot.mode === "live" && snapshot.state === "error";
  const active = !retry && (snapshot.mode === "live" ? snapshot.active || snapshot.state === "paused" && !resumeNeeded : ["playing", "starting"].includes(snapshot.state));
  play.textContent = retry ? "Retry" : active ? "Stop" : "Start";
  play.toggleAttribute("data-retry", retry);
  play.setAttribute("aria-label", play.textContent);
  play.setAttribute("aria-pressed", String(active));
  if (showDebug()) document.getElementById("preset-debug").textContent = `Selected: ${snapshot.presetId}; ${mapping?.presetId ?? "no audible preset"} · scale ${mapping?.scale?.join(", ") ?? "n/a"} · root ${mapping?.root ?? "n/a"} · ${mapping?.oscillator ?? "n/a"} · cutoff ${mapping?.cutoff ?? "n/a"} Hz`;
  if (snapshot.mode === "recording") {
    for (const radio of preset.querySelectorAll("input")) radio.checked = radio.value === snapshot.presetId;
    if (!resumeNeeded) status.textContent = `Shared recording · ${snapshot.state}${snapshot.eventOnly ? ` · ${(snapshot.elapsedMs / 1000).toFixed(1)} / ${snapshot.durationMs / 1000} s` : ""}`;
    return;
  }
  if (snapshot.mode === "live") {
    mode.disabled = snapshot.active;
    const messages = { stopped: "Live crypto ready. Press Start to subscribe.", starting: "Starting audio…",
      waiting: "Waiting for the first BTC-USD price…", buffering: "Buffering…",
      playing: "Playing · BTC-USD · Coinbase", reconnecting: "Connection lost. Reconnecting to Coinbase…",
      paused: "Paused", error: "Live unavailable. Press Retry." };
    if (!resumeNeeded) status.textContent = messages[snapshot.state] ?? snapshot.state;
    if (feed && showDebug()) feedDebug.textContent = JSON.stringify({ ...feed.inspect(), retainedFrames: snapshot.frames.length,
      policy: snapshot.policy, references: snapshot.latest?.references ?? null,
      signal: snapshot.signal, aggregate: snapshot.aggregate,
      bufferedMs: snapshot.bufferedMs, queueSize: snapshot.queueSize, segmentId: snapshot.segmentId,
      newestReceived: snapshot.newestReceived, delayedCursorMs: snapshot.delayedCursorMs }, null, 2);
    return;
  }
  seek.min = snapshot.range.from; seek.max = snapshot.range.to;
  seek.value = snapshot.minute;
  speed.value = snapshot.speed;
  time.textContent = snapshot.state === "ended" ? `${clock(snapshot.range.to + 1)} — End` : clock(snapshot.minute);
  seek.setAttribute("aria-valuetext", time.textContent);
}

window.marketMusic = {
  inspect: () => ({ mode: mode.value, feed: feed?.inspect() ?? null, selectedSession: day.value, loading, error, playback: playback?.inspect() ?? null,
    lifecycle: { visibility: document.visibilityState, resumeNeeded, reason: lifecycleReason, pwa },
    visuals: visuals?.inspect() ?? null, debug: debug?.inspect() ?? null,
    rewind: { ...playback?.rewind?.inspect(), selection: selectedClip, preview: preview?.inspect() ?? null },
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
  currentFeatures = null;
  try {
    await previous?.dispose();
    const features = computeFeatures(await loadSession(sessions.find(session => session.id === day.value)));
    if (request !== selection) return;
    visuals = createVisuals(features, chart);
    debug = createDebugPanel(features, debugPanel);
    currentFeatures = features;
    playback = createPlayback(features, { onChange: render, presetId: selectedPreset(), volume: listeningVolume() });
    const link = pendingDayLink?.sessionId === features.session.id ? pendingDayLink : null;
    pendingDayLink = null;
    if (link) { playback.setSpeed(link.speed); playback.setRange(link.from, link.to); }
    render(playback.inspect());
    chart.hidden = false;
    debugPanel.hidden = !debugEnabled;
    controls.disabled = false;
    status.textContent = link ? `Shared clip · ${features.session.title} · ${clock(link.from)}–${clock(link.to + 1)}. Press Start to listen.`
      : `${features.session.title} · ${features.bars.length} observed minutes`;
  } catch (cause) {
    if (request === selection) showError(cause);
  } finally {
    if (request === selection) loading = false;
  }
}

function configureMode(live, replay) {
  for (const id of ["historical-source", "historical-speed", "historical-time", "seek", "historical-debug-help"]) {
    document.getElementById(id).hidden = live || replay;
  }
  document.getElementById("live-product").hidden = !live;
  document.getElementById("replay-product").hidden = !replay;
  feedDebug.hidden = !live;
  live ||= replay;
  document.getElementById("debug-bar-label").textContent = live ? "Current frame · UTC" : "Current bar · New York time";
  document.getElementById("debug-return-label").textContent = live ? "500 ms return" : "1-minute return";
  document.getElementById("debug-sigma-label").textContent = live ? "Trailing return σ" : "Day σ · population standard deviation";
  const labels = chart.querySelectorAll(".chart-axis span");
  [labels[0].textContent, labels[1].textContent, labels[2].textContent] = live ? LIVE_AXIS : ["09:30", "12:45", "16:00"];
  chart.querySelector("figcaption").textContent = live ? "BTC-USD · last 60 seconds · USD" : "Close price · New York time · USD";
  document.getElementById("chart-title").textContent = live ? "BTC-USD price" : "Session close price";
  hearing.textContent = replay ? "Replaying a shared clip exactly as it was recorded." : live
    ? "Price moves steer the melody · trading activity drives the rhythm."
    : "Higher price → higher pitch · heavier trading → louder · bigger swings → grittier.";
}

async function selectMode() {
  stopPreview(); selectedClip = null; rewindWasPaused = false; rewindView.hide();
  controls.after(document.getElementById("recording-controls"));
  resumeNeeded = false; lifecycleReason = "mode change";
  const request = ++selection;
  feed?.stop(); feed = null; currentFeatures = null;
  recordingError.textContent = ""; document.getElementById("recording-link").hidden = true;
  const previous = playback;
  playback = visuals = debug = null;
  controls.disabled = true; chart.hidden = debugPanel.hidden = true;
  loading = true; error = null;
  const live = mode.value === "live";
  const replay = mode.value === "recording";
  const selectedIndex = [...preset.querySelectorAll("input")].findIndex(input => input.checked);
  const musicalReplay = replay && sharedClip.version !== 3 && sharedClip.frames[0].presetId.endsWith("-v2");
  renderPresets(replay && sharedClip.version === 3 ? EVENT_PRESETS : live ? LIVE_EVENT_PRESETS : musicalReplay ? LIVE_PRESETS : PRESETS, selectedIndex);
  configureMode(live, replay);
  preset.disabled = replay;
  await previous?.dispose();
  if (request !== selection) return;
  mode.disabled = false;
  if (replay) {
    visuals = createLiveVisuals(chart); debug = createLiveDebugPanel(debugPanel);
    playback = createRecordingPlayback(sharedClip, { volume: listeningVolume(), onChange: snapshot => { if (request === selection) render(snapshot); } });
    chart.querySelector("figcaption").textContent = playback.inspect().eventOnly ? "Shared musical events · relative time · no market data" : sharedClip.version === 3 ? "Shared BTC-USD · relative time · % from clip start" : "Recorded BTC-USD · relative time · USD";
    document.getElementById("chart-title").textContent = playback.inspect().eventOnly ? "Shared musical events · relative time" : sharedClip.version === 3 ? "Shared clip · relative change" : "Recorded BTC-USD prices";
    if (playback.inspect().eventOnly) {
      const labels = chart.querySelectorAll(".chart-axis span");
      [labels[0].textContent, labels[1].textContent, labels[2].textContent] = ["0 s", `${sharedClip.durationMs / 2000} s`, `${sharedClip.durationMs / 1000} s`];
    }
    controls.disabled = false; chart.hidden = false; debugPanel.hidden = !debugEnabled; loading = false;
    render(playback.inspect()); return;
  }
  if (!live) {
    if (sessions) await selectDay(sessions);
    else { loading = false; status.textContent = "Historical catalog unavailable or still loading. Live crypto is available."; }
    return;
  }
  visuals = createLiveVisuals(chart);
  debug = createLiveDebugPanel(debugPanel);
  playback = createLivePlayback({ volume: listeningVolume(), presetId: selectedPreset(), eventSource: createLiveEventSource(), onSchedule: recorder.schedule, onCancel: recorder.cancel,
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
  controls.disabled = false; chart.hidden = false; debugPanel.hidden = !debugEnabled; loading = false;
  render(playback.inspect());
}

debugPanel.addEventListener("toggle", () => { if (playback) render(playback.inspect()); });

play.addEventListener("click", async () => {
  if (document.hidden) return;
  const resumingInterrupted = resumeNeeded;
  resumeNeeded = false; lifecycleReason = "user gesture";
  const current = playback;
  const request = selection;
  try {
    if (mode.value === "live") {
      stopPreview(); selectedClip = null;
      const snapshot = current.inspect();
      const retry = snapshot.state === "error";
      if (retry) { feed.stop(); current.stop(); }
      if (!retry && (snapshot.active || snapshot.state === "paused" && !resumingInterrupted)) { feed.stop(); current.stop(); }
      else {
        error = null;
        const starting = current.start({ retainHistory: resumingInterrupted });
        feed.start();
        await starting;
      }
      return;
    }
    if (["playing", "starting"].includes(current.inspect().state)) current.pause();
    else {
      error = null;
      if (mode.value === "historical") status.textContent = currentFeatures.session.title;
      await current.play();
    }
  } catch (cause) {
    if (request === selection) showError(cause);
  }
});
seek.addEventListener("input", () => playback.seek(Number(seek.value)));
volume.addEventListener("input", () => { playback.setVolume(listeningVolume()); preview?.setVolume(listeningVolume()); });
speed.addEventListener("change", () => playback.setSpeed(Number(speed.value)));
function selectClip(changed) {
  let from = Number(clipStart.value), to = Number(clipEnd.value);
  if (from >= to) { if (changed === clipStart) to = Math.min(389, from + 1); from = Math.min(from, to - 1); }
  playback.setRange(from, to);
  document.getElementById("recording-link").hidden = true; recordingError.textContent = "";
}
clipStart.addEventListener("input", () => selectClip(clipStart));
clipEnd.addEventListener("input", () => selectClip(clipEnd));
for (const [id, direction] of [["days-back", -1], ["days-forward", 1]]) {
  document.getElementById(id).addEventListener("click", () => {
    dayCards.scrollBy({ left: direction * dayCards.clientWidth * 0.8, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });
}
dayCards.addEventListener("change", event => {
  event.target.closest(".day-card").scrollIntoView({ block: "nearest", inline: "nearest" });
  document.getElementById("recording-link").hidden = true; recordingError.textContent = "";
  selectDay(sessions);
});
preset.addEventListener("change", () => {
  try { playback.setPreset(selectedPreset()); } catch (cause) { showError(cause); }
});
pauseLive.addEventListener("click", () => { feed.stop(); playback.pause(); });
document.getElementById("preview-rewind").addEventListener("click", async () => {
  if (preview) { stopPreview(); renderRecording(); return; }
  const request = ++previewGeneration;
  const player = createRecordingPlayback(selectedClip, { volume: listeningVolume(), onChange: snapshot => {
    if (request !== previewGeneration) return;
    document.getElementById("preview-rewind").textContent = snapshot.state === "playing" || snapshot.state === "starting" ? "Stop preview" : "Preview";
    renderRecording();
    if (snapshot.reason === "replay-ended") stopPreview();
  } });
  preview = player;
  try { await player.play(); } catch (cause) { if (request === previewGeneration) { stopPreview(); showError(cause); } }
});
document.getElementById("resume-live").addEventListener("click", async () => {
  stopPreview(); selectedClip = null; resumeNeeded = false; lifecycleReason = "resume-live";
  try { const starting = playback.start({ retainHistory: true }); feed.start(); await starting; }
  catch (cause) { showError(cause); }
});

async function initialize() {
  try {
    if (location.hash.startsWith("#recording=")) await loadRecordingHash();
    sessions = await loadCatalog();
    renderDays(sessions);
    dayPicker.disabled = false;
    if (isDayLink(location.hash)) await openDayLink();
    else if (mode.value === "historical") await selectDay(sessions);
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
const stamp = () => new Date().toISOString().slice(0, 19).replace("T", "-").replaceAll(":", "");
download.addEventListener("click", async () => {
  const day = dayClip(), clip = day ? null : currentClip(), request = selection, features = currentFeatures;
  exporting = true; recordingError.textContent = ""; renderRecording();
  try {
    const blob = day ? await renderDayWav(features, day) : await renderWav(clip);
    if (request !== selection || (!day && clip !== currentClip())) return;
    const name = day ? `${day.sessionId}-${clock(day.from).replace(":", "")}-${clock(day.to + 1).replace(":", "")}`
      : mode.value === "recording" ? "shared-clip" : `btc-${stamp()}`;
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = `market-music-${name}.wav`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (cause) { recordingError.textContent = `WAV export failed: ${cause.message}`; }
  finally { exporting = false; renderRecording(); }
});
function confirmShare(message) {
  clearTimeout(feedbackTimer);
  shareFeedback.textContent = message;
  feedbackTimer = setTimeout(() => { shareFeedback.textContent = ""; }, 3000);
}
share.addEventListener("click", async () => {
  try {
    recordingError.textContent = "";
    const day = dayClip();
    const hash = day ? encodeDayLink(day) : encodeRecording(currentClip());
    if (!day) encodedSize = hash.length;
    const link = new URL(location.href); link.search = ""; link.hash = hash;
    const input = document.getElementById("recording-link");
    input.value = link.href; input.hidden = false; input.select();
    // Phones get the system share sheet; elsewhere the link is copied.
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      try { await navigator.share({ title: "Market as Music", url: link.href }); confirmShare("Shared ✓"); renderRecording(); return; }
      catch (cause) { if (cause.name === "AbortError") { renderRecording(); return; } }
    }
    if (navigator.clipboard) {
      try { await navigator.clipboard.writeText(link.href); confirmShare("Link copied ✓"); }
      catch { recordingError.textContent = "Select and copy the link below."; }
    }
    renderRecording();
  } catch (cause) { recordingError.textContent = cause.message.includes("64 KiB") ? "Selection exceeds 64 KiB. Shorten it to copy a link; WAV is still available." : cause.message; }
});
async function loadRecordingHash() {
  if (!location.hash.startsWith("#recording=")) return;
  try {
    const clip = decodeRecording(location.hash);
    sharedClip = clip; encodedSize = location.hash.length;
    document.getElementById("tab-recording").hidden = false;
    mode.value = "recording"; renderTabs(); await selectMode();
  } catch (cause) { recordingError.textContent = `Unable to open recording: ${cause.message}`; document.getElementById("recording-controls").hidden = false; }
}
async function openDayLink() {
  try { pendingDayLink = decodeDayLink(location.hash, sessions.map(session => session.id)); }
  catch (cause) {
    recordingError.textContent = `Unable to open link: ${cause.message}`;
    document.getElementById("recording-controls").hidden = false;
    if (mode.value === "historical") await selectDay(sessions);
    return;
  }
  // The link is applied once; later changes belong to the listener, not the address.
  history.replaceState(null, "", location.pathname + location.search);
  checkDay(pendingDayLink.sessionId);
  // Each mode lists its four sounds in the same order, so the card position carries over.
  preset.querySelectorAll("input")[PRESETS.findIndex(value => value.id === pendingDayLink.presetId)].checked = true;
  if (mode.value === "historical") await selectDay(sessions);
  else { mode.value = "historical"; renderTabs(); await selectMode(); }
}
window.addEventListener("hashchange", () => {
  if (!isDayLink(location.hash)) loadRecordingHash();
  else if (sessions) openDayLink().catch(showError);
});
initialize();
