import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseSessionCsv, loadCatalog, loadSession } from "../src/data.js";
import { computeFeatures } from "../src/features.js";
import { createSoundScore, createSoundEngine } from "../src/sound.js";
import { AudioContext } from "./helpers/audio.js";

const csv = await readFile(new URL("./fixtures/features.csv", import.meta.url), "utf8");
const features = computeFeatures(parseSessionCsv(csv, { date: "2025-01-02", barCount: 21, previousClose: 125 }));

test("score maps price endpoints to C3/C6, log volume, harmony, and signed hits", () => {
  const score = createSoundScore(features);
  const [opening, spike, drop] = score.bars;
  assert.equal(spike.note, 84);
  assert.equal(drop.note, 48);
  assert.equal(spike.frequency, 1046.5022612023945);
  assert.equal(spike.harmony, 88);
  assert.equal(drop.harmony, 42);
  assert.equal(opening.harmony, null);
  assert.deepEqual(opening.rules, ["opening-gong"]);
  assert.deepEqual(spike.rules, ["up-major-third", "spike-bell"]);
  assert.deepEqual(drop.rules, ["down-tritone", "drop-crash"]);
  assert.equal(opening.gain, 0);
  assert.equal(score.volumeReference, 4);
  assert.ok(Math.abs(drop.gain - 0.0643458750793272) < 1e-12);
  assert.equal(drop.intensity, 1);
  assert.equal(drop.cutoff, 8000);
  assert.equal(drop.drive, 24);
  assert.equal(opening.drive, 0);
  assert.equal(opening.cutoff, 400);
  assert.equal(opening.droneNote, null);
  assert.ok(drop.droneNote >= 36 && drop.droneNote <= 48);
  assert.equal(features.bars[0].note, undefined);
});

test("flat, zero-volume and missing-return bars have finite quiet mappings", () => {
  const flat = { sigma: null, openingGapReturn: null, bars: [
    { minute: 7, close: 100, volume: 0, return: null, rollingVolatility: null, vwap: null, event: null },
  ] };
  const score = createSoundScore(flat);
  assert.equal(score.bars[0].note, 67);
  assert.equal(score.bars[0].gain, 0);
  assert.equal(score.bars[0].intensity, 0);
  assert.deepEqual(score.bars[0].rules, []);
  flat.bars.push({ ...flat.bars[0], minute: 8, volume: 0 }, { ...flat.bars[0], minute: 9, volume: 10 });
  const sparse = createSoundScore(flat);
  assert.equal(sparse.medianVolume, 0);
  assert.equal(sparse.volumeReference, 10);
  assert.equal(sparse.bars[2].gain, 0.11);
  flat.openingGapReturn = 0;
  assert.deepEqual(createSoundScore(flat).bars[0].rules, []);
});

test("Web Audio graph schedules timbre, envelopes, drone, and crash at audio-clock time", async () => {
  const context = new AudioContext();
  const engine = createSoundEngine(features, { context });
  await engine.resume();
  const mapping = engine.playBar(2, { when: 11, duration: 0.4 });
  const oscillators = context.nodes.filter(node => node.kind === "oscillator");
  assert.deepEqual(oscillators.map(node => node.type), ["sawtooth", "sawtooth", "sine"]);
  assert.deepEqual(oscillators[0].frequency.events, [["set", mapping.frequency, 11]]);
  assert.deepEqual(oscillators[0].stops, [11.36]);
  const filter = context.nodes.find(node => node.kind === "filter" && node.frequency.value !== 14000);
  assert.equal(filter.type, "lowpass");
  assert.deepEqual(filter.frequency.events, [["set", 8000, 11]]);
  const shaper = context.nodes.find(node => node.kind === "shaper" && node.curve.length === 1025);
  assert.equal(shaper.curve[512], 0);
  assert.equal(shaper.curve[1024], 1);
  assert.ok(shaper.curve[768] > 0.99);
  const envelope = filter.connections[0];
  assert.deepEqual(envelope.gain.events, [["set", 0, 11], ["linear", mapping.gain, 11.01], ["exponential", 0.00001, 11.36]]);
  const noise = context.nodes.find(node => node.kind === "noise");
  assert.equal(noise.started, 11);
  assert.equal(noise.buffer.getChannelData(0).length, 4800);
  assert.equal(noise.connections[0].type, "highpass");
  assert.equal(engine.inspect().activeVoices, 3);
  assert.equal(engine.inspect().droneActive, true);
  mapping.rules.push("mutated");
  assert.equal(engine.inspect().lastScheduled.rules.includes("mutated"), false);
  oscillators[0].onended();
  assert.equal(oscillators[0].connections.length, 0);
  assert.equal(engine.inspect().activeVoices, 2);
  engine.stop();
  assert.equal(engine.inspect().activeVoices, 0);
  assert.equal(engine.inspect().droneActive, false);
  assert.equal(engine.inspect().lastScheduled, null);
  assert.ok(context.nodes.slice(5).every(node => node.connections.length === 0));
  engine.playBar(1);
  assert.ok(engine.inspect().activeVoices > 0);
  await engine.dispose();
  await engine.dispose();
  assert.ok(context.nodes.every(node => node.connections.length === 0));
  assert.equal(context.state, "running");
  assert.throws(() => engine.playBar(0), /disposed/);
  await assert.rejects(engine.resume(), /disposed/);
});

