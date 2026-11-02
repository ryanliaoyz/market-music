import test from "node:test";
import assert from "node:assert/strict";
import { createRewindBuffer } from "../src/rewind-buffer.js";
import { createLiveEventSource, LIVE_EVENT_PRESETS } from "../src/live-events.js";
import { validateEventScore } from "../src/event-score.js";
import { encodeRecording, decodeRecording } from "../src/recording-codec.js";
import { createLivePlayback } from "../src/live-playback.js";
import { createSoundEngine } from "../src/sound.js";
import { AudioContext } from "./helpers/audio.js";
import { fakeTone } from "./helpers/tone.js";

const note = { part: "lead", note: 60, offset: 0, duration: 0.1, velocity: 0.1 };
const group = (slot, events = [note]) => ({ scheduleId: `1:${slot}`, when: 10 + slot / 2,
  presetId: "classic-v3", events, price: 100, controls: { energy: 3 }, privateState: "excluded" });

test("three-minute eviction follows played time, retains rests, and freezes on pause", () => {
  const buffer = createRewindBuffer();
  for (let slot = 0; slot <= 400; slot++) {
    buffer.schedule(group(slot, slot % 2 ? [] : [note]));
    buffer.update(10 + slot / 2);
  }
  assert.deepEqual({ start: buffer.inspect().startMs, end: buffer.inspect().endMs, groups: buffer.inspect().groups },
    { start: 20000, end: 200000, groups: 360 });
  buffer.boundary(210, "pause");
  const snapshot = buffer.inspect(); buffer.update(10000);
  assert.deepEqual(buffer.inspect(), snapshot);
  const clip = buffer.clip();
  assert.equal(clip.durationMs, 180000); assert.equal(clip.frames.length, 360);
  assert.equal(clip.frames[1].events.length, 0);
  assert.doesNotMatch(JSON.stringify(clip), /price|controls|privateState/);
  assert.deepEqual(decodeRecording(encodeRecording(clip)), clip);
  clip.frames[0].events[0].note = 72;
  assert.equal(buffer.clip().frames[0].events[0].note, 60);
  assert.throws(() => buffer.clip(19500, 200000));
  assert.throws(() => buffer.clip(20000, 200001));
  buffer.clear(); assert.equal(buffer.inspect().durationMs, 0);
});

test("replacement, cancellation and partial-beat attacks match the audible endpoint; resume appends without paused time", () => {
  const buffer = createRewindBuffer();
  buffer.schedule(group(0)); buffer.cancel("1:0");
  buffer.schedule({ ...group(0, [note, { ...note, note: 72, offset: 0.375 }]), presetId: "ambient-v3" });
  buffer.schedule(group(1)); buffer.cancel("1:1");
  buffer.boundary(10.2, "pause");
  const clip = buffer.clip();
  assert.equal(clip.durationMs, 200);
  assert.equal(clip.frames[0].presetId, "ambient-v3");
  assert.deepEqual(clip.frames[0].events, [note]);
  buffer.schedule({ ...group(0), when: 100 });
  buffer.boundary(100.5, "pause");
  assert.deepEqual(buffer.clip().frames.map(frame => frame.offsetMs), [0, 500]);
  assert.equal(buffer.clip().durationMs, 1000);
  assert.equal(buffer.inspect().pending, 0);
  assert.throws(() => buffer.clip(1, 1000));
});

test("180-second sparse scores round-trip; dense scores retain their notes but cannot exceed the hash cap", () => {
  const score = { version: 3, renderer: "rack-v3", durationMs: 180000, frames: Array.from({ length: 360 }, (_, slot) => ({
    offsetMs: slot * 500, presetId: "classic-v3", change: 0, events: [note],
  })) };
  assert.deepEqual(decodeRecording(encodeRecording(score)), score);
  score.frames.forEach(frame => { frame.events = Array.from({ length: 32 }, () => ({ part: "hat", offset: 0, duration: 0.02, velocity: 0.1 })); });
  assert.equal(validateEventScore(score), score);
  assert.throws(() => encodeRecording(score), /64 KiB/);
  assert.equal(score.frames[359].events.length, 32);
  assert.throws(() => validateEventScore({ ...score, durationMs: 180001 }));
});

test("public Live events stay inside v3 pitch, timing and voice bounds across every preset", async () => {
  const source = createLiveEventSource(), context = new AudioContext(); context.currentTime = 0;
  const engine = createSoundEngine({ bars: [], openingGapReturn: null }, { context, tone: fakeTone(), eventMode: true });
  await engine.prepare();
  const frames = [];
  for (let beat = 0; beat < 100; beat++) {
    const preset = LIVE_EVENT_PRESETS[Math.floor(beat / 5) % 4].id;
    const events = source.advance({ beat, preset, controls: { energy: 3, hits: [1, 1, 1, 1] },
      frame: { degree: beat % 15, chordDegree: [0, 3, 4, 5][beat % 4], tradeRate: 20, accent: 3, event: beat % 2 ? "drop" : "spike" } }).events;
    frames.push({ offsetMs: beat * 500, presetId: preset, change: 0, events });
    engine.playEvents(events, { presetId: preset, when: beat / 2 });
  }
  validateEventScore({ version: 3, renderer: "rack-v3", durationMs: 50000, frames });
  assert.equal(engine.inspect().rack.dropped, 0);
  assert.ok(frames.some(frame => frame.events.some(event => event.part === "kick")));
  assert.doesNotMatch(JSON.stringify(source.inspect()), /price|controls|mapping/);
  await engine.dispose();
});

test("live pause cuts future attacks and resume refills before appending the resolved score", async () => {
  const context = new AudioContext(); let time = 0, tick;
  const source = { advance: () => ({ events: [note, { ...note, note: 72, offset: 0.375 }] }), reset() {}, inspect: () => ({}) };
  const player = createLivePlayback({ context, tone: fakeTone(), eventSource: source, presetId: "classic-v3",
    now: () => time, setInterval: fn => { tick = fn; return 1; }, clearInterval() {} });
  const advance = until => { while (time < until) { time += 25; context.currentTime = 10 + time / 1000; tick(); } };
  const accept = () => player.accept({ price: 100, mid: 100, spread: 0, connectionId: 1, exchangeTimeMs: 0 });
  await player.start(); accept(); advance(5200); player.pause();
  assert.equal(player.inspect().state, "paused");
  assert.deepEqual(player.rewind.clip().frames[0].events, [note]);
  const end = player.rewind.inspect().endMs;
  advance(15000); assert.equal(player.rewind.inspect().endMs, end);
  await player.start({ retainHistory: true }); accept();
  advance(19900); assert.equal(player.rewind.inspect().endMs, end);
  advance(20700); player.pause();
  assert.ok(player.rewind.inspect().endMs > end);
  assert.equal(player.rewind.clip().frames[0].events[0].note, 60);
  player.stop(); assert.equal(player.rewind.inspect().groups, 0);
  await player.dispose();
});

test("the renderer reports only accepted attacks so skipped late notes cannot enter rewind", async () => {
  const context = new AudioContext(), engine = createSoundEngine({ bars: [], openingGapReturn: null },
    { context, tone: fakeTone(), eventMode: true });
  await engine.prepare(); context.currentTime = 10.2;
  const future = { ...note, offset: 0.375 };
  const rendered = engine.playEvents([note, future], { when: 10, presetId: "classic-v3", skipIfLate: true });
  assert.deepEqual(rendered.events, [future]);
  assert.deepEqual(engine.inspect().rack.last.events, [future]);
  await engine.dispose();
});
