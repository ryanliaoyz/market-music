import { test } from "node:test";
import assert from "node:assert/strict";
import { createLivePlayback } from "../src/live-playback.js";
import { AudioContext } from "./helpers/audio.js";
import { fakeTone } from "./helpers/tone.js";

function setup() {
  let time = 0, callback, active = false;
  const context = new AudioContext(), ticks = [], frames = [], captures = new Map(), cancellations = [];
  const player = createLivePlayback({ context, tone: fakeTone(), now: () => time,
    setInterval(fn) { callback = fn; active = true; return 1; }, clearInterval() { active = false; },
    onTick: t => ticks.push(t), onFrame: f => frames.push(f),
    onSchedule: frame => captures.set(frame.scheduleId, frame),
    onCancel: id => { cancellations.push(id); captures.delete(id); } });
  function jump(ms) { time += ms; context.currentTime = 10 + time / 1000; if (active) callback(); }
  return { player, context, ticks, frames, captures, cancellations, jump,
    advance(ms) { while (ms > 0) { const step = Math.min(ms, 25); jump(step); ms -= step; } },
    tick(price = 100, connectionId = 1) { player.accept({ price, connectionId, exchangeTimeMs: time }); },
    active: () => active };
}

test("Start buffers five seconds from first tick, then maps and plays the delayed receive timeline", async () => {
  const s = setup();
  assert.equal(s.active(), false); assert.equal(s.player.inspect().state, "stopped");
  await s.player.start(); s.advance(1000);
  assert.equal(s.player.inspect().waiting, "first-price");
  s.tick(100); s.advance(100); s.tick(110); s.advance(100); s.tick(120);
  s.advance(4700);
  assert.equal(s.player.inspect().state, "buffering");
  assert.equal(s.player.inspect().frames.length, 0);
  assert.equal(s.player.inspect().audio.lastScheduled.when, 16);
  s.advance(100);
  assert.equal(s.player.inspect().state, "playing");
  assert.equal(s.player.inspect().audible.price, 100);
  assert.equal(s.player.inspect().audio.lastScheduled.gain, 0.11);
  s.advance(500);
  assert.equal(s.player.inspect().audible.price, 120);
  assert.ok(Math.abs(s.player.inspect().audible.return - 0.2) < 1e-12);
  assert.equal(s.ticks.length, 3);
  assert.equal(s.frames[0].playbackOffsetMs - s.frames[0].sessionOffsetMs, 5000);
  assert.ok(s.context.nodes.some(node => node.kind === "oscillator"));
  s.player.stop(); assert.equal(s.active(), false);
  assert.equal(s.player.inspect().audio.activeVoices, 0);
  await s.player.dispose();
});

test("switch replaces lookahead audio with the new preset without moving the live deadline or source history", async () => {
  const s = setup(); await s.player.start(); s.tick(100);
  s.advance(499); s.tick(110); s.advance(4426);
  assert.equal(s.captures.get("1:0").presetId, "classic-v1");
  const source = structuredClone(s.frames[0]);
  s.player.setPreset("bass-heavy-v1");
  const captured = s.captures.get("1:0");
  assert.deepEqual(s.cancellations, ["1:0"]);
  assert.equal(captured.presetId, "bass-heavy-v1");
  assert.equal(captured.mapping.note, 55);
  assert.equal(captured.playbackOffsetMs, 5000);
  assert.equal(captured.when, 15);
  assert.deepEqual(s.frames[0], source);
  s.advance(75);
  assert.equal(s.player.inspect().audible.mapping.presetId, "bass-heavy-v1");
  assert.equal(s.player.inspect().delayedCursorMs, 0);
  s.player.setPreset("plucky-v1");
  assert.equal(s.player.inspect().audible.mapping.presetId, "bass-heavy-v1");
  s.advance(500);
  assert.equal(s.player.inspect().audible.mapping.presetId, "plucky-v1");
  assert.equal(s.player.inspect().segmentId, 1);
  s.player.setConnection({ state: "reconnecting", reason: "closed" });
  assert.equal(s.player.inspect().presetId, "plucky-v1");
  s.player.stop(); await s.player.start();
  assert.equal(s.player.inspect().presetId, "plucky-v1");
  await s.player.dispose();
});

