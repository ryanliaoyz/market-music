import { test } from "node:test";
import assert from "node:assert/strict";
import { createLiveFeatures } from "../src/live-features.js";

const tick = (price, connectionId = 1) => ({ price, connectionId, exchangeTimeMs: 1000 });

test("causal fixed-gain mappings coalesce bursts and retain immutable historical values", () => {
  const features = createLiveFeatures();
  features.accept(tick(100)); features.accept(tick(110));
  const first = features.sample(500), saved = structuredClone(first);
  assert.equal(first.price, 110); assert.equal(first.return, null);
  assert.equal(first.mapping.note, 60); assert.equal(first.mapping.gain, 0.11);
  assert.equal(first.mapping.droneNote, null); assert.deepEqual(first.mapping.rules, ["stabs:mask-1", "accent-0"]);
  features.accept(tick(121));
  const second = features.sample(1000);
  assert.ok(Math.abs(second.return - 0.1) < 1e-12);
  assert.equal(second.mapping.note, 65); assert.deepEqual(second.mapping.chord, [48, 51, 55]);
  features.accept(tick(90));
  assert.equal(features.sample(1500).mapping.note, 60);
  assert.deepEqual(first, saved);
});

test("rests, missing slots, explicit gaps and connection epochs break returns", () => {
  const features = createLiveFeatures();
  assert.equal(features.sample(0).mapping, null);
  features.accept(tick(100)); features.sample(500);
  features.accept(tick(200)); assert.equal(features.sample(1500).return, null);
  features.gap(); features.accept(tick(300)); assert.equal(features.sample(2000).return, null);
  features.accept(tick(400, 2)); assert.equal(features.sample(2500).return, null);
  assert.equal(features.sample(3000).price, null);
});

test("window is bounded and IDs never restart; warmup and zero variance suppress events", () => {
  const features = createLiveFeatures();
  for (let i = 0; i < 130; i++) { features.accept(tick(100)); features.sample(i * 500); }
  const state = features.inspect();
  assert.equal(state.frames.length, 120); assert.equal(state.frames[0].id, 10);
  assert.ok(state.frames.every(frame => frame.event === null && Number.isFinite(frame.mapping.frequency)));
  state.frames[0].mapping.note = -1;
  assert.equal(features.inspect().frames[0].mapping.note, 60);
});

test("event threshold uses preceding returns, not the arriving outlier", () => {
  const features = createLiveFeatures();
  for (let i = 0; i <= 12; i++) { features.accept(tick(i % 2 ? 100.01 : 100)); features.sample(i * 500); }
  features.accept(tick(110));
  const spike = features.sample(6500);
  assert.equal(spike.event, "spike"); assert.ok(spike.mapping.rules.includes("spike-bell"));
});
