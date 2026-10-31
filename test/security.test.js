import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { encodeRecording, decodeRecording } from "../src/recording-codec.js";
import { PRESETS, LIVE_PRESETS } from "../src/presets.js";
import { mapSoundFrame, createSoundEngine } from "../src/sound.js";
import { musicalMapping } from "../src/live-music.js";
import { AudioContext } from "./helpers/audio.js";
import { sampleFrame, mutateHash, fuzzHashes } from "./helpers/recordings.js";

test("CSP precedes resource loading and Vercel supplies HTTP-only security policies", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const policy = "default-src 'self'; script-src 'self' blob:; worker-src 'self' blob:; connect-src 'self' wss://advanced-trade-ws.coinbase.com; img-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
  assert.ok(html.includes(`http-equiv="Content-Security-Policy" content="${policy}"`));
  assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("<link"));
  assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("<script"));
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const headers = Object.fromEntries(config.headers.find(rule => rule.source === "/(.*)").headers.map(({ key, value }) => [key, value]));
  assert.equal(headers["Content-Security-Policy"], "frame-ancestors 'none'");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.equal(headers["Cross-Origin-Opener-Policy"], "same-origin");
  assert.equal(headers["Permissions-Policy"], "camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-write=(self)");
});

test("v1 accepts every mapper note with its chromatic harmony, including endpoints", () => {
  for (const preset of PRESETS) for (let position = 0; position <= 15; position++) for (const direction of [-1, 0, 1]) {
    const mapping = mapSoundFrame({ close: position, return: direction, rollingVolatility: 1, volume: 1, vwap: null },
      { low: 0, high: 15, peakVolatility: 1, volumeReference: 1 }, { presetId: preset.id });
    const clip = { durationMs: 1000, frames: [{ ...sampleFrame(preset), note: mapping.note, harmony: mapping.harmony }] };
    assert.deepEqual(decodeRecording(encodeRecording(clip)), clip);
  }
});

test("v2 accepts every emitted register and chord across presets", () => {
  for (const preset of LIVE_PRESETS) for (let degree = 0; degree <= 14; degree++) for (const chordDegree of [0, 3, 4, 5]) {
    const mapping = musicalMapping({ degree, chordDegree, tradeRate: 20, accent: 3 }, preset.id);
    const clip = { durationMs: 1000, frames: [{ ...sampleFrame(preset), note: mapping.note, harmony: mapping.harmony, chord: mapping.chord }] };
    assert.deepEqual(decodeRecording(encodeRecording(clip)), clip);
  }
});

test("raw crafted notes, impossible harmony and chord voicings fail decoding", () => {
  for (const preset of [...PRESETS, ...LIVE_PRESETS]) {
    const hash = encodeRecording({ durationMs: 1000, frames: [sampleFrame(preset)] });
    for (const note of [0, 127, preset.root - 1, preset.root + (preset.rhythm ? 25 : 37), preset.root + 1]) {
      assert.throws(() => decodeRecording(mutateHash(hash, 15, note)));
    }
    assert.throws(() => decodeRecording(mutateHash(hash, 16, preset.root + 1)));
    if (preset.rhythm) assert.throws(() => decodeRecording(mutateHash(hash, 29, preset.root)));
  }
});

test("seeded payload fuzz either rejects or returns a round-trippable clip", () => {
  let accepted = 0, rejected = 0;
  for (const hash of fuzzHashes()) {
    let clip;
    try { clip = decodeRecording(hash); } catch { rejected++; continue; }
    assert.deepEqual(decodeRecording(encodeRecording(clip)), clip);
    accepted++;
  }
  assert.ok(accepted > 0 && rejected > 0);
});

test("shared bus routes all output through lowpass, peak ceiling and independent volume", async () => {
  const context = new AudioContext();
  const engine = createSoundEngine({ bars: [], openingGapReturn: null }, { context, volume: 0.5 });
  const [master, compressor, lowpass, ceiling, output] = context.nodes;
  assert.deepEqual(master.connections, [compressor]);
  assert.deepEqual(compressor.connections, [lowpass]);
  assert.deepEqual(lowpass.connections, [ceiling]);
  assert.deepEqual(ceiling.connections, [output]);
  assert.deepEqual(output.connections, [context.destination]);
  assert.equal(lowpass.frequency.value, 14000);
  assert.equal(lowpass.Q.value, Math.SQRT1_2);
  assert.equal(output.gain.value, 0.5);
  assert.ok(Math.max(...ceiling.curve) <= 10 ** (-1 / 20));
  assert.equal(ceiling.oversample, "none");
  engine.setEndpoint(11);
  const endpoint = [...master.gain.events];
  engine.setVolume(0);
  assert.deepEqual(master.gain.events, endpoint);
  assert.equal(output.gain.events.at(-1)[1], 0);
  assert.equal(engine.inspect().bus.volume, 0);
  await engine.dispose();
  assert.ok(context.nodes.every(node => node.connections.length === 0));
});
