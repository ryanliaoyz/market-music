import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { encodeRecording, decodeRecording } from "../src/recording-codec.js";
import { createRecorder } from "../src/recording.js";
import { createRecordingPlayback } from "../src/recording-playback.js";
import { createLivePlayback } from "../src/live-playback.js";
import { createSoundEngine } from "../src/sound.js";
import { renderWav } from "../src/wav.js";
import { eventRecording } from "./helpers/event-recordings.js";
import { AudioContext } from "./helpers/audio.js";
import { fakeTone } from "./helpers/tone.js";

test("v3 binary golden and all-part score round-trip without composer state or prices", () => {
  const score = { version: 3, renderer: "rack-v3", durationMs: 500, frames: [{ offsetMs: 0, presetId: "classic-v3", change: 0,
    events: [{ part: "lead", note: 60, offset: 0, duration: 0.1, velocity: 0.08 }] }] };
  const golden = "#recording=v3." + Buffer.from("0100000001f400010000000000000001003c00001410", "hex").toString("base64url");
  assert.equal(encodeRecording(score), golden);
  assert.deepEqual(decodeRecording(golden), score);
  assert.deepEqual(decodeRecording(encodeRecording(eventRecording())), eventRecording());
  assert.doesNotMatch(JSON.stringify(decodeRecording(golden)), /price|seed|controls|lookahead/);
});

test("two minutes at the maximum event count fits 64 KiB; malformed v3 input is rejected", () => {
  const full = { version: 3, renderer: "rack-v3", durationMs: 120000, frames: Array.from({ length: 240 }, (_, n) => ({
    offsetMs: n * 500, presetId: "classic-v3", change: 0, events: Array.from({ length: 32 }, () =>
      ({ part: "hat", offset: 0, duration: 0.08, velocity: 1 })) })) };
  const hash = encodeRecording(full);
  assert.ok(hash.length <= 65536); assert.ok(hash.length > 4096);
  assert.deepEqual(decodeRecording(hash), full);
  const score = eventRecording();
  for (const change of [{ renderer: "future" }, { durationMs: 120001 }, { frames: [] }, { frames: Array(241).fill(score.frames[0]) }])
    assert.throws(() => encodeRecording({ ...score, ...change }));
  for (const change of [{ part: "future" }, { note: 127 }, { offset: NaN }, { offset: 0.5 }, { duration: 2.005 }, { velocity: 1.005 }, { velocity: Infinity }]) {
    const bad = structuredClone(score); Object.assign(bad.frames[0].events[0], change);
    assert.throws(() => encodeRecording(bad));
  }
  for (const change of [{ presetId: "unknown" }, { change: 32768 }, { offsetMs: 1 }, { events: Array(33).fill(score.frames[0].events[0]) }]) {
    const bad = structuredClone(score); Object.assign(bad.frames[0], change); assert.throws(() => encodeRecording(bad));
  }
  for (const bad of [hash + "AAAA", hash.slice(0, -2), "#recording=v3.!", "#recording=v3." + "A".repeat(65536)]) assert.throws(() => decodeRecording(bad));
  const bytes = Buffer.from(encodeRecording(score).split(".")[1], "base64url");
  for (const [at, value] of [[0, 2], [1, 1], [7, 241], [12, 255], [15, 33], [16, 255], [17, 255], [18, 100], [21, 201]]) {
    const mutated = Buffer.from(bytes); mutated[at] = value;
    assert.throws(() => decodeRecording("#recording=v3." + mutated.toString("base64url")));
  }
  const crowded = structuredClone(score); crowded.frames[0].events = Array(11).fill(score.frames[0].events[0]);
  assert.throws(() => encodeRecording(crowded), /capacity/);
});

test("v3 recorder preserves queued replacements, silent beats and partial-beat endpoints, excludes future starts", () => {
  const recorder = createRecorder();
  const scheduled = (slot, events = eventRecording().frames[0].events) => ({ scheduleId: `1:${slot}`, when: 10 + slot / 2,
    playbackOffsetMs: 5000 + slot * 500, price: 100 + slot, presetId: "classic-v3", events });
  recorder.schedule(scheduled(0)); recorder.start(9.9); recorder.cancel("1:0");
  recorder.schedule({ ...scheduled(0), when: 10.001, presetId: "ambient-v3" });
  recorder.schedule(scheduled(1, [])); recorder.schedule(scheduled(2)); recorder.cancel("1:2");
  recorder.schedule(scheduled(3)); recorder.finish(11.7);
  const clip = recorder.clip;
  assert.equal(clip.durationMs, 1700); assert.equal(clip.frames[0].presetId, "ambient-v3");
  assert.deepEqual(clip.frames.map(frame => frame.offsetMs), [0, 500, 1500]);
  assert.equal(clip.frames[1].events.length, 0);
  assert.ok(clip.frames[2].events.every(event => event.offset < 0.2));
  assert.ok(clip.frames[2].events.some(event => event.duration === 2));
  assert.deepEqual(decodeRecording(encodeRecording(clip)), clip);
  assert.equal(recorder.inspect().renderer, "rack-v3");
  recorder.start(20); for (let n = 0; n < 241; n++) recorder.schedule({ ...scheduled(n, []), when: 20 + n / 2 });
  recorder.update(140); assert.equal(recorder.clip.durationMs, 120000); assert.equal(recorder.clip.frames.length, 240);
});