test("cutoff-boundary ticks never play early and empty intervals are rests", async () => {
  const s = setup(); await s.player.start(); s.tick(100);
  s.advance(499); s.tick(110); s.advance(2); s.tick(120);
  s.advance(4499);
  assert.equal(s.player.inspect().audible.price, 100);
  s.advance(500); assert.equal(s.player.inspect().audible.price, 110);
  s.advance(500); assert.equal(s.player.inspect().audible.price, 120);
  s.advance(500); assert.equal(s.player.inspect().audible, null);
  assert.equal(s.player.inspect().latest.price, null);
  await s.player.dispose();
});

test("quiet ticker stays playing; reconnect clears the old segment and refills five seconds", async () => {
  const s = setup(); await s.player.start(); s.tick(100); s.advance(5000);
  s.player.setConnection({ state: "waiting", reason: "stale-price" });
  assert.equal(s.player.inspect().state, "playing");
  s.player.setConnection({ state: "reconnecting", reason: "closed" });
  assert.equal(s.player.inspect().audio.activeVoices, 0);
  assert.equal(s.player.inspect().frames.length, 0);
  s.advance(1000); s.tick(200, 2); s.advance(4999);
  assert.equal(s.player.inspect().state, "buffering");
  assert.equal(s.player.inspect().audible, null);
  s.advance(1);
  assert.equal(s.player.inspect().audible.price, 200);
  assert.equal(s.player.inspect().audible.return, null);
  assert.equal(s.player.inspect().segmentId, 2);
  await s.player.dispose();
});

test("late timers skip expired audio without shifting the delay; queues and visible history stay bounded", async () => {
  const s = setup(); await s.player.start(); s.tick(100);
  s.jump(60000);
  assert.equal(s.player.inspect().audio.lastScheduled, null);
  assert.ok(s.player.inspect().queueSize <= 12);
  for (let i = 0; i < 300; i++) { s.tick(100 + i); s.advance(500); }
  assert.ok(s.player.inspect().frames.length <= 120);
  const state = s.player.inspect();
  assert.equal(state.audio.lastScheduled.when, 10 + (state.audible.playbackOffsetMs / 1000));
  assert.equal(state.newestReceived.elapsedMs - state.delayedCursorMs, 4500);
  await s.player.dispose();
});

test("Stop cancels pending resume/buffer; restart creates a fresh session; errors propagate", async () => {
  const s = setup(); let resolve;
  s.context.resume = () => new Promise(done => { resolve = done; });
  const starting = s.player.start(); s.tick(); s.player.stop(); resolve(); await starting;
  s.player.accept({ price: 999, connectionId: 1 });
  assert.equal(s.player.inspect().state, "stopped"); assert.equal(s.player.inspect().newestReceived, null);
  s.context.resume = async () => { s.context.state = "running"; };
  await s.player.start(); s.tick(110); s.advance(4999);
  assert.equal(s.player.inspect().audible, null); s.advance(1);
  assert.equal(s.player.inspect().audible.price, 110);
  await s.player.dispose(); assert.equal(s.active(), false);
  const other = setup(); other.context.resume = () => Promise.reject(new Error("blocked"));
  await assert.rejects(other.player.start(), /blocked/);
  assert.equal(other.player.inspect().state, "error"); assert.equal(other.player.inspect().active, true);
  other.tick(); other.player.setConnection({ state: "live", reason: "price-received" }); other.advance(1000);
  assert.equal(other.player.inspect().state, "error");
  assert.equal(other.player.inspect().audioError, "blocked");
  assert.equal(other.player.inspect().waiting, null);
  other.player.setConnection({ state: "reconnecting", reason: "closed" }); other.tick(200, 2);
  assert.equal(other.player.inspect().state, "error");
  assert.equal(other.player.inspect().reason, "audio-resume-failed");
  await other.player.dispose();
});
