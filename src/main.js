import { loadCatalog, loadSession } from "./data.js";
import { computeFeatures } from "./features.js";
import { createPlayback } from "./playback.js";
import { createVisuals, createLiveVisuals } from "./visuals.js";
import { createDebugPanel, createLiveDebugPanel } from "./debug.js";
import { createLiveFeed } from "./live-feed.js";
import { createLivePlayback } from "./live-playback.js";

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
const mode = document.getElementById("mode");
const feedDebug = document.getElementById("feed-debug");
let feed = null;
let sessions = null;

function showError(cause) {
  error = cause.message;
  status.textContent = `Unable to play: ${error}. ${mode.value === "live" ? "Press Stop, then Start to retry." : "Try selecting the day again or pressing Play."}`;
}

function render(snapshot) {
  visuals?.render(snapshot);
  debug?.render(snapshot);
  if (snapshot.mode === "live") {
    play.textContent = snapshot.active ? "Stop" : "Start";
    mode.disabled = snapshot.active;
    const messages = { stopped: "Live crypto ready. Press Start to subscribe.", starting: "Starting audio…",
      waiting: "Waiting for the first BTC-USD price…", buffering: "Buffering · 5 seconds…",
      playing: "Playing · 5 s delayed · BTC-USD · Coinbase", reconnecting: "Connection lost. Reconnecting to Coinbase…",
      error: `Live unavailable: ${snapshot.audioError ?? error ?? feed?.inspect().error ?? snapshot.reason}. Press Stop, then Start to retry.` };
    status.textContent = messages[snapshot.state] ?? snapshot.state;
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
    visuals: visuals?.inspect() ?? null, debug: debug?.inspect() ?? null }),
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
    playback = createPlayback(features, { onChange: render });
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
  const request = ++selection;
  feed?.stop(); feed = null;
  const previous = playback;
  playback = visuals = debug = null;
  controls.disabled = true; chart.hidden = debugPanel.hidden = true;
  loading = true; error = null;
  const live = mode.value === "live";
  configureMode(live);
  await previous?.dispose();
  if (request !== selection) return;
  if (!live) {
    if (sessions) await selectDay(sessions);
    else { loading = false; status.textContent = "Historical catalog unavailable or still loading. Live crypto is available."; }
    return;
  }
  visuals = createLiveVisuals(chart);
  debug = createLiveDebugPanel(debugPanel);
  playback = createLivePlayback({ onChange: snapshot => { if (request === selection) render(snapshot); } });
  feed = createLiveFeed({
    onTick: tick => { if (request === selection) playback.accept(tick); },
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

try {
  sessions = await loadCatalog();
  for (const session of sessions) {
    day.add(new Option(`${session.symbol} · ${session.date} · ${session.title}`, session.id));
  }
  day.disabled = false;
  day.addEventListener("change", () => selectDay(sessions));
  if (mode.value === "historical") await selectDay(sessions);
} catch (cause) {
  if (mode.value === "historical") { loading = false; showError(cause); }
}
