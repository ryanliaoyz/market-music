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
  await page.getByRole("tab", { name: "Live BTC" }).click();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect.poll(async () => (await inspect(page)).rewind.durationMs, { timeout: 12000 }).toBeGreaterThan(1500);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume live" })).toBeVisible();
  const frozen = (await inspect(page)).rewind;
  // The paused chart shows the retained history and is the clip selector.
  await expect(page.locator("#chart figcaption")).toHaveText("Drag across the chart to choose a clip");
  await expect(page.locator(".chart-axis span").last()).toHaveText("paused");
  expect(await page.locator('[data-visual="line"]').getAttribute("d")).toMatch(/^M/);
  const start = page.getByRole("slider", { name: "Clip start", exact: true }), end = page.getByRole("slider", { name: "Clip end", exact: true });
  await expect(end).toHaveAttribute("aria-valuetext", "at pause");
  expect((await inspect(page)).rewind.selection.durationMs).toBe(frozen.endMs - frozen.startMs);
  for (const handle of [start, end]) expect((await handle.boundingBox()).width).toBeGreaterThanOrEqual(44);
  await start.focus();
  await page.keyboard.press("ArrowRight");
  expect((await inspect(page)).rewind.selection.durationMs).toBe(frozen.endMs - 500);
  await expect(start).toHaveAttribute("aria-valuetext", `${((frozen.endMs - 500) / 1000).toFixed(1)} seconds before pause`);
  const selected = (await inspect(page)).rewind.selection;
  expect(JSON.stringify(selected)).not.toMatch(/price|controls|seed|lookahead/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect.poll(async () => (await inspect(page)).rewind.preview?.state).toBe("playing");
  await expect(page.locator('[data-visual="cursor"]')).toHaveAttribute("visibility", "visible");
  // Dragging across the chart replaces the selection and stops the preview.
  await page.locator("#chart").scrollIntoViewIfNeeded();
  const overlay = await page.locator(".rewind-select").boundingBox();
  const svg = await page.locator("#chart svg").boundingBox();
  expect(Math.abs(overlay.y - svg.y)).toBeLessThan(1);
  expect(Math.abs(overlay.height - svg.height)).toBeLessThan(1);
  await page.mouse.move(overlay.x + 2, overlay.y + overlay.height / 2);
  await page.mouse.down();
  await page.mouse.move(overlay.x + overlay.width * 0.75, overlay.y + overlay.height / 2, { steps: 4 });
  await page.mouse.up();
  expect((await inspect(page)).rewind.preview).toBeNull();
  const dragged = (await inspect(page)).rewind.selection;
  expect(dragged.durationMs).toBeGreaterThanOrEqual(500);
  expect(dragged.durationMs).toBeLessThan(frozen.endMs);
  expect((await inspect(page)).rewind.endMs).toBe(frozen.endMs);
  await page.getByRole("button", { name: "Copy link" }).click();
  const link = await page.getByLabel("Share link").inputValue();
  expect(new URL(link).hash).toMatch(/^#recording=v3\./);
  expect(new URL(link).hash.length).toBeLessThanOrEqual(65536);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download WAV" }).click();
  const bytes = await readFile(await (await download).path());
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bytes.length).toBe(44 + Math.ceil(dragged.durationMs * 44.1) * 2);
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
  const replay = await context.newPage();
  await replay.goto(link);
  await context.setOffline(true);
  await expect(replay.locator("figcaption")).toContainText("no market data");
  await replay.locator("#play").click();
  await expect.poll(async () => (await inspect(replay)).playback.audio?.rack?.last?.renderer).toBe("rack-v3");
  await expect(replay.locator("#recording-error")).toBeEmpty();
  await page.reload();
  expect((await inspect(page)).rewind.selection).toBeNull();
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});
