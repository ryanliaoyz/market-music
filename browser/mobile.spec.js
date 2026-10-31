import { test, expect } from "@playwright/test";
import { encodeRecording } from "../src/recording-codec.js";

test.use({ hasTouch: true });
const inspect = page => page.evaluate(() => window.marketMusic.inspect());
async function visibility(page, hidden) {
  await page.evaluate(hidden => {
    Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: hidden ? "hidden" : "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test("touch layout, first-tap audio, and foreground-only historical playback", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeContext = AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(...args) { super(...args); window.testAudio = this; }
    };
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  await page.locator("#play").tap();
  await expect.poll(async () => (await inspect(page)).playback.audio?.contextState).toBe("running");
  await page.locator("#debug summary").tap();
  for (const size of [{ width: 320, height: 640 }, { width: 640, height: 320 }]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const control of await page.locator("button:visible, select:visible, input[type=range]:visible").all()) {
      expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
  }
  await visibility(page, true); await visibility(page, true);
  const paused = (await inspect(page)).playback;
  expect(paused.state).toBe("paused");
  expect(paused.audio.activeVoices).toBe(0);
  await visibility(page, false);
  await expect(page.locator("#status")).toContainText("Tap Play");
  expect((await inspect(page)).playback.minute).toBe(paused.minute);
  await page.locator("#play").tap();
  await expect.poll(async () => (await inspect(page)).playback.state).toBe("playing");
  await page.evaluate(() => window.testAudio.suspend());
  await expect.poll(async () => (await inspect(page)).playback.state).toBe("paused");
  await expect(page.locator("#status")).toContainText("audio paused by browser");
  expect((await inspect(page)).playback.audio.activeVoices).toBe(0);
});

test("hiding live closes the socket, finishes capture and requires a fresh Start", async ({ page }) => {
  const sockets = [], closed = [];
  await page.routeWebSocket("wss://advanced-trade-ws.coinbase.com/**", socket => {
    sockets.push(socket);
    const timer = setInterval(() => socket.send(JSON.stringify({ channel: "heartbeats", sequence_num: 0, events: [{ heartbeat_counter: "1" }] })), 1000);
    socket.onClose(() => { clearInterval(timer); closed.push(socket); });
    page.on("close", () => clearInterval(timer));
    socket.onMessage(data => {
      if (JSON.parse(data).type !== "subscribe") return;
      socket.send(JSON.stringify({ channel: "heartbeats", sequence_num: 0, events: [{ heartbeat_counter: "1" }] }));
      socket.send(JSON.stringify({ channel: "ticker", sequence_num: 0, timestamp: "2026-10-30T12:00:00Z",
        events: [{ type: "snapshot", tickers: [{ product_id: "BTC-USD", price: "101" }] }] }));
    });
  });
  await page.goto("/");
  await page.locator("#mode").selectOption("live");
  await page.locator("#play").tap();
  await expect(page.locator("#record")).toBeEnabled({ timeout: 10000 });
  await page.locator("#record").tap();
  await visibility(page, true);
  await expect.poll(() => closed.length).toBe(1);
  const snapshot = await inspect(page);
  expect(snapshot.playback.active).toBe(false);
  expect(snapshot.playback.frames).toEqual([]);
  expect(snapshot.playback.audio.activeVoices).toBe(0);
  expect(["armed", "recording"]).not.toContain(snapshot.recording.state);
  await visibility(page, false);
  await page.waitForTimeout(1200);
  expect(sockets).toHaveLength(1);
  await page.locator("#play").tap();
  await expect.poll(() => sockets.length).toBe(2);
  await expect.poll(async () => (await inspect(page)).playback.state).toBe("buffering");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(() => closed.length).toBe(2);
});

test("a pending unlock cannot restart after hiding; shared replay is lazy and stops on interruption", async ({ page }) => {
  await page.addInitScript(() => {
    const resume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function () {
      return new Promise((resolve, reject) => { window.finishResume = () => resume.call(this).then(resolve, reject); });
    };
  });
  const hash = encodeRecording({ durationMs: 30000, frames: [{ offsetMs: 0, price: 100,
    presetId: "classic-v1", note: 60, harmony: null, intensity: 0, event: null }] });
  await page.goto("/" + hash);
  expect((await inspect(page)).playback.audio).toBeNull();
  await page.locator("#play").tap();
  await expect.poll(async () => (await inspect(page)).playback.state).toBe("starting");
  await visibility(page, true);
  await page.evaluate(() => window.finishResume());
  expect((await inspect(page)).playback.state).toBe("stopped");
  expect((await inspect(page)).playback.audio.activeVoices).toBe(0);
  await visibility(page, false);
  await page.locator("#play").tap();
  await page.evaluate(() => window.finishResume());
  await expect.poll(async () => (await inspect(page)).playback.state).toBe("playing");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  expect((await inspect(page)).playback.state).toBe("stopped");
});
