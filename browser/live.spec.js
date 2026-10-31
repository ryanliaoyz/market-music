import { test, expect } from "@playwright/test";

const inspect = page => page.evaluate(() => window.marketMusic.inspect());
const message = (sequence, price) => ({ channel: "ticker", sequence_num: sequence,
  timestamp: "2026-10-30T12:00:00Z", events: [{ type: sequence === 0 ? "snapshot" : "update",
    tickers: [{ product_id: "BTC-USD", price: String(price) }] }] });
const heartbeat = JSON.stringify({ channel: "heartbeats", sequence_num: 0, events: [{ heartbeat_counter: "1" }] });

async function setup(page, { catalogFailure = false, clock = true } = {}) {
  const sockets = [], subscriptions = [], errors = [], closed = [];
  page.on("pageerror", cause => errors.push(cause.message));
  if (clock) await page.clock.install();
  await page.routeWebSocket("wss://advanced-trade-ws.coinbase.com/**", ws => {
    sockets.push(ws);
    ws.onMessage(data => {
      const request = JSON.parse(data); subscriptions.push(request);
      if (request.type === "subscribe" && request.channel === "ticker") {
        ws.send(JSON.stringify({ channel: "subscriptions", events: [{ subscriptions: { ticker: ["BTC-USD"] } }] }));
        ws.send(heartbeat);
      }
    });
    ws.onClose(() => closed.push(ws));
    if (!clock) {
      const timer = setInterval(() => { if (!closed.includes(ws)) ws.send(heartbeat); }, 1000);
      timer.unref(); page.on("close", () => clearInterval(timer));
    }
  });
  if (catalogFailure) await page.route("**/catalog.json", route => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto("/");
  await page.getByLabel("Mode", { exact: true }).selectOption("live");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  expect(sockets).toHaveLength(0);
  const start = async () => {
    const count = sockets.length;
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect.poll(() => sockets.length).toBe(count + 1);
  };
  const send = (sequence, price) => sockets.at(-1).send(JSON.stringify(message(sequence, price)));
  const advance = async ms => {
    while (ms > 0) {
      sockets.at(-1).send(heartbeat);
      const step = Math.min(ms, 1000); await page.clock.runFor(step); ms -= step;
    }
  };
  return { sockets, subscriptions, errors, closed, start, send, advance };
}

test("Start subscribes, buffers five seconds, and renders only delayed prices; Stop unsubscribes", async ({ page }) => {
  const mock = await setup(page); await mock.start();
  await expect.poll(() => mock.subscriptions.length).toBe(2);
  expect(mock.subscriptions).toEqual([{ type: "subscribe", channel: "ticker", product_ids: ["BTC-USD"] },
    { type: "subscribe", channel: "heartbeats" }]);
  await expect(page.getByLabel("Mode", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Speed")).toBeHidden();
  await expect(page.getByRole("slider")).toBeHidden();
  mock.send(0, 100); await expect(page.locator("#status")).toContainText("Buffering");
  await mock.advance(1000); mock.send(1, 110);
  await mock.advance(3900);
  expect((await inspect(page)).visuals.close).toBeNull();
  await expect(page.locator("#status")).toContainText("Buffering");
  await mock.advance(100);
  await expect(page.locator("#status")).toContainText("5 s delayed");
  expect((await inspect(page)).visuals.close).toBe(100);
  expect(mock.sockets).toHaveLength(1); expect(mock.closed).toHaveLength(0);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.poll(() => mock.closed.length).toBe(1);
  expect(mock.subscriptions.slice(-2)).toEqual([{ type: "unsubscribe", channel: "ticker", product_ids: ["BTC-USD"] },
    { type: "unsubscribe", channel: "heartbeats" }]);
  expect((await inspect(page)).playback.frames).toEqual([]);
  await expect(page.getByLabel("Mode", { exact: true })).toBeEnabled();
  await page.getByLabel("Mode", { exact: true }).selectOption("historical");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  expect((await inspect(page)).playback.audio).toBeNull();
  expect(mock.errors).toEqual([]);
});

test("real Web Audio and the debug/chart mapping follow the delayed frame", async ({ page }) => {
  const mock = await setup(page, { clock: false }); await mock.start();
  await page.getByText("Debug panel", { exact: true }).click();
  mock.send(0, 101);
  await expect.poll(async () => (await inspect(page)).playback.audible?.price,
    { intervals: [25], timeout: 8000 }).toBe(101);
  const state = await inspect(page);
  expect(state.playback.audio.contextState).toBe("running");
  expect(state.playback.audio.lastScheduled.gain).toBe(0.11);
  expect(state.playback.audible.playbackOffsetMs - state.playback.audible.sessionOffsetMs).toBe(5000);
  expect(state.debug.frameId).toBe(state.visuals.frameId);
  expect(state.debug.note).toBe(state.playback.audio.lastScheduled.note);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  expect((await inspect(page)).playback.audio.activeVoices).toBe(0);
  expect(mock.errors).toEqual([]);
});

test("network drops reconnect and refill; quiet markets keep the socket open", async ({ page }) => {
  const mock = await setup(page); await mock.start();
  mock.send(0, 100); await expect(page.locator("#status")).toContainText("Buffering");
  await mock.advance(6000);
  expect(mock.sockets).toHaveLength(1); expect(mock.closed).toHaveLength(0);
  mock.sockets[0].close({ code: 1011, reason: "network drop" });
  await expect(page.locator("#status")).toContainText("Reconnecting");
  await page.clock.runFor(1100);
  await expect.poll(() => mock.sockets.length).toBe(2);
  await expect.poll(() => mock.subscriptions.length).toBe(4);
  mock.send(0, 200); await expect(page.locator("#status")).toContainText("Buffering");
  await mock.advance(4900); expect((await inspect(page)).visuals.close).toBeNull();
  await mock.advance(100); expect((await inspect(page)).visuals.close).toBe(200);
  expect((await inspect(page)).playback.latest.return).toBeNull();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  expect(mock.errors).toEqual([]);
});

test("subscription error leaves Stop available; restart recovers despite catalog failure", async ({ page }) => {
  const mock = await setup(page, { catalogFailure: true }); await mock.start();
  mock.sockets[0].send(JSON.stringify({ type: "error", message: "Subscription unavailable" }));
  await expect(page.locator("#status")).toContainText("Subscription unavailable");
  expect(mock.closed).toHaveLength(0);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await mock.start(); mock.send(0, 200);
  await expect(page.locator("#status")).toContainText("Buffering");
  await mock.advance(5000); expect((await inspect(page)).visuals.close).toBe(200);
  expect((await inspect(page)).error).toBeNull();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  expect(mock.errors).toEqual([]);
});

test("Stop during buffering/reconnect cancels work; live mobile controls and reduced motion are usable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const mock = await setup(page); await mock.start(); mock.send(0, 99999.99);
  await expect(page.locator("#status")).toContainText("Buffering");
  await page.getByText("Debug panel", { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  for (const locator of [page.getByLabel("Mode", { exact: true }), page.getByRole("button", { name: "Stop", exact: true }), page.locator("#debug summary")]) {
    const box = await locator.boundingBox(); expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.locator(".event-flash")).toHaveCSS("visibility", "hidden");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByLabel("Mode", { exact: true }).focus(); await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeFocused();
  await mock.start(); mock.sockets.at(-1).close({ code: 1011 });
  await expect(page.locator("#status")).toContainText("Reconnecting");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.clock.runFor(30000); expect(mock.sockets).toHaveLength(2);
  expect((await inspect(page)).playback.state).toBe("stopped");
  expect(mock.errors).toEqual([]);
});
