import { test } from "node:test";
import assert from "node:assert/strict";
import { createLiveFeatures } from "../src/live-features.js";
import { musicalMapping, patternVoices } from "../src/live-music.js";
import { LIVE_PRESETS } from "../src/presets.js";
import { createSoundEngine } from "../src/sound.js";
import { AudioContext } from "./helpers/audio.js";
import { fakeTone } from "./helpers/tone.js";

function sample(features, slot, price, count = 0, size = 0) {
  features.accept({ price, connectionId: 1, exchangeTimeMs: slot * 500 });
  return features.sample(slot * 500, { count, size });
}

test("tiny BTC changes move scale degrees causally; flat prices hold and trends remain bounded", () => {
  const features = createLiveFeatures();
  const first = sample(features, 0, 60000), saved = structuredClone(first);
  const up = sample(features, 1, 60000.01);
  const flat = sample(features, 2, 60000.01);
  const down = sample(features, 3, 60000);
  assert.equal(up.degree, 10); assert.equal(up.mapping.note, 65);
  assert.equal(flat.degree, 10); assert.equal(down.degree, 7);
  for (let slot = 4; slot < 200; slot++) {
    const frame = sample(features, slot, 60000 + slot * 0.01);
    assert.ok(frame.degree >= 0 && frame.degree <= 14);
    assert.ok([0, 2, 3, 5, 7, 8, 10].includes(frame.mapping.note % 12));
  }
  assert.deepEqual(first, saved);
});

test("trend selects in-key progressions only at four-second bar boundaries", () => {
  for (const [direction, expected] of [[1, [0, 3, 4, 0]], [-1, [0, 5, 3, 4]], [0, [0, 3, 0, 4]]]) {
    const features = createLiveFeatures(); let previous;
    for (let slot = 0; slot < 32; slot++) {
      const frame = sample(features, slot, 60000 + direction * slot * 0.01);
      assert.equal(frame.chordDegree, expected[Math.floor(slot / 8)]);
      if (slot % 8) assert.deepEqual(frame.mapping.chord, previous.mapping.chord);
      assert.ok(frame.mapping.chord.every(note => [0, 2, 3, 5, 7, 8, 10].includes(note % 12)));
      previous = frame;
    }
  }
});

test("actual trade rate increases density and relative trade size increases accents", () => {
  const features = createLiveFeatures();
  sample(features, 0, 60000, 1, 0.01);
  const quiet = sample(features, 1, 60000.01, 1, 0.01);
  const busy = sample(features, 2, 60000.02, 30, 3);
  assert.equal(quiet.mapping.mask, 1); assert.equal(quiet.accent, 1);
  assert.equal(busy.mapping.mask, 15); assert.equal(busy.accent, 3);
  assert.ok(busy.tradeRate > quiet.tradeRate);
});

test("recent normalization expires old moves and suppresses tiny relative chatter", () => {
  const features = createLiveFeatures();
  sample(features, 0, 60000); const large = sample(features, 1, 60010);
  const tiny = sample(features, 2, 60010.001);
  assert.equal(tiny.degree, large.degree);
  assert.ok(tiny.normalizedChange < 0.1);
  for (let slot = 3; slot <= 41; slot++) sample(features, slot, 60010.001);
  const renewed = sample(features, 42, 60010.002);
  assert.equal(renewed.normalizedChange, 1);
  assert.equal(renewed.degree, tiny.degree + 3);
});

test("four presets have distinct rhythmic/texture output and bounded audio-clock voices", async () => {
  const signatures = new Set();
  for (const preset of LIVE_PRESETS) {
    const mapping = musicalMapping({ degree: 7, chordDegree: 3, tradeRate: 5, accent: 3 }, preset.id);
    const voices = patternVoices(mapping, 0.47);
    signatures.add(JSON.stringify(voices));
    assert.ok(voices.length <= 7);
    assert.ok(voices.every(voice => voice.duration > 0 && voice.offset + voice.duration <= 0.47));
    const context = new AudioContext(), tone = fakeTone();
    const engine = createSoundEngine({ bars: [], openingGapReturn: null }, { context, tone });
    engine.playMapping(mapping, { when: 11, duration: 0.47 });
    const synths = tone.nodes.filter(node => node.envelope.events.some(event => event[0] === "note"));
    const scheduled = synths.flatMap(node => node.envelope.events.filter(event => event[0] === "note")
      .map(event => [node.frequency.events.find(ramp => ramp[2] === event[2])[1], event[1], event[2]]));
    assert.equal(scheduled.length, voices.length);
    const sort = entries => entries.sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
    assert.deepEqual(sort(scheduled), sort(voices.map(voice => [voice.hz, voice.duration, 11 + voice.offset])));
    engine.cancelScheduled(10.5);
    assert.ok(synths.every(node => !node.disposed && node.envelope.events.every(event => event[0] !== "note")));
    await engine.dispose();
    assert.ok(tone.nodes.every(node => node.disposed));
  }
  assert.equal(signatures.size, 4);
});