test("opening gong, spike bell, and clean triangle use distinct synthesized voices", () => {
  const context = new AudioContext();
  const audible = { ...features, bars: features.bars.map(bar => ({ ...bar, volume: 4 })) };
  const engine = createSoundEngine(audible, { context });
  engine.playBar(0);
  assert.equal(engine.inspect().activeVoices, 4);
  assert.deepEqual(context.nodes.filter(node => node.kind === "oscillator").slice(1).map(node => node.frequency.events[0][1]), [130.81, 181.83, 275.61]);
  const clean = context.nodes.find(node => node.kind === "shaper" && node.curve.length === 1025);
  assert.equal(clean.curve[768], 0.5);
  engine.stop();
  engine.playBar(1);
  const oscillators = context.nodes.filter(node => node.kind === "oscillator").slice(4);
  assert.deepEqual(oscillators.map(node => node.type), ["triangle", "triangle", "sawtooth", "sawtooth", "sine", "sine"]);
  assert.deepEqual(oscillators.slice(-2).map(node => node.frequency.events[0][1]), [1046.5, 2093]);
  engine.stop();
});

test("resume exposes waiting, errors propagate, and invalid scheduling allocates no voices", async () => {
  const context = new AudioContext();
  let rejectResume;
  context.resume = () => new Promise((resolve, reject) => { rejectResume = reject; });
  const engine = createSoundEngine(features, { context });
  const pending = engine.resume();
  assert.equal(engine.inspect().waiting, "audio-context-resume");
  rejectResume(new Error("device unavailable"));
  await assert.rejects(pending, /device unavailable/);
  assert.equal(engine.inspect().waiting, null);
  for (const [index, options] of [[-1, {}], [0, { duration: 0 }], [0, { when: 9 }], [0, { when: NaN }]]) {
    assert.throws(() => engine.playBar(index, options), RangeError);
  }
  assert.equal(engine.inspect().activeVoices, 0);
});

test("disposing an owned context closes it and cancels future sources", async () => {
  const original = globalThis.AudioContext;
  const context = new AudioContext();
  globalThis.AudioContext = class { constructor() { return context; } };
  try {
    const engine = createSoundEngine(features);
    engine.playBar(2, { when: 30 });
    await engine.dispose();
    assert.equal(context.state, "closed");
    assert.equal(engine.inspect().disposed, true);
    assert.ok(context.nodes.filter(node => node.started !== undefined).every(node => node.stops.at(-1) === undefined));
    assert.ok(context.nodes.every(node => node.connections.length === 0));
  } finally {
    if (original === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = original;
  }
});

test("all bundled sessions map only observed bars to finite, bounded sound parameters", async () => {
  const fetchFile = async url => new Response(await readFile(url));
  for (const session of await loadCatalog(fetchFile)) {
    const features = computeFeatures(await loadSession(session, fetchFile));
    const score = createSoundScore(features);
    assert.deepEqual(score.bars.map(bar => bar.minute), features.bars.map(bar => bar.minute));
    for (const bar of score.bars) {
      assert.ok([0, 3, 5, 7, 10].includes(bar.note % 12));
      assert.ok(bar.note >= 48 && bar.note <= 84);
      assert.ok(bar.gain >= 0 && bar.gain <= 0.22);
      assert.ok(bar.drive >= 0 && bar.drive <= 24);
      assert.ok(Number.isFinite(bar.frequency));
    }
  }
});
