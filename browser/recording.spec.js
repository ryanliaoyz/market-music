import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { encodeRecording } from "../src/recording-codec.js";

const inspect = page => page.evaluate(() => window.marketMusic.inspect());

test("record delayed live, export WAV, and replay a self-contained link", async ({ page, context }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async text => { window.copiedLink = text; } }
    });
  });
  await page.routeWebSocket("wss://advanced-trade-ws.coinbase.com/**", socket => {
    socket.onMessage(data => {
      if (JSON.parse(data).channel === "ticker") socket.send(JSON.stringify({ channel: "ticker", sequence_num: 0, timestamp: "2026-10-30T12:00:00Z",
        events: [{ type: "snapshot", tickers: [{ product_id: "BTC-USD", price: "101" }] }] }));
    });
    let sequence = 1;
    let tradeSequence = 0;
    const timer = setInterval(() => {
      socket.send(JSON.stringify({ channel: "heartbeats", sequence_num: 0, events: [{ heartbeat_counter: "1" }] }));
      socket.send(JSON.stringify({ channel: "ticker", sequence_num: sequence++, timestamp: "2026-10-30T12:00:00Z", events: [{ type: "update", tickers: [{ product_id: "BTC-USD", price: "102" }] }] }));
      socket.send(JSON.stringify({ channel: "market_trades", sequence_num: tradeSequence++, events: [{ type: "update",
        trades: Array.from({ length: 10 }, (_, n) => ({ product_id: "BTC-USD", trade_id: `${tradeSequence}:${n}`,
          price: "102", size: "0.01", side: "BUY", time: "2026-10-30T12:00:00Z" })) }] }));
    }, 250);
    socket.onClose(() => clearInterval(timer));
  });
  await page.goto("/"); await page.getByLabel("Mode", { exact: true }).selectOption("live");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("button", { name: "Record", exact: true })).toBeEnabled({ timeout: 10000 });
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect.poll(async () => (await inspect(page)).recording.frames).toBeGreaterThan(0);
  await page.getByRole("radio", { name: "Plucky", exact: true }).check();
  await page.waitForTimeout(1100);
  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.locator("#recording-error")).toBeEmpty();
  const linkInput = page.getByLabel("Recording link");
  await expect(linkInput).toBeVisible();
  await expect(linkInput).toHaveValue(/^https?:\/\/.+#recording=v2\./);
  const link = await linkInput.inputValue();
  expect(await page.evaluate(() => window.copiedLink)).toBe(link);
  await page.evaluate(link => { location.hash = new URL(link).hash; }, link);
  await expect(page.getByLabel("Mode", { exact: true })).toBeEnabled();
  await page.getByLabel("Mode", { exact: true }).selectOption("historical");
  const fresh = await context.newPage();
  await fresh.goto(link);
  expect((await inspect(fresh)).sharedClip.frames.some(frame => frame.presetId === "plucky-v2")).toBe(true);
  expect((await inspect(fresh)).sharedClip.frames.some(frame => frame.mask === 15 && frame.accent > 0)).toBe(true);
  const downloaded = fresh.waitForEvent("download"); await fresh.getByRole("button", { name: "Download WAV" }).click();
  const download = await downloaded; expect(await download.failure()).toBeNull();
  const bytes = await readFile(await download.path());
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bytes.subarray(44).some(value => value !== 0)).toBe(true);
  await fresh.getByRole("button", { name: "Start", exact: true }).click();
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

for (const version of [1, 2]) test(`v${version} shared links replay and render every preset offline without exchange access`, async ({ page, context }) => {
  await page.goto("/");
  const hash = await page.evaluate(async version => {
    const { encodeRecording } = await import("/src/recording-codec.js");
    return encodeRecording({ durationMs: 2400, frames: ["classic", "ambient", "plucky", "bass-heavy"].map((name, n) =>
      ({ offsetMs: n * 500, price: 100 + n, presetId: `${name}-v${version}`, note: 60,
        harmony: version === 1 ? 64 : 48, intensity: version === 1 ? 0.5 : 1,
        event: n === 2 ? "spike" : null, ...(version === 2 ? { chord: [48, 51, 55], mask: 1, accent: 3 } : {}) })) });
  }, version);
  let sockets = 0; page.on("websocket", () => sockets++);
  await page.goto("/" + hash);
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  await context.setOffline(true);
  const downloaded = page.waitForEvent("download"); await page.getByRole("button", { name: "Download WAV" }).click();
  const download = await downloaded; expect(await download.failure()).toBeNull();
  const bytes = await readFile(await download.path());
  for (let n = 0; n < 4; n++) expect(bytes.subarray(44 + n * 44100, 44 + (n + 1) * 44100).some(value => value !== 0)).toBe(true);
  await expect.poll(async () => (await inspect(page)).recording.exporting).toBe(false);
  await expect(page.locator("#recording-error")).toBeEmpty();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect.poll(async () => (await inspect(page)).playback.audio.lastScheduled?.presetId).toBe(`ambient-v${version}`);
  await expect(page.getByRole("radio", { name: "Ambient", exact: true })).toBeChecked();
  for (const radio of await page.getByRole("radio").all()) await expect(radio).toBeDisabled();
  await expect.poll(async () => (await inspect(page)).playback.reason).toBe("replay-ended");
  expect(sockets).toBe(0);
  await context.setOffline(false);
  await page.goto("/#recording=v1.invalid");
  await expect(page.locator("#recording-error")).toContainText("Unable to open recording");
});
