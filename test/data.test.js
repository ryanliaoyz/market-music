import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { loadCatalog, loadSession, parseSessionCsv } from "../src/data.js";

// Only the external file transport is replaced; parsing uses the shipped loader.
const fetchFile = async url => new Response(await readFile(url));
const header = "timestamp,open,high,low,close,volume\n";
const fixture = { date: "2023-12-26", barCount: 2 };
const first = "2023-12-26T09:30:00,100,102,99,101,10";
const third = "2023-12-26T09:32:00,101,103,100,102,20";

test("loader preserves observed bars, exchange minutes, and explicit gaps", () => {
  const result = parseSessionCsv(`${header}${first}\r\n${third}\r\n`, fixture);
  assert.deepEqual(result.bars, [
    { timestamp: "2023-12-26T09:30:00", minute: 0, open: 100, high: 102, low: 99, close: 101, volume: 10 },
    { timestamp: "2023-12-26T09:32:00", minute: 2, open: 101, high: 103, low: 100, close: 102, volume: 20 },
  ]);
  assert.equal(result.missingMinutes.length, 388);
  assert.equal(result.missingMinutes[0], 1);
  assert.equal(result.missingMinutes.at(-1), 389);
  assert.ok(!result.missingMinutes.includes(2));
});

test("CSV boundary rejects malformed values, invalid OHLC, dates, times and ordering", () => {
  const invalid = [
    first.replace(",100,", ",,"),
    first.replace(",100,", ",NaN,"),
    first.replace(",100,", ",Infinity,"),
    first.replace(",100,", ",-1,"),
    first.replace(",102,", ",100,"),
    first.replace(",99,", ",102,"),
    first.replace(",10", ",-10"),
    first.replace(",10", ",1.5"),
    first.replace("2023-12-26", "2023-12-25"),
    first.replace("09:30", "09:29"),
    first.replace("09:30", "16:00"),
    first.replace("09:30", "09:60"),
    first.replace(":00,", ":01,"),
    `${first},extra`,
    `${first}\n${first}`,
    `${third}\n${first}`,
  ];
  for (const row of invalid) {
    assert.throws(() => parseSessionCsv(`${header}${row}`, { ...fixture, barCount: row.split("\n").length }), /Invalid bar/);
  }
  assert.throws(() => parseSessionCsv("bad header", fixture), /header/);
  assert.throws(() => parseSessionCsv(`${header}${first}`, fixture), /count/);
});

test("catalog and CSV network failures propagate", async () => {
  const unavailable = async () => new Response("", { status: 503 });
  await assert.rejects(loadCatalog(unavailable), /sessions.json: HTTP 503/);
  await assert.rejects(loadSession({ file: "SPY-2023-12-26.csv" }, unavailable), /HTTP 503/);
  await assert.rejects(loadCatalog(async () => { throw new Error("offline"); }), /offline/);
});

test("catalog boundary rejects malformed entries, duplicate IDs and unsafe paths", async () => {
  const catalog = await loadCatalog(fetchFile);
  for (const value of [null, [], [{}], [catalog[0], catalog[0]],
    [{ ...catalog[0], file: "../outside.csv" }],
    [{ ...catalog[0], previousClose: 0 }],
    [{ ...catalog[0], barCount: 391 }],
    [{ ...catalog[0], realizedVolatility: -1 }]]) {
    await assert.rejects(loadCatalog(async () => Response.json(value)), /Invalid session catalog/);
  }
});

test("all eight bundles load with expected coverage and match their stories", async () => {
  const catalog = await loadCatalog(fetchFile);
  const expected = {
    "SPY-2022-09-13": [383, -4.38, -2.24, -2.19],
    "SPY-2023-12-26": [370, 0.43, 0.10, 0.34],
    "SPY-2024-08-05": [374, -2.91, -3.99, 1.12],
    "SPY-2025-01-27": [388, -1.39, -2.15, 0.79],
    "SPY-2025-04-03": [383, -4.84, -3.45, -1.44],
    "SPY-2025-04-04": [387, -5.84, -2.54, -3.38],
    "SPY-2025-04-09": [384, 9.36, -0.43, 9.83],
    "NVDA-2025-01-27": [370, -16.90, -12.49, -5.04],
  };
  assert.deepEqual(catalog.map(session => session.id).sort(), Object.keys(expected).sort());
  const files = await readdir(new URL("../data/", import.meta.url));
  assert.deepEqual(files.filter(file => file.endsWith(".csv")).sort(), catalog.map(session => session.file).sort());
  for (const session of catalog) {
    const { bars, missingMinutes } = await loadSession(session, fetchFile);
    const [count, daily, gap, intraday] = expected[session.id];
    assert.equal(bars.length, count, session.id);
    assert.equal(missingMinutes.length, 390 - count);
    assert.equal(bars[0].minute, 0);
    assert.equal(bars.at(-1).minute, session.id === "SPY-2023-12-26" ? 382 : 389);
    if (session.id === "SPY-2023-12-26") {
      assert.deepEqual(missingMinutes.filter(minute => minute > 382), [383, 384, 385, 386, 387, 388, 389]);
    }
    const opening = bars[0].open;
    const closing = bars.at(-1).close;
    assert.ok(Math.abs(100 * (closing / session.previousClose - 1) - daily) < 0.006, session.id);
    assert.ok(Math.abs(100 * (opening / session.previousClose - 1) - gap) < 0.006, session.id);
    assert.ok(Math.abs(100 * (closing / opening - 1) - intraday) < 0.006, session.id);
    assert.ok(Math.abs(closing / session.previousClose - 1 - session.dailyReturn) < 1e-12);
    assert.ok(Math.abs(opening / session.previousClose - 1 - session.gapReturn) < 1e-12);
    assert.ok(Math.abs(closing / opening - 1 - session.sessionReturn) < 1e-12);
    // A second form of realized variance checks the generated catalog values.
    const logPrices = bars.map(bar => Math.log(bar.close));
    const variance = logPrices.slice(1).reduce((sum, price, i) => sum + (price - logPrices[i]) ** 2, 0);
    assert.ok(Math.abs(Math.sqrt(variance) - session.realizedVolatility) < 1e-12);
  }
  const byId = Object.fromEntries(catalog.map(session => [session.id, session]));
  const calm = byId["SPY-2023-12-26"].realizedVolatility;
  assert.ok(catalog.filter(session => session.id !== "SPY-2023-12-26")
    .every(session => session.realizedVolatility > calm));
  assert.equal(byId["SPY-2025-04-04"].previousClose,
    (await loadSession(byId["SPY-2025-04-03"], fetchFile)).bars.at(-1).close);
});
