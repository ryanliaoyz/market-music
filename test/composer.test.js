import test from "node:test";
import assert from "node:assert/strict";
import { createComposer } from "../src/composer.js";
import { musicalMapping } from "../src/live-music.js";

test("open composer preserves public mappings, reset and inspect isolation", () => {
  const frame = { degree: 2, chordDegree: 0, tradeRate: 4, accent: 1, event: null };
  const composer = createComposer({ seed: 42 });
  const input = { beat: 0, controls: { energy: 1 }, frame };
  const result = composer.advance(input);
  assert.deepEqual(result.mapping, musicalMapping(frame, "classic-v2"));
  const snapshot = composer.inspect(); snapshot.last.mapping.note = -1;
  assert.notEqual(composer.inspect().last.mapping.note, -1);
  composer.reset();
  assert.equal(composer.inspect().last, null);
  assert.deepEqual(composer.advance(input), result);
  assert.throws(() => createComposer({ version: "composer-v3" }), /version/);
});
