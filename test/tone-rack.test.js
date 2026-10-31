import { test } from "node:test";
import assert from "node:assert/strict";
import { createSoundEngine } from "../src/sound.js";
import { musicalMapping } from "../src/live-music.js";
import { LIVE_PRESETS } from "../src/presets.js";
import { RACK_CAPS } from "../src/tone-engine.js";
import { AudioContext } from "./helpers/audio.js";
import { fakeTone } from "./helpers/tone.js";

const features = { bars: [], openingGapReturn: null };
const mapping = id => musicalMapping({ degree: 7, chordDegree: 3, tradeRate: 20, accent: 3 }, id);

test("Start preallocates every part; frames, presets, idle and cancellation allocate no Tone nodes", async () => {
  const context = new AudioContext(), tone = fakeTone();
  const engine = createSoundEngine(features, { context, tone });
  await engine.resume();
  const count = tone.nodes.length;
  assert.deepEqual(tone.nodes.filter(node => node instanceof tone.PolySynth).map(node => node.voices.length), [4, 2, 4]);
  for (let frame = 0; frame < 120; frame++) {
    context.currentTime = 10 + frame * 0.5;
    engine.playMapping(mapping(LIVE_PRESETS[frame % 4].id), { when: context.currentTime + 0.05,
      duration: 0.47, energy: frame % 5, beatIndex: frame, hits: [1, 2, 3, 0], beatDuration: 0.5 });
    if (frame % 7 === 0) engine.cancelScheduled(context.currentTime + 0.01);
    assert.equal(tone.nodes.length, count);
    for (const [part, used] of Object.entries(engine.inspect().rack.voices)) assert.ok(used <= RACK_CAPS[part]);
  }
  context.currentTime += 60;
  engine.playMapping(mapping("ambient-v2"));
  assert.equal(tone.nodes.length, count);
  engine.stop();
  assert.equal(engine.inspect().rack, null);
  assert.ok(tone.nodes.every(node => node.disposed));
  assert.equal(tone.contexts[0].disposed, true);
  await engine.resume();
  assert.equal(tone.nodes.length, count * 2);
  assert.equal(engine.inspect().rack.ready, true);
  await engine.dispose();
  assert.ok(tone.nodes.every(node => node.disposed));
  assert.equal(context.state, "running");
});

test("continuous controls ramp, delay follows beat duration, and only energy >=2 kicks duck the pad", async () => {
  const context = new AudioContext(), tone = fakeTone();
  const engine = createSoundEngine(features, { context, tone });
  await engine.resume();
  const pads = tone.nodes.filter(node => node instanceof tone.Gain);
  const padGain = pads.find(node => node.output?.options.type === "lowpass");
  const delay = tone.nodes.find(node => node.options.delayTime !== undefined);
  const kick = tone.nodes.find(node => node.options.oscillator?.type === "sine" && node.options.envelope?.sustain === 0);
  const hats = tone.nodes.filter(node => node instanceof tone.AmplitudeEnvelope);
  engine.playMapping(mapping("classic-v2"), { when: 11, energy: 1, beatDuration: 0.8 });
  assert.deepEqual(padGain.gain.events, []);
  assert.deepEqual(kick.envelope.events, []);
  assert.deepEqual(delay.delayTime.events, [["target", 0.6000000000000001, 11, 0.03]]);
  engine.playMapping(mapping("plucky-v2"), { when: 12, energy: 2, hits: [1, 0, 0, 0], beatDuration: 0.4 });
  assert.deepEqual(padGain.gain.events, [["target", 0.72, 12, 0.008], ["target", 1, 12.08, 0.06]]);
  assert.deepEqual(kick.envelope.events, [["note", 0.08, 12]]);
  assert.equal(hats[1].events.length, 2);
  assert.equal(hats[0].events.length, 0);
  engine.playMapping(mapping("bass-heavy-v2"), { when: 13, energy: 3, beatIndex: 1 });
  assert.deepEqual(hats[0].events, [["note", 0.06, 13, 0.05]]);
  assert.equal(engine.inspect().rack.last.reason, "kick");
  assert.ok(tone.nodes.filter(node => node.envelope.events.some(event => event[0] === "note"))
    .every(node => node.frequency.events.some(event => event[0] === "target")));
  engine.cancelScheduled(11.5);
  assert.ok(padGain.gain.events.every(event => event[2] <= 11.5));
  assert.ok(kick.envelope.events.every(event => event[0] !== "note"));
  assert.ok(hats.every(node => node.events.every(event => event[0] !== "note")));
  await engine.dispose();
});

test("cancelled lookahead can be replaced immediately without rebuilding or exhausting its slots", async () => {
  const context = new AudioContext(), tone = fakeTone();
  const engine = createSoundEngine(features, { context, tone });
  await engine.resume();
  const held = { ...mapping("ambient-v2"), mask: 1 };
  engine.playMapping(held, { when: 11 });
  engine.cancelScheduled(10.5);
  engine.playMapping(held, { when: 11 });
  assert.equal(engine.inspect().rack.dropped, 0);
  engine.silence();
  assert.equal(engine.inspect().activeToneFrames, 0);
  assert.ok(tone.nodes.every(node => !node.disposed));
  engine.playMapping(held);
  assert.equal(engine.inspect().rack.dropped, 0);
  await engine.dispose();
});
