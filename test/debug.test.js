import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDebugPanel, createLiveDebugPanel } from "../src/debug.js";
import { createLiveFeatures } from "../src/live-features.js";
import { createPlayback } from "../src/playback.js";
import { computeFeatures } from "../src/features.js";
import { parseSessionCsv } from "../src/data.js";
import { AudioContext } from "./helpers/audio.js";

function panel() {
  const nodes = new Map();
  return {
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, { textContent: "" });
      return nodes.get(selector);
    },
    text(id) { return this.querySelector(`[data-debug="${id}"]`).textContent; },
  };
}

test("live debug shows UTC previews and the actual audible frame, clearing rests", () => {
  const root = panel(), debug = createLiveDebugPanel(root), features = createLiveFeatures();
  features.accept({ price: 100, connectionId: 1, exchangeTimeMs: Date.parse("2026-10-30T12:00:00Z") });
  const latest = features.sample(0);
  const snapshot = { latest, state: "paused", waiting: null, reason: "test", policy: "live-v1" };
  debug.render(snapshot);
  assert.match(root.text("bar"), /12:00:00.000 UTC/);
  assert.equal(root.text("gain"), "0.1100");
  assert.equal(debug.inspect().note, latest.mapping.note);
  debug.render({ ...snapshot, state: "playing", audible: null });
  assert.equal(root.text("note"), "n/a");
  debug.render({ ...snapshot, state: "playing", audible: latest });
  assert.equal(debug.inspect().frameId, latest.id);
  const copy = debug.inspect(); copy.references.low = -1;
  assert.equal(debug.inspect().references.low, 100);
});

const csv = await readFile(new URL("./fixtures/features.csv", import.meta.url), "utf8");
const features = computeFeatures(parseSessionCsv(csv, {
  id: "fixture", date: "2025-01-02", barCount: 21, previousClose: 125,
}));
const snapshot = (minute, state = "paused") => ({
  minute, position: minute, state, waiting: null, reason: "seek", audio: null,
});

test("panel formats actual mappings, null returns, multiple rules and preview reasons", () => {
  const root = panel();
  const debug = createDebugPanel(features, root);
  assert.equal(debug.inspect(), null);
  debug.render(snapshot(0));
  assert.match(root.text("state"), /paused · mapping preview/);
  assert.match(root.text("bar"), /09:30 · minute 0 · bar 0/);
  assert.equal(root.text("return"), "n/a");
  assert.equal(root.text("rules"), "opening-gong");
  assert.equal(root.text("drive"), "0.0000");
  assert.equal(root.text("waiting"), "none");
  assert.equal(root.text("reason"), "seek");
  debug.render(snapshot(1));
  assert.equal(root.text("return"), "12.5000%");
  assert.equal(root.text("sigma"), `${(features.sigma * 100).toFixed(4)}%`);
  assert.equal(root.text("note"), "C6 (MIDI 84)");
  assert.equal(root.text("gain"), "0.0000");
  assert.ok(debug.inspect().drive > 0);
  debug.render(snapshot(2));
  assert.equal(root.text("return"), "-12.5000%");
  assert.equal(root.text("gain"), "0.0643");
  assert.equal(root.text("drive"), "24.0000");
  assert.equal(root.text("rules"), "down-tritone, drop-crash");
  const inspected = debug.inspect();
  inspected.rules.push("mutated");
  assert.deepEqual(debug.inspect().rules, ["down-tritone", "drop-crash"]);
});

test("historical preview follows preset mapping instead of a stale default score", () => {
  const debug = createDebugPanel(features, panel());
  debug.render({ ...snapshot(0), presetId: "bass-heavy-v1" });
  assert.equal(debug.inspect().presetId, "bass-heavy-v1");
  assert.equal(debug.inspect().root, 36);
  debug.render({ ...snapshot(0), presetId: "plucky-v1" });
  assert.deepEqual(debug.inspect().scale, [0, 2, 4, 7, 9]);
});

test("rests, end and replacement sessions clear values without confusing zero with missing", () => {
  const root = panel();
  const debug = createDebugPanel(features, root);
  debug.render(snapshot(2));
  debug.render(snapshot(features.missingMinutes[0]));
  assert.match(root.text("bar"), /rest — no observed bar/);
  for (const field of ["return", "note", "gain", "drive"]) assert.equal(root.text(field), "n/a");
  assert.equal(root.text("rules"), "none");
  assert.notEqual(root.text("sigma"), "n/a");
  debug.render(snapshot(389, "ended"));
  assert.equal(root.text("bar"), "No current bar");
  assert.equal(debug.inspect().barIndex, null);
  const replacement = createDebugPanel({
    session: { id: "flat" }, sigma: 0, openingGapReturn: 0,
    bars: [{ minute: 0, close: 100, volume: 0, return: 0, rollingVolatility: 0, vwap: null, event: null }],
  }, root);
  replacement.render(snapshot(0));
  assert.equal(replacement.inspect().session, "flat");
  assert.equal(root.text("sigma"), "0.0000%");
  assert.equal(root.text("return"), "0.0000%");
  assert.equal(root.text("gain"), "0.0000");
  assert.equal(root.text("drive"), "0.0000");
  assert.equal(root.text("rules"), "none");
  const unavailable = createDebugPanel({ ...features, sigma: null }, root);
  unavailable.render(snapshot(0));
  assert.equal(root.text("sigma"), "n/a");
});

test("real playback drives current mapping, not lookahead, through controls and replay", async () => {
  const root = panel();
  const debug = createDebugPanel(features, root);
  const context = new AudioContext();
  let tick;
  const playback = createPlayback(features, {
    context, setInterval(callback) { tick = callback; return 1; }, clearInterval() {},
    onChange: value => debug.render(value),
  });
  await playback.play();
  context.currentTime = 10.27;
  tick();
  assert.equal(playback.inspect().audio.lastScheduled.minute, 1);
  assert.equal(debug.inspect().minute, 0);
  assert.equal(root.text("rules"), "opening-gong");
  assert.equal(root.text("waiting"), "audio-clock");
  context.currentTime = 10.36;
  tick();
  assert.equal(debug.inspect().minute, 1);
  assert.equal(root.text("rules"), "up-major-third, spike-bell");
  playback.pause();
  playback.seek(2);
  assert.match(root.text("state"), /mapping preview/);
  assert.equal(root.text("rules"), "down-tritone, drop-crash");
  playback.setSpeed(4);
  assert.equal(root.text("reason"), "speed-change");
  await playback.play();
  context.currentTime += 60;
  tick();
  assert.equal(debug.inspect().state, "ended");
  assert.equal(root.text("rules"), "none");
  await playback.play();
  assert.equal(debug.inspect().minute, 0);
  assert.equal(root.text("rules"), "opening-gong");
  await playback.dispose();
  assert.equal(debug.inspect().barIndex, null);
});
