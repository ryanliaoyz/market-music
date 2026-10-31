import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createBeatAggregator } from "../src/live-aggregate.js";
import { createLiveFeatures } from "../src/live-features.js";
import { createLiveControls } from "../src/live-controls.js";

const empty = { count: 0, buy: 0, sell: 0, hits: [0, 0, 0, 0] };
function inRange(c) {
  for (const [key, low, high] of [["energy", 0, 4], ["contour", -8, 7], ["tension", 0, 7], ["mood", 0, 3], ["flow", -3, 3]]) {
    assert.ok(Number.isInteger(c[key]) && c[key] >= low && c[key] <= high, `${key}: ${c[key]}`);
  }
  assert.equal(c.hits.length, 4);
  assert.ok(c.hits.every(v => Number.isInteger(v) && v >= 0 && v <= 3));
  assert.ok([null, "spike", "drop"].includes(c.event));
}

test("sparse fixture tape produces continuous immutable mid frames and retains intrabeat movement", async () => {
  const tape = JSON.parse(await readFile(new URL("./fixtures/live-tape.json", import.meta.url)));
  const aggregate = createBeatAggregator(0), features = createLiveFeatures();
  let index = 0;
  const frames = [];
  for (let slot = 0; slot < 80; slot++) {
    while (index < tape.length && tape[index].offset <= slot * 500) {
      const tick = tape[index++];
      aggregate.tick({ ...tick, price: tick.mid, connectionId: 1, exchangeTimeMs: tick.offset }, tick.offset);
    }
    const beat = aggregate.sample(slot);
    features.accept(beat.tick);
    frames.push(features.sample(slot * 500, beat));
  }
  assert.ok(frames.every(f => f.mapping && f.price !== null));
  assert.equal(frames[1].aggregate.quotes, 3);
  assert.equal(frames[1].aggregate.low, 99);
  assert.equal(frames[1].aggregate.high, 101);
  assert.ok(frames[1].aggregate.movement > 0);
  assert.equal(frames[15].mid, 100);
  assert.equal(frames[15].return, 0);
  assert.equal(frames[15].carried, true);
  assert.equal(frames.at(-1).mid, 102);
  assert.ok(frames.at(-1).quoteAgeMs > 30000);
  frames.forEach(f => inRange(f.controls));
  const saved = structuredClone(frames[1]);
  aggregate.trade({ exchangeTimeMs: 100, size: 1, aggressor: 1 }, 40000);
  assert.deepEqual(frames[1], saved);
  assert.equal(aggregate.inspect().lateTrades, 1);
});

test("exchange timestamps own sixteenth boundaries regardless of batch arrival order", () => {
  const a = createBeatAggregator(1000);
  a.tick({ mid: 100 }, 0); a.sample(0);
  for (const offset of [500.001, 500, 375.001, 375, 250.001, 250, 125.001, 125, 0.001]) {
    a.trade({ exchangeTimeMs: 1000 + offset, size: 2, aggressor: offset > 250 ? -1 : 1 }, 2000);
  }
  const beat = a.sample(1);
  assert.deepEqual(beat.hits, [2, 2, 2, 2]);
  assert.equal(beat.buy, 8); assert.equal(beat.sell, 8);
  assert.equal(a.sample(2).count, 1);
  a.trade({ exchangeTimeMs: 900, size: 1, aggressor: 1 }, 2000);
  a.trade({ exchangeTimeMs: 100000, size: 1, aggressor: 1 }, 2000);
  assert.equal(a.inspect().outsideTrades, 1);
});

test("a beat includes the first quote's movement from the preceding beat", () => {
  const aggregate = createBeatAggregator(0);
  aggregate.tick({ mid: 100 }, 0);
  aggregate.tick({ mid: 110 }, 10);
  aggregate.tick({ mid: 100 }, 490);
  aggregate.sample(0);
  const beat = aggregate.sample(1);
  assert.ok(Math.abs(beat.movement - 0.19062035960865) < 1e-12);
  assert.equal(beat.tick.mid, 100);
});

test("seeded fuzz keeps controls bounded, deterministic, cadence-latched and state bounded", () => {
  const run = () => {
    let seed = 39;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    const controls = createLiveControls(), result = [];
    let previous;
    for (let slot = 0; slot < 5000; slot++) {
      const c = controls.sample(Math.exp(random() * 50 - 25), random() * 1e8,
        { count: Math.floor(random() * 100000), buy: random() * 1e100, sell: random() * 1e100,
          hits: Array.from({ length: 4 }, () => Math.floor(random() * 10000)) }, slot,
        slot % 9 === 0 ? "spike" : null);
      inRange(c);
      if (previous) for (const [key, cadence] of [["energy", 16], ["tension", 4], ["mood", 32]]) {
        if (slot % cadence) assert.equal(c[key], previous[key]);
      }
      assert.ok(slot % 4 === 0 || c.event === null);
      previous = c; result.push(c);
    }
    assert.equal(controls.inspect().samples, 600);
    return result;
  };
  assert.deepEqual(run(), run());
});

test("one-pole response and Schmitt deadband suppress flow chatter; silence settles activity", () => {
  const controls = createLiveControls();
  for (let slot = 0; slot < 100; slot++) controls.sample(100, 0, empty, slot, null);
  const first = controls.sample(100, 0, { ...empty, buy: 10 }, 100, null);
  assert.ok(first.flow > 0 && first.flow < 3);
  for (let slot = 101; slot < 140; slot++) controls.sample(100, 0, { ...empty, buy: 10 }, slot, null);
  assert.equal(controls.inspect().controls.flow, 3);
  for (let slot = 140; slot < 300; slot++) controls.sample(100, 0, empty, slot, null);
  const quiet = controls.inspect().controls;
  assert.equal(quiet.flow, 0); assert.equal(quiet.energy, 0);
  assert.deepEqual(quiet.hits, [0, 0, 0, 0]);
});

test("Schmitt quantization holds either side of a boundary until its separate exit threshold", () => {
  const controls = createLiveControls();
  const flow = (slot, target) => controls.sample(100, 0,
    { ...empty, buy: 3 + target, sell: 3 - target }, slot, null).flow;
  for (let slot = 0; slot < 100; slot++) flow(slot, 1);
  for (let slot = 100; slot < 200; slot++) assert.equal(flow(slot, slot % 2 ? 1.51 : 1.49), 1);
  for (let slot = 200; slot < 220; slot++) flow(slot, 1.8);
  for (let slot = 220; slot < 320; slot++) assert.equal(flow(slot, slot % 2 ? 1.51 : 1.49), 2);
});

test("events wait for the bar and require rearming before another stinger", () => {
  const controls = createLiveControls();
  const event = (slot, value) => controls.sample(100, 0, empty, slot, value).event;
  assert.equal(event(0, null), null);
  assert.equal(event(1, "spike"), null);
  assert.equal(event(2, "drop"), null);
  assert.equal(event(4, "drop"), "spike");
  assert.equal(event(5, null), null);
  assert.equal(event(6, "drop"), null);
  assert.equal(event(8, "drop"), "drop");
});
