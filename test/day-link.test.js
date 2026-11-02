import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeDayLink, decodeDayLink, isDayLink } from "../src/day-link.js";

const ids = ["SPY-2022-09-13", "NVDA-2025-01-27"];
const link = { sessionId: "NVDA-2025-01-27", presetId: "ambient-v1", speed: 1.625, from: 30, to: 90 };

test("day links round-trip catalog choices only", () => {
  const hash = encodeDayLink(link);
  assert.equal(hash, "#day=NVDA-2025-01-27&sound=ambient-v1&speed=1.625&from=30&to=90");
  assert.ok(isDayLink(hash));
  assert.ok(!isDayLink("#recording=v3.AAAA"));
  assert.deepEqual(decodeDayLink(hash, ids), link);
});

test("day links reject unknown days, sounds, speeds and ranges", () => {
  assert.throws(() => decodeDayLink(encodeDayLink(link), ["SPY-2022-09-13"]), /not available/);
  for (const hash of [
    "#day=NVDA-2025-01-27&sound=classic-v2&speed=1&from=0&to=10",
    "#day=NVDA-2025-01-27&sound=classic-v1&speed=3&from=0&to=10",
    "#day=NVDA-2025-01-27&sound=classic-v1&speed=1&from=10&to=10",
    "#day=NVDA-2025-01-27&sound=classic-v1&speed=1&from=0&to=390",
    "#day=NVDA-2025-01-27&sound=classic-v1&speed=1&from=-1&to=10",
    "#day=NVDA-2025-01-27&sound=classic-v1&speed=1&from=1.5&to=10",
    "#day=NVDA-2025-01-27&sound=classic-v1&speed=1&from=0",
    "#day=NVDA-2025-01-27&sound=classic-v1&speed=1&from=0&to=10&to=11",
    "#day=NVDA-2025-01-27&sound=classic-v1&speed=1&from=0&to=10&extra=1",
    "#day=../data/x&sound=classic-v1&speed=1&from=0&to=10",
    `#day=NVDA-2025-01-27&sound=classic-v1&speed=1&from=0&to=10${"&".repeat(200)}`,
  ]) assert.throws(() => decodeDayLink(hash, ids), Error, hash);
  assert.throws(() => encodeDayLink({ ...link, from: 90 }), /Invalid day link/);
});
