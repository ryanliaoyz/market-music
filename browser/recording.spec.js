import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { encodeRecording } from "../src/recording-codec.js";

const inspect = page => page.evaluate(() => window.marketMusic.inspect());

test("record delayed live, export WAV, and replay a self-contained link", async ({ page, context }) => {
  await page.routeWebSocket("wss://advanced-trade-ws.coinbase.com/**", socket => {
    socket.onMessage(data => {
      if (JSON.parse(data).channel === "ticker") socket.send(JSON.stringify({ channel: "ticker", sequence_num: 0, timestamp: "2026-10-30T12:00:00Z",
        events: [{ type: "snapshot", tickers: [{ product_id: "BTC-USD", price: "101" }] }] }));
    });
    let sequence = 1;
    const timer = setInterval(() => {
      socket.send(JSON.stringify({ channel: "heartbeats", sequence_num: 0, events: [{ heartbeat_counter: "1" }] }));
      socket.send(JSON.stringify({ channel: "ticker", sequence_num: sequence++, timestamp: "2026-10-30T12:00:00Z", events: [{ type: "update", tickers: [{ product_id: "BTC-USD", price: "102" }] }] }));
    }, 250);
    socket.onClose(() => clearInterval(timer));
  });
  await page.goto("/"); await page.getByLabel("Mode", { exact: true }).selectOption("live");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("button", { name: "Record", exact: true })).toBeEnabled({ timeout: 10000 });
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect.poll(async () => (await inspect(page)).recording.frames).toBeGreaterThan(0);
  await page.getByLabel("Sound preset").selectOption("plucky-v1");
  await page.waitForTimeout(1100);
  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  await page.getByRole("button", { name: "Copy link" }).click();
  const link = await page.getByLabel("Recording link").inputValue();
  await page.evaluate(link => { location.hash = new URL(link).hash; }, link);
  await expect(page.getByLabel("Mode", { exact: true })).toBeEnabled();
  await page.getByLabel("Mode", { exact: true }).selectOption("historical");
  const fresh = await context.newPage();
  await fresh.goto(link);
  expect((await inspect(fresh)).sharedClip.frames.some(frame => frame.presetId === "plucky-v1")).toBe(true);
  const downloaded = fresh.waitForEvent("download"); await fresh.getByRole("button", { name: "Download WAV" }).click();
  const download = await downloaded; expect(await download.failure()).toBeNull();
  const bytes = await readFile(await download.path());
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bytes.subarray(44).some(value => value !== 0)).toBe(true);
  await fresh.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await inspect(fresh)).playback.state).toBe("playing");
  await fresh.close();
});

test("recording controls work while the historical catalog is stalled", async ({ page }) => {
  const hash = encodeRecording({ durationMs: 100, frames: [{ offsetMs: 0, price: 100, presetId: "classic-v1", note: 60, harmony: null, intensity: 0, event: null }] });
  await page.route("**/sessions.json", () => {});
  await page.goto("/" + hash, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByLabel("Recording link")).toHaveValue(new RegExp("#recording=v1"));
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download WAV" }).click();
  expect(await (await downloaded).failure()).toBeNull();
});

test("shared links replay and render every preset offline without exchange access", async ({ page }) => {
  await page.goto("/");
  const hash = await page.evaluate(async () => {
    const { encodeRecording } = await import("/src/recording-codec.js");
    return encodeRecording({ durationMs: 2400, frames: ["classic-v1", "ambient-v1", "plucky-v1", "bass-heavy-v1"].map((presetId, n) =>
      ({ offsetMs: n * 500, price: 100 + n, presetId, note: 60, harmony: 64, intensity: 0.5, event: n === 2 ? "spike" : null })) });
  });
  let sockets = 0; page.on("websocket", () => sockets++);
  await page.goto("/" + hash);
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  const downloaded = page.waitForEvent("download"); await page.getByRole("button", { name: "Download WAV" }).click();
  const download = await downloaded; expect(await download.failure()).toBeNull();
  const bytes = await readFile(await download.path());
  for (let n = 0; n < 4; n++) expect(bytes.subarray(44 + n * 44100, 44 + (n + 1) * 44100).some(value => value !== 0)).toBe(true);
  await expect.poll(async () => (await inspect(page)).recording.exporting).toBe(false);
  await expect(page.locator("#recording-error")).toBeEmpty();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await inspect(page)).playback.audio.lastScheduled?.presetId).toBe("ambient-v1");
  await expect.poll(async () => (await inspect(page)).playback.reason).toBe("replay-ended");
  expect(sockets).toBe(0);
  await page.goto("/#recording=v1.invalid");
  await expect(page.locator("#recording-error")).toContainText("Unable to open recording");
});
