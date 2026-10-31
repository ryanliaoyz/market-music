import { test } from "node:test";
import assert from "node:assert/strict";
import { createRecorder } from "../src/recording.js";
import { encodeRecording, decodeRecording, recordingMapping } from "../src/recording-codec.js";
import { renderWav, encodeWav } from "../src/wav.js";
import { createRecordingPlayback } from "../src/recording-playback.js";
import { AudioContext } from "./helpers/audio.js";

const frame = (when = 10, presetId = "classic-v1") => ({ scheduleId: `1:${when}`, when, playbackOffsetMs: Math.round(when * 1000), price: 100, presetId,
  event: null, mapping: { note: 60, harmony: 64, intensity: 0.25 } });
const clip = { durationMs: 1000, frames: [{ offsetMs: 0, price: 100, presetId: "classic-v1", note: 60, harmony: 64, intensity: 0.25, event: null }] };

test("recorder captures pending lookahead, replacement and endpoint, excludes cancellations", () => {
  const recorder = createRecorder();
  recorder.schedule(frame(10.1)); recorder.start(10);
  recorder.cancel("1:10.1"); recorder.schedule(frame(10.1, "ambient-v1"));
  recorder.schedule(frame(10.6)); recorder.cancel("1:10.6"); recorder.schedule(frame(11.1));
  recorder.finish(10.9);
  assert.equal(recorder.clip.frames.length, 1);
  assert.equal(recorder.clip.frames[0].presetId, "ambient-v1");
  assert.equal(recorder.clip.durationMs, 800);
  recorder.boundary(11, "stop"); assert.equal(recorder.clip.frames.length, 1);
});

test("recorder caps at 30 seconds and finalizes interruption without stale start IDs", () => {
  const recorder = createRecorder(); recorder.start(10);
  for (let n = 0; n < 62; n++) recorder.schedule(frame(10 + n / 2));
  recorder.update(40); assert.equal(recorder.clip.frames.length, 60); assert.equal(recorder.clip.durationMs, 30000);
  recorder.boundary(41, "stop"); recorder.start(42); recorder.schedule(frame(42)); recorder.boundary(42.2, "reconnect");
  assert.equal(recorder.clip.durationMs, 200); assert.equal(recorder.clip.frames.length, 1);
});

test("preset rescheduling clock jitter preserves nonnegative grid timing and an encodable clip", () => {
  const recorder = createRecorder();
  recorder.schedule(frame(10.1)); recorder.start(10);
  recorder.cancel("1:10.1");
  recorder.schedule({ ...frame(10.1, "plucky-v1"), when: 10.098 });
  recorder.schedule({ ...frame(10.6, "plucky-v1"), when: 10.601 });
  recorder.finish(10.9);
  assert.deepEqual(recorder.clip.frames.map(frame => frame.offsetMs), [0, 500]);
  assert.deepEqual(decodeRecording(encodeRecording(recorder.clip)), recorder.clip);
});

test("codec retains exact values and full clips fit 4 KiB", () => {
  assert.deepEqual(decodeRecording(encodeRecording(clip)), clip);
  const full = { durationMs: 30000, frames: Array.from({ length: 60 }, (_, n) => ({ ...clip.frames[0], offsetMs: n * 500, price: 999999.123456 })) };
  assert.ok(encodeRecording(full).length <= 4096);
  assert.deepEqual(decodeRecording(encodeRecording(full)), full);
  assert.equal(recordingMapping(clip.frames[0]).frequency, 261.6255653005986);
});

test("codec rejects hostile links and invalid data", () => {
  for (const hash of ["#recording=v2.a", "#recording=v1.!", "#recording=v1.a", "#recording=v1." + "a".repeat(4096), encodeRecording(clip) + "AAAA"]) assert.throws(() => decodeRecording(hash));
  for (const change of [{ price: NaN }, { intensity: Infinity }, { presetId: "unknown" }, { offsetMs: -1 }, { note: 128 }]) {
    assert.throws(() => encodeRecording({ ...clip, frames: [{ ...clip.frames[0], ...change }] }));
  }
  const bytes = Uint8Array.from(atob(encodeRecording(clip).split(".")[1].replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));
  for (const [index, value] of [[0, 2], [3, 61], [14, 255], [25, 3], [26, 1]]) {
    const mutated = bytes.slice(); mutated[index] = value;
    assert.throws(() => decodeRecording("#recording=v1." + btoa(String.fromCharCode(...mutated)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")));
  }
});

test("offline export schedules the real graph and writes PCM16 WAV", async () => {
  let context;
  class OfflineContext extends AudioContext {
    constructor(channels, length, sampleRate) { super(); context = this; this.currentTime = 0; this.length = length; this.sampleRate = sampleRate; }
    async startRendering() { return { sampleRate: this.sampleRate, getChannelData: () => new Float32Array(this.length) }; }
  }
  const wav = await renderWav(clip, { OfflineContext });
  const bytes = await wav.arrayBuffer(), view = new DataView(bytes);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "RIFF");
  assert.equal(view.getUint32(24, true), 44100); assert.equal(bytes.byteLength, 44 + 88200);
  assert.ok(context.nodes.some(node => node.kind === "oscillator" && node.started === 0));
  const pcm = new DataView(encodeWav({ sampleRate: 8000, getChannelData: () => Float32Array.of(-2, 0, 2) }));
  assert.equal(pcm.getInt16(44, true), -32768); assert.equal(pcm.getInt16(48, true), 32767);
});

test("replay schedules captured mapping and stops at the clip boundary", async () => {
  const context = new AudioContext(); let tick;
  const replay = createRecordingPlayback(clip, { context, setInterval: fn => { tick = fn; return 1; }, clearInterval() {} });
  await replay.play();
  assert.equal(replay.inspect().audio.lastScheduled.note, 60);
  const master = context.nodes.find(node => node.kind === "gain");
  assert.deepEqual(master.gain.events.at(-1), ["set", 0, 11.05]);
  context.currentTime += 2; tick();
  assert.equal(replay.inspect().state, "stopped");
  await replay.dispose();
});

test("replay creates audio only on Play and a blocked unlock remains retryable", async () => {
  const context = new AudioContext();
  context.resume = async () => { context.state = "suspended"; };
  const replay = createRecordingPlayback(clip, { context });
  assert.equal(replay.inspect().audio, null);
  assert.equal(context.nodes.length, 0);
  await assert.rejects(replay.play(), /paused by the browser/);
  assert.equal(replay.inspect().state, "stopped");
  assert.equal(replay.inspect().reason, "resume-failed");
  await replay.dispose();
});