const trace = (tone, origin) => tone.nodes.flatMap((node, index) => [
  ...node.envelope.notes.map(([duration, time]) => [index, "note", duration, Math.round((time - origin) * 1000)]),
  ...(node.notes ?? []).map(([duration, time, velocity]) => [index, "drum", duration, Math.round((time - origin) * 1000), velocity]),
  ...["volume", "frequency", "gain"].flatMap(key => (node[key].history ?? [])
    .filter(event => !(key === "gain" && (event[3] === 0.02 || event[0] === "set" && event[1] === 0))) // Exclude disposal mute/reset.
    .map(([kind, value, time, constant]) =>
    [index, key, kind, value, Math.round((time - origin) * 1000), constant])),
]);

test("direct score, decoded replay and WAV share the real event renderer including drums and ducking", async () => {
  const clip = eventRecording(), directTone = fakeTone(), replayTone = fakeTone(), offlineTone = fakeTone();
  const context = new AudioContext(); context.currentTime = 0;
  const direct = createSoundEngine({ bars: [], openingGapReturn: null }, { context, tone: directTone, eventMode: true });
  await direct.prepare();
  for (const frame of clip.frames) direct.playEvents(frame.events, { presetId: frame.presetId, when: frame.offsetMs / 1000 });
  const count = directTone.nodes.length;
  assert.equal(direct.inspect().rack.dropped, 0);
  let tick;
  const replayContext = new AudioContext();
  const replay = createRecordingPlayback(decodeRecording(encodeRecording(clip)), { context: replayContext, tone: replayTone,
    setInterval: fn => { tick = fn; return 1; }, clearInterval() {} });
  await replay.play();
  for (let n = 1; n <= 65; n++) { replayContext.currentTime = 10 + n * 0.025; tick(); }
  class OfflineContext extends AudioContext {
    constructor(channels, length, sampleRate) { super(); this.currentTime = 0; this.length = length; this.sampleRate = sampleRate; }
    async startRendering() { return { sampleRate: this.sampleRate, getChannelData: () => new Float32Array(this.length) }; }
  }
  const wav = await renderWav(clip, { OfflineContext, tone: offlineTone });
  assert.equal(wav.size, 44 + 2 * Math.ceil(2400 * 44.1));
  assert.deepEqual(trace(replayTone, 10.05), trace(directTone, 0));
  assert.deepEqual(trace(offlineTone, 0), trace(directTone, 0));
  assert.equal(directTone.nodes.length, count);
  await replay.dispose(); await direct.dispose();
});

test("live event-source seam schedules and captures the same normalized events without private code", async () => {
  const recorder = createRecorder(), context = new AudioContext();
  let time = 0, tick;
  const eventSource = { advance: () => ({ events: [{ part: "lead", note: 60, offset: 0.1249, duration: 0.2, velocity: 0.0801 }] }),
    reset() {}, inspect: () => ({ waiting: "resolved-score" }) };
  const live = createLivePlayback({ context, tone: fakeTone(), eventSource, presetId: "classic-v3", now: () => time,
    setInterval: fn => { tick = fn; return 1; }, clearInterval() {}, onSchedule: recorder.schedule, onCancel: recorder.cancel, onBoundary: recorder.boundary });
  await live.start(); live.accept({ price: 100, mid: 100, spread: 0, connectionId: 1, exchangeTimeMs: 0 });
  recorder.start(10);
  for (; time <= 5500; time += 25) { context.currentTime = 10 + time / 1000; tick(); }
  recorder.finish(15.4);
  assert.equal(recorder.clip.version, 3);
  assert.deepEqual(recorder.clip.frames[0].events, [{ part: "lead", note: 60, offset: 0.125, duration: 0.2, velocity: 0.08 }]);
  assert.deepEqual(live.inspect().audio.lastScheduled.events, recorder.clip.frames[0].events);
  await live.dispose();
  for (const path of ["recording-playback.js", "wav.js", "event-score.js", "recording-v3.js"]) {
    const source = await readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from ["'][^"']*(?:composer|market-music-core)/);
  }
});

test("changing an event-source kit preserves queued groups and attacks later in the current beat", async () => {
  const recorder = createRecorder(), context = new AudioContext(), tone = fakeTone();
  let time = 0, tick;
  const events = [{ part: "pad", note: 60, offset: 0, duration: 2, velocity: 0.03 },
    { part: "arp", note: 72, offset: 0.375, duration: 0.1, velocity: 0.04 }];
  const source = { advance: () => ({ events }), reset() {}, inspect: () => ({}) };
  const live = createLivePlayback({ context, tone, eventSource: source, presetId: "classic-v3", now: () => time,
    setInterval: fn => { tick = fn; return 1; }, clearInterval() {},
    onSchedule: recorder.schedule, onCancel: recorder.cancel, onBoundary: recorder.boundary });
  const advance = until => { while (time < until) { time += 25; context.currentTime = 10 + time / 1000; tick(); } };
  await live.start(); live.accept({ price: 100, mid: 100, spread: 0, connectionId: 1, exchangeTimeMs: 0 });
  advance(4900); recorder.start(context.currentTime); advance(5100); live.setPreset("ambient-v3");
  const arp = tone.nodes.flatMap(node => node.envelope.events).find(event => event[0] === "note" && event[1] === 0.1);
  assert.deepEqual(arp, ["note", 0.1, 15.375]);
  const padRelease = tone.nodes.some(node => node.envelope.events.some(event => event[0] === "release" && event[1] >= 15.1));
  assert.equal(padRelease, false);
  advance(5600); recorder.finish(context.currentTime);
  assert.equal(recorder.clip.frames[0].presetId, "classic-v3");
  assert.deepEqual(recorder.clip.frames[0].events, events);
  assert.equal(recorder.clip.frames[1].presetId, "ambient-v3");
  assert.deepEqual(decodeRecording(encodeRecording(recorder.clip)), recorder.clip);
  await live.dispose();
});
