import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadCatalog, loadSession, parseSessionCsv } from "../src/data.js";
import { computeFeatures } from "../src/features.js";

const csv = await readFile(new URL("./fixtures/features.csv", import.meta.url), "utf8");
const session = { date: "2025-01-02", barCount: 21, previousClose: 125 };
const fixture = parseSessionCsv(csv, session);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} ≠ ${expected}`);

test("fixture returns, population sigma, signed events and opening gap are distinct", () => {
  const result = computeFeatures(fixture);
  assert.deepEqual(result.bars.map(bar => bar.return), [null, 0.125, -0.125, ...Array(18).fill(0)]);
  assert.equal(result.returnCount, 20);
  near(result.sigma, 0.03952847075210474);
  near(result.eventThreshold, 0.11858541225631422);
  near(result.openingGapReturn, -0.2);
  assert.deepEqual(result.bars.map(bar => bar.event), [null, "spike", "drop", ...Array(18).fill(null)]);
  assert.equal(result.session, session);
  assert.deepEqual(result.missingMinutes, fixture.missingMinutes);
  assert.equal(fixture.bars[1].return, undefined);
  assert.deepEqual(computeFeatures(fixture), result);
});

test("five-minute realized volatility warms up and expires old returns", () => {
  const { bars } = computeFeatures(fixture);
  assert.equal(bars[0].rollingVolatility, null);
  assert.equal(bars[0].rollingReturnCount, 0);
  assert.equal(bars[1].rollingVolatility, 0.125);
  near(bars[2].rollingVolatility, 0.1767766952966369);
  near(bars[5].rollingVolatility, 0.1767766952966369);
  assert.equal(bars[5].rollingReturnCount, 5);
  assert.equal(bars[6].rollingVolatility, 0.125);
  assert.equal(bars[7].rollingVolatility, 0);
});

test("VWAP accumulates typical price times volume and carries through zero-volume bars", () => {
  const { bars } = computeFeatures(fixture);
  assert.deepEqual(bars.slice(0, 2).map(bar => bar.vwap), [null, null]);
  assert.equal(bars[2].vwap, 99.4375);
  assert.equal(bars[3].vwap, 98.6875);
  assert.equal(bars.at(-1).vwap, 98.6875);
});

test("missing minutes exclude multi-minute returns and use clock time for the rolling window", () => {
  const lines = csv.trim().split("\n");
  const gapped = parseSessionCsv([lines[0], lines[1], lines[2], lines[11], lines[12]].join("\n"),
    { ...session, barCount: 4 });
  const result = computeFeatures(gapped);
  assert.deepEqual(result.bars.map(bar => bar.return), [null, 0.125, null, 0]);
  assert.deepEqual(result.bars.map(bar => bar.rollingReturnCount), [0, 1, 0, 1]);
  assert.deepEqual(result.bars.map(bar => bar.rollingVolatility), [null, 0.125, null, 0]);
  assert.equal(result.returnCount, 2);
  assert.equal(result.sigma, 0.0625);
  assert.equal(result.bars[2].event, null);
});

test("exactly 3 sigma does not fire an event", () => {
  const shortened = parseSessionCsv(csv.trim().split("\n").slice(0, 20).join("\n"),
    { ...session, barCount: 19 });
  const result = computeFeatures(shortened);
  assert.equal(result.eventThreshold, 0.125);
  assert.ok(result.bars.every(bar => bar.event === null));
});

test("flat and single-bar sessions distinguish zero from unavailable statistics", () => {
  const lines = csv.trim().split("\n");
  const flat = parseSessionCsv([lines[0], ...lines.slice(4)].join("\n"), { ...session, barCount: 18 });
  const result = computeFeatures(flat);
  assert.equal(result.openingGapReturn, null);
  assert.equal(result.sigma, 0);
  assert.equal(result.eventThreshold, 0);
  assert.ok(result.bars.every(bar => bar.event === null));
  const single = computeFeatures(parseSessionCsv(lines.slice(0, 2).join("\n"), { ...session, barCount: 1 }));
  assert.equal(single.returnCount, 0);
  assert.equal(single.sigma, null);
  assert.equal(single.eventThreshold, null);
  assert.equal(single.bars[0].event, null);
});

test("all bundled sessions produce finite features and retain observed minute alignment", async () => {
  const fetchFile = async url => new Response(await readFile(url));
  for (const session of await loadCatalog(fetchFile)) {
    const loaded = await loadSession(session, fetchFile);
    const result = computeFeatures(loaded);
    assert.deepEqual(result.bars.map(bar => bar.minute), loaded.bars.map(bar => bar.minute));
    near(result.openingGapReturn, session.gapReturn);
    assert.ok(Number.isFinite(result.sigma));
    for (const bar of result.bars) {
      for (const value of [bar.return, bar.rollingVolatility, bar.vwap]) {
        assert.ok(value === null || Number.isFinite(value));
      }
    }
  }
});
