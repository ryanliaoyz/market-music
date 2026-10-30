import { test } from "node:test";
import assert from "node:assert/strict";
import { createVisuals } from "../src/visuals.js";
import { createPlayback } from "../src/playback.js";
import { computeFeatures } from "../src/features.js";
import { parseSessionCsv } from "../src/data.js";
import { readFile } from "node:fs/promises";
import { AudioContext } from "./helpers/audio.js";

function chart() {
  const nodes = new Map();
  return {
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, {
        attributes: {}, textContent: "",
        setAttribute(name, value) { this.attributes[name] = String(value); },
      });
      return nodes.get(selector);
    },
    node(id) { return this.querySelector(`[data-visual="${id}"]`); },
  };
}

const features = {
  session: { id: "visual-fixture" }, openingGapReturn: -0.02,
  bars: [
    { minute: 0, close: 100, rollingVolatility: null, event: null },
    { minute: 1, close: 110, rollingVolatility: 0.1, event: "spike" },
    { minute: 3, close: 90, rollingVolatility: 0.05, event: "drop" },
  ],
};
const snapshot = (position, state = "playing") => ({
  position, minute: Math.min(389, Math.floor(position)), state,
  waiting: state === "playing" ? "audio-clock" : null, reason: "test",
});

test("price line uses exchange-minute coordinates, breaks at gaps, and reveals only elapsed time", () => {
  const svg = chart();
  const visuals = createVisuals(features, svg);
  const path = svg.node("line").attributes.d;
  assert.match(path, /^M60,144 L/);
  assert.equal(path.split("M").length - 1, 2);
  assert.equal(path.split("L").length - 1, 1);
  assert.equal(svg.node("high").textContent, "110.00");
  assert.equal(svg.node("low").textContent, "90.00");
  visuals.render(snapshot(1.25));
  assert.equal(visuals.inspect().close, 110);
  assert.equal(visuals.inspect().intensity, 1);
  assert.equal(svg.node("point").attributes.cy, "24");
  assert.ok(Number(svg.node("reveal").attributes.width) < 3);
  visuals.render(snapshot(2.25));
  assert.equal(visuals.inspect().close, null);
  assert.equal(visuals.inspect().intensity, 0);
  assert.equal(visuals.inspect().flash, 0);
  assert.equal(svg.node("point").attributes.visibility, "hidden");
  assert.match(svg.node("description").textContent, /no observed bar/);
  visuals.render(snapshot(390, "ended"));
  assert.equal(Number(svg.node("cursor").attributes.x1), 750);
  assert.equal(svg.node("point").attributes.visibility, "hidden");
});

test("event flashes follow beat phase, distinguish direction, and clear on pause/seek/end", () => {
  const svg = chart();
  const visuals = createVisuals(features, svg);
  visuals.render(snapshot(0));
  assert.equal(visuals.inspect().flash, 0);
  visuals.render(snapshot(0.1));
  assert.equal(visuals.inspect().event, "opening");
  assert.equal(visuals.inspect().flash, 0.8);
  visuals.render(snapshot(1.25));
  assert.equal(visuals.inspect().event, "spike");
  assert.equal(visuals.inspect().flash, 0.5);
  const spike = svg.node("flash").attributes.fill;
  visuals.render(snapshot(1.75));
  assert.equal(visuals.inspect().flash, 0);
  visuals.render(snapshot(3.25));
  assert.equal(visuals.inspect().intensity, 0.5);
  assert.notEqual(svg.node("flash").attributes.fill, spike);
  for (const state of ["paused", "starting", "ended", "disposed"]) {
    visuals.render(snapshot(3, state));
    assert.equal(visuals.inspect().flash, 0);
    assert.equal(svg.node("flash").attributes.opacity, "0");
  }
  visuals.render(snapshot(0, "paused"));
  assert.equal(svg.node("reveal").attributes.width, "0");
});

test("flat and zero-volatility sessions have finite coordinates and a calm background", () => {
  const svg = chart();
  const visuals = createVisuals({ ...features, openingGapReturn: 0, bars: [
    { minute: 0, close: 100, rollingVolatility: 0, event: null },
  ] }, svg);
  visuals.render(snapshot(0.1));
  assert.equal(svg.node("point").attributes.cy, "144");
  assert.equal(visuals.inspect().intensity, 0);
  assert.equal(visuals.inspect().event, null);
  assert.equal(svg.node("background").attributes.fill, "hsl(220 45% 12%)");
});

test("real playback drives visuals from audible bars rather than lookahead, across controls and sessions", async () => {
  const csv = await readFile(new URL("./fixtures/features.csv", import.meta.url), "utf8");
  const session = computeFeatures(parseSessionCsv(csv, {
    id: "fixture", date: "2025-01-02", barCount: 21, previousClose: 125,
  }));
  const svg = chart();
  const visuals = createVisuals(session, svg);
  const context = new AudioContext();
  let tick;
  const playback = createPlayback(session, {
    context, setInterval(callback) { tick = callback; return 1; }, clearInterval() {},
    onChange: value => visuals.render(value),
  });
  await playback.play();
  context.currentTime = 10.27;
  tick();
  assert.equal(playback.inspect().audio.lastScheduled.minute, 1);
  assert.equal(visuals.inspect().minute, 0);
  context.currentTime = 10.36;
  tick();
  assert.equal(visuals.inspect().minute, 1);
  assert.equal(visuals.inspect().close, session.bars[1].close);
  playback.seek(2);
  assert.equal(visuals.inspect().event, "drop");
  assert.equal(visuals.inspect().flash, 0);
  context.currentTime += 0.06;
  tick();
  assert.ok(visuals.inspect().flash > 0);
  playback.pause();
  assert.equal(visuals.inspect().flash, 0);
  playback.seek(session.missingMinutes[0]);
  assert.equal(visuals.inspect().close, null);
  playback.setSpeed(4);
  await playback.play();
  context.currentTime += 60;
  tick();
  assert.equal(visuals.inspect().state, "ended");
  assert.equal(visuals.inspect().position, 390);
  await playback.play();
  assert.equal(visuals.inspect().position, 0);
  await playback.dispose();
  const replacement = createVisuals(features, svg);
  replacement.render(snapshot(0, "paused"));
  assert.equal(replacement.inspect().session, "visual-fixture");
  assert.equal(svg.node("reveal").attributes.width, "0");
});
