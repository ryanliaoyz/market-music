import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, getPreset } from "../src/presets.js";
import { createSoundScore, createSoundEngine } from "../src/sound.js";
import { createPlayback } from "../src/playback.js";
import { AudioContext } from "./helpers/audio.js";
import { fakeTone } from "./helpers/tone.js";

const features = { session: { id: "fixture" }, sigma: 0, openingGapReturn: null, bars: [
  { minute: 0, close: 100, volume: 1, return: null, rollingVolatility: 0, vwap: null, event: null },
] };

test("versioned presets serialize and map known scales/registers without changing Classic", () => {
  assert.equal(new Set(PRESETS.map(p => p.id)).size, 4);
  assert.throws(() => getPreset("missing"), /Unknown preset/);
  const expected = [67, 67, 67, 55];
  for (const [index, preset] of PRESETS.entries()) {
    assert.equal(getPreset(JSON.parse(JSON.stringify({ presetId: preset.id })).presetId), preset);
    const score = createSoundScore(features, { presetId: preset.id });
    assert.equal(score.bars[0].note, expected[index]);
    assert.equal(score.bars[0].presetId, preset.id);
    assert.deepEqual(score.bars[0].scale, preset.scale);
  }
  const prices = { ...features, bars: [features.bars[0], { ...features.bars[0], close: 104 }, { ...features.bars[0], close: 110 }] };
  assert.equal(createSoundScore(prices, { presetId: "plucky-v1" }).bars[1].note, 62);
  assert.equal(createSoundScore(prices).bars[1].note, 63);
});

test("Tone adapter schedules actual engine mappings and cleans future voices, timers and wrappers", async () => {
  const context = new AudioContext(), tone = fakeTone();
  const engine = createSoundEngine(features, { context, tone, presetId: "ambient-v1" });
  await engine.resume();
  engine.playBar(0, { when: 11, duration: 0.5 });
  const synth = tone.nodes.find(node => node.trigger);
  assert.deepEqual(synth.trigger, [engine.score.bars[0].frequency, 0.35, 11]);
  assert.equal(synth.options.oscillator.type, "sine");
  assert.equal(tone.contexts[0].options.context.currentTime, context.currentTime);
  engine.cancelScheduled(10.5);
  assert.ok(tone.nodes.every(node => node.disposed));
  assert.equal(tone.contexts[0].timers.size, 0);
  engine.playBar(0);
  engine.stop();
  assert.equal(engine.inspect().activeToneFrames, 0);
  await engine.dispose();
  assert.equal(context.state, "running");
  assert.equal(tone.contexts[0].disposed, true);
});

test("historical switching updates paused previews and restarts the current minute, including pending resume", async () => {
  const context = new AudioContext(), tone = fakeTone();
  const player = createPlayback(features, { context, tone, setInterval: () => 1, clearInterval() {} });
  player.setPreset("plucky-v1");
  assert.equal(player.inspect().audio, null);
  await player.play();
  assert.equal(player.inspect().audio.lastScheduled.presetId, "plucky-v1");
  player.setPreset("bass-heavy-v1");
  assert.equal(player.inspect().state, "playing");
  assert.equal(player.inspect().minute, 0);
  assert.equal(player.inspect().audio.lastScheduled.note, 55);
  player.pause();
  let resolve;
  context.resume = () => new Promise(done => { resolve = done; });
  const pending = player.play();
  player.setPreset("ambient-v1"); resolve(); await pending;
  assert.equal(player.inspect().state, "paused");
  assert.equal(player.inspect().presetId, "ambient-v1");
  await player.dispose();
});
