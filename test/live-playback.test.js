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
    tick(price = 100, connectionId = 1) { player.accept({ price, mid: price, spread: 0, connectionId, exchangeTimeMs: time }); },
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
  assert.ok(s.player.inspect().audio.activeToneFrames > 0);
  s.player.stop(); assert.equal(s.active(), false);
  assert.equal(s.player.inspect().audio.activeVoices, 0);
  await s.player.dispose();
});

test("switch replaces lookahead audio with the new preset without moving the live deadline or source history", async () => {
  const s = setup(); await s.player.start(); s.tick(100);
  s.advance(499); s.tick(110); s.advance(4426);
  assert.equal(s.captures.get("1:0").presetId, "classic-v2");
  const source = structuredClone(s.frames[0]);
  s.player.setPreset("bass-heavy-v2");
  const captured = s.captures.get("1:0");
  assert.deepEqual(s.cancellations, ["1:0"]);
  assert.equal(captured.presetId, "bass-heavy-v2");
  assert.equal(captured.mapping.note, 48);
  assert.equal(captured.playbackOffsetMs, 5000);
  assert.equal(captured.when, 15);
  assert.deepEqual(s.frames[0], source);
  s.advance(75);
  assert.equal(s.player.inspect().audible.mapping.presetId, "bass-heavy-v2");
  assert.equal(s.player.inspect().delayedCursorMs, 0);
  s.player.setPreset("plucky-v2");
  assert.equal(s.player.inspect().audible.mapping.presetId, "bass-heavy-v2");
  s.advance(500);
  assert.equal(s.player.inspect().audible.mapping.presetId, "plucky-v2");
  assert.equal(s.player.inspect().segmentId, 1);
  s.player.setConnection({ state: "reconnecting", reason: "closed" });
  assert.equal(s.player.inspect().presetId, "plucky-v2");
  s.player.stop(); await s.player.start();
  assert.equal(s.player.inspect().presetId, "plucky-v2");
  await s.player.dispose();
});

test("cutoff-boundary ticks never play early and empty intervals carry mid", async () => {
  const s = setup(); await s.player.start(); s.tick(100);
  s.advance(499); s.tick(110); s.advance(2); s.tick(120);
  s.advance(4499);
  assert.equal(s.player.inspect().audible.price, 100);
  s.advance(500); assert.equal(s.player.inspect().audible.price, 110);
  s.advance(500); assert.equal(s.player.inspect().audible.price, 120);
  s.advance(500); assert.equal(s.player.inspect().audible.price, 120);
  assert.equal(s.player.inspect().latest.carried, true);
  await s.player.dispose();
});

test("trade bins use source cutoffs, stay immutable and reset with reconnect", async () => {
  const s = setup(); await s.player.start(); s.tick(60000);
  s.advance(100);
  for (let n = 0; n < 20; n++) s.player.acceptTrade({ connectionId: 1, size: 0.1, exchangeTimeMs: 100, aggressor: 1 });
  s.tick(60000.01); s.advance(400);
  s.advance(4900);
  const source = s.frames[1];
  assert.equal(source.tradeCount, 20); assert.equal(source.tradeSize, 2.0000000000000004);
  assert.equal(source.mapping.mask, 15);
  const saved = structuredClone(source);
  s.advance(1); s.player.acceptTrade({ connectionId: 1, size: 3, exchangeTimeMs: 100, aggressor: 1 });
  s.advance(499); assert.equal(s.frames[2].tradeCount, 0);
  assert.deepEqual(s.frames[1], saved);
  assert.equal(s.player.inspect().aggregate.lateTrades, 1);
  assert.equal(s.player.inspect().audible.playbackOffsetMs - source.sessionOffsetMs, 5000);
  s.player.setConnection({ state: "reconnecting", reason: "lost" });
  s.player.acceptTrade({ connectionId: 1, size: 100 });
  s.tick(61000, 2);
  s.advance(4900);
  assert.equal(s.frames.at(-1).tradeCount, 0); assert.equal(s.frames.at(-1).degree, 7);
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

test("late batches enter their exchange beat until scheduling freezes the frame", async () => {
  const s = setup(); await s.player.start(); s.tick(100);
  s.advance(5399);
  assert.equal(s.frames.length, 1);
  s.player.acceptTrade({ connectionId: 1, exchangeTimeMs: 125, size: 2, aggressor: 1 });
  s.player.acceptTrade({ connectionId: 1, exchangeTimeMs: 375, size: 1, aggressor: -1 });
  s.advance(1);
  const frame = s.frames[1], saved = structuredClone(frame);
  assert.equal(frame.tradeCount, 2);
  assert.equal(frame.tradeSize, 3);
  assert.equal(frame.playbackOffsetMs, 5500);
  s.player.acceptTrade({ connectionId: 1, exchangeTimeMs: 125, size: 100, aggressor: -1 });
  s.player.setPreset("plucky-v2");
  assert.deepEqual(s.frames[1], saved);
  assert.equal(s.player.inspect().aggregate.lateTrades, 1);
  assert.equal(s.captures.get("1:1").when, 15.5);
  await s.player.dispose();
});

test("late timers skip expired audio without shifting the delay; queues and visible history stay bounded", async () => {
  const s = setup(); await s.player.start(); s.tick(100);
  s.jump(60000);
  assert.equal(s.player.inspect().audio.lastScheduled.when, 70);
  assert.equal(s.captures.size, 1);
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
  s.context.resume = () => new Promise(done => { resolve = () => { s.context.state = "running"; done(); }; });
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
