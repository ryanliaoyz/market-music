import { loadCatalog, loadSession } from "./data.js";
import { computeFeatures } from "./features.js";
import { createPlayback } from "./playback.js";

const day = document.getElementById("day");
const controls = document.getElementById("controls");
const play = document.getElementById("play");
const speed = document.getElementById("speed");
const seek = document.getElementById("seek");
const time = document.getElementById("time");
const status = document.getElementById("status");
let playback = null;
let selection = 0;
let loading = true;
let error = null;

function showError(cause) {
  error = cause.message;
  status.textContent = `Unable to play: ${error}. Try selecting the day again or pressing Play.`;
}

function render(snapshot) {
  play.textContent = ["playing", "starting"].includes(snapshot.state) ? "Pause" : "Play";
  seek.value = snapshot.minute;
  speed.value = snapshot.speed;
  const wallMinute = 570 + snapshot.minute;
  time.textContent = snapshot.state === "ended" ? "16:00 — End" :
    `${String(Math.floor(wallMinute / 60)).padStart(2, "0")}:${String(wallMinute % 60).padStart(2, "0")}`;
  seek.setAttribute("aria-valuetext", time.textContent);
}

window.marketMusic = {
  inspect: () => ({ selectedSession: day.value, loading, error, playback: playback?.inspect() ?? null }),
};

async function selectDay(sessions) {
  const request = ++selection;
  loading = true;
  error = null;
  controls.disabled = true;
  status.textContent = "Loading session…";
  const previous = playback;
  playback = null;
  try {
    await previous?.dispose();
    const features = computeFeatures(await loadSession(sessions.find(session => session.id === day.value)));
    if (request !== selection) return;
    playback = createPlayback(features, { onChange: render });
    render(playback.inspect());
    controls.disabled = false;
    status.textContent = `${features.session.title} · ${features.bars.length} observed minutes`;
  } catch (cause) {
    if (request === selection) showError(cause);
  } finally {
    if (request === selection) loading = false;
  }
}

play.addEventListener("click", async () => {
  const current = playback;
  const request = selection;
  try {
    if (["playing", "starting"].includes(current.inspect().state)) current.pause();
    else {
      error = null;
      status.textContent = day.selectedOptions[0].textContent;
      await current.play();
    }
  } catch (cause) {
    if (request === selection) showError(cause);
  }
});
seek.addEventListener("input", () => playback.seek(Number(seek.value)));
speed.addEventListener("change", () => playback.setSpeed(Number(speed.value)));

try {
  const sessions = await loadCatalog();
  for (const session of sessions) {
    day.add(new Option(`${session.symbol} · ${session.date} · ${session.title}`, session.id));
  }
  day.disabled = false;
  day.addEventListener("change", () => selectDay(sessions));
  await selectDay(sessions);
} catch (cause) {
  loading = false;
  showError(cause);
}
