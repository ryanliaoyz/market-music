import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseSessionCsv } from "../src/data.js";
import { computeFeatures } from "../src/features.js";
import { createPlayback } from "../src/playback.js";
import { AudioContext } from "./helpers/audio.js";

const csv = await readFile(new URL("./fixtures/features.csv", import.meta.url), "utf8");
const features = computeFeatures(parseSessionCsv(csv, {
  id: "fixture", date: "2025-01-02", barCount: 21, previousClose: 125,
}));

function setup() {
  const context = new AudioContext();
  let tick;
  let active = false;
  const playback = createPlayback(features, {
    context,
    setInterval(callback, milliseconds) {
      assert.equal(milliseconds, 25);
      tick = callback;
      active = true;
      return 1;
    },
    clearInterval() { active = false; },
  });
  return { context, playback, advance(time) {
    context.currentTime = time;
    if (active) tick();
  }, active: () => active };
}

test("audio clock schedules ahead while cursor reflects audible, not queued, minute", async () => {
  const { context, playback, advance } = setup();
  assert.equal(playback.inspect().audio, null);
  await playback.play();
  assert.equal(playback.inspect().speed, 1.625);
  assert.equal(playback.inspect().audio.lastScheduled.when, 10.03);
  assert.equal(playback.inspect().minute, 0);
  assert.ok(playback.inspect().audio.lastScheduled.rules.includes("opening-gong"));
  advance(10.27);
  assert.equal(playback.inspect().minute, 0);
  assert.equal(playback.inspect().audio.lastScheduled.minute, 1);
  assert.ok(Math.abs(playback.inspect().audio.lastScheduled.when - 10.337692307692308) < 1e-12);
  advance(10.36);
  assert.equal(playback.inspect().minute, 1);
  playback.pause();
  assert.equal(playback.inspect().audio.activeVoices, 0);
  assert.equal(playback.inspect().audio.droneActive, false);
  context.currentTime = 50;
  assert.equal(playback.inspect().minute, 1);
  await playback.play();
  assert.equal(playback.inspect().audio.lastScheduled.minute, 1);
  await playback.dispose();
});

test("seek and speed cancel queued sounds and restart the current minute", async () => {
  const { playback, active } = setup();
  await playback.play();
  playback.seek(2);
  assert.equal(playback.inspect().audio.lastScheduled.minute, 2);
  assert.ok(playback.inspect().audio.lastScheduled.rules.includes("drop-crash"));
  playback.setSpeed(4);
  assert.equal(playback.inspect().audio.lastScheduled.duration, 0.125);
  assert.equal(playback.inspect().reason, "speed-change");
  playback.pause();
  playback.seek(1);
  assert.equal(playback.inspect().state, "paused");
  assert.equal(active(), false);
  assert.equal(playback.inspect().audio.activeVoices, 0);
  assert.throws(() => playback.seek(-1), RangeError);
  assert.throws(() => playback.seek(390), RangeError);
  assert.throws(() => playback.setSpeed(0), RangeError);
  await playback.dispose();
});

test("missing exchange minutes are silent rests and delayed timers skip overdue beats", async () => {
  const { playback, advance, context } = setup();
  const missing = features.missingMinutes[0];
  playback.seek(missing);
  await playback.play();
  assert.equal(playback.inspect().barIndex, null);
  assert.equal(playback.inspect().audio.activeVoices, 0);
  assert.equal(playback.inspect().audio.lastScheduled, null);
  playback.seek(0);
  const voices = context.nodes.length;
  advance(20);
  assert.equal(context.nodes.length, voices);
  assert.ok(playback.inspect().minute > 20);
  await playback.dispose();
});

test("full session ends at two minutes, stops all sound, and Play replays the opening", async () => {
  const { playback, advance, active } = setup();
  await playback.play();
  advance(130.029);
  assert.equal(playback.inspect().state, "playing");
  advance(130.031);
  assert.equal(playback.inspect().state, "ended");
  assert.equal(playback.inspect().position, 390);
  assert.equal(playback.inspect().audio.activeVoices, 0);
  assert.equal(active(), false);
  await playback.play();
  assert.equal(playback.inspect().minute, 0);
  assert.ok(playback.inspect().audio.lastScheduled.rules.includes("opening-gong"));
  await playback.dispose();
});

test("changing speed after the end preserves the end cursor and replays the whole day", async () => {
  const { playback, advance, active } = setup();
  await playback.play();
  advance(131);
  playback.setSpeed(4);
  assert.equal(playback.inspect().state, "ended");
  assert.equal(playback.inspect().position, 390);
  assert.equal(active(), false);
  await playback.play();
  assert.equal(playback.inspect().minute, 0);
  assert.equal(playback.inspect().audio.lastScheduled.minute, 0);
  assert.equal(playback.inspect().audio.lastScheduled.duration, 0.125);
  await playback.dispose();
});

test("pause, seek, speed change, and disposal invalidate a pending audio resume", async () => {
  for (const action of [p => p.pause(), p => p.seek(5), p => p.setSpeed(2), p => p.dispose()]) {
    const { context, playback, active } = setup();
    let resume;
    context.resume = () => new Promise(resolve => { resume = resolve; });
    const pending = playback.play();
    assert.equal(playback.inspect().waiting, "audio-resume");
    await action(playback);
    resume();
    await pending;
    assert.notEqual(playback.inspect().state, "playing");
    assert.equal(playback.inspect().audio.activeVoices, 0);
    assert.equal(active(), false);
    await playback.dispose();
  }
});

test("a failed resume is reported and Play can retry", async () => {
  const { context, playback } = setup();
  context.resume = async () => { throw new Error("Audio unavailable"); };
  await assert.rejects(playback.play(), /Audio unavailable/);
  assert.equal(playback.inspect().reason, "resume-failed");
  context.resume = async () => { context.state = "running"; };
  await playback.play();
  assert.equal(playback.inspect().state, "playing");
  await playback.dispose();
});
