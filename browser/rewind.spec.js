import { test, expect } from "./fixtures.js";
import { readFile } from "node:fs/promises";

const inspect = page => page.evaluate(() => window.marketMusic.inspect());

test("pause selects rendered history, previews, exports and shares offline; resume returns to fresh Live", async ({ page, context }) => {
  const errors = [], writes = [], sockets = [];
  page.on("pageerror", error => errors.push(error.message));
  context.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.routeWebSocket("wss://advanced-trade-ws.coinbase.com/**", socket => {
    sockets.push(socket);
    socket.onMessage(data => {
      const request = JSON.parse(data);
      if (request.type === "subscribe" && request.channel === "ticker") socket.send(JSON.stringify({
        channel: "ticker", sequence_num: 0, timestamp: "2026-10-30T12:00:00Z",
        events: [{ type: "snapshot", tickers: [{ product_id: "BTC-USD", price: "100", best_bid: "100", best_ask: "100" }] }],
      }));
    });
    const timer = setInterval(() => socket.send(JSON.stringify({ channel: "heartbeats", sequence_num: 0,
      events: [{ heartbeat_counter: "1" }] })), 250);
    socket.onClose(() => clearInterval(timer));
    page.on("close", () => clearInterval(timer));
  });
  await page.goto("/");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.getByLabel("Mode", { exact: true }).selectOption("live");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect.poll(async () => (await inspect(page)).rewind.durationMs, { timeout: 12000 }).toBeGreaterThan(1500);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume live" })).toBeVisible();
  const frozen = (await inspect(page)).rewind;
  await page.getByLabel("Start · rewind (seconds)").focus();
  await page.keyboard.press("ArrowRight");
  expect((await inspect(page)).rewind.selection.durationMs).toBe(frozen.endMs - 500);
  const selected = (await inspect(page)).rewind.selection;
  expect(JSON.stringify(selected)).not.toMatch(/price|controls|seed|lookahead/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect.poll(async () => (await inspect(page)).rewind.preview?.state).toBe("playing");
  await page.getByLabel("End (seconds)").fill(String(frozen.endMs - 100));
  expect((await inspect(page)).rewind.preview).toBeNull();
  expect((await inspect(page)).rewind.endMs).toBe(frozen.endMs);
  await page.getByRole("button", { name: "Copy link" }).click();
  const link = await page.getByLabel("Recording link").inputValue();
  expect(new URL(link).hash).toMatch(/^#recording=v3\./);
  expect(new URL(link).hash.length).toBeLessThanOrEqual(65536);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download WAV" }).click();
  const bytes = await readFile(await (await download).path());
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bytes.length).toBe(44 + Math.ceil((selected.durationMs - 100) * 44.1) * 2);
  expect(bytes.subarray(44).some(value => value !== 0)).toBe(true);
  await page.evaluate(() => {
    const resume = AudioContext.prototype.resume; let next = true;
    AudioContext.prototype.resume = function () {
      if (!next) return resume.call(this);
      next = false;
      return new Promise(resolve => { window.finishPreviewUnlock = resolve; });
    };
  });
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect.poll(async () => (await inspect(page)).rewind.preview?.state).toBe("starting");
  await page.getByRole("button", { name: "Resume live" }).click();
  await page.evaluate(() => window.finishPreviewUnlock());
  await expect.poll(() => sockets.length).toBe(2);
  await expect(page.locator("#status")).toContainText("Buffering");
  expect((await inspect(page)).rewind.preview).toBeNull();
  expect((await inspect(page)).rewind.endMs).toBe(frozen.endMs);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  expect((await inspect(page)).rewind.durationMs).toBe(0);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await context.setOffline(true);
  const replay = await context.newPage();
  await replay.goto(link);
  await expect(replay.locator("figcaption")).toContainText("no market data");
  await replay.locator("#play").click();
  await expect.poll(async () => (await inspect(replay)).playback.audio?.rack?.last?.renderer).toBe("rack-v3");
  await expect(replay.locator("#recording-error")).toBeEmpty();
  await page.reload();
  expect((await inspect(page)).rewind.selection).toBeNull();
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});
