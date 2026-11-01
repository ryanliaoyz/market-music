import { test, expect } from "./fixtures.js";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { encodeRecording } from "../src/recording-codec.js";
import { eventRecording } from "../test/helpers/event-recordings.js";

test("manifest, icons and shell-only offline launch including shared replay", async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await page.goto("/");
  const manifest = await (await page.request.get("/manifest.webmanifest")).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.scope).toBe("./");
  for (const icon of [...manifest.icons, { src: "icons/apple-touch-icon-180.png", sizes: "180x180" }]) {
    const bytes = await (await page.request.get("/" + icon.src)).body();
    expect(bytes.readUInt32BE(16)).toBe(Number(icon.sizes.split("x")[0]));
    expect(bytes.readUInt32BE(20)).toBe(Number(icon.sizes.split("x")[1]));
  }
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const entries = await page.evaluate(async () => {
    const cache = await caches.open("market-music-shell-v8");
    return (await cache.keys()).map(request => new URL(request.url).pathname);
  });
  expect(entries).toContain("/src/main.js");
  expect(entries).toContain("/src/live-aggregate.js");
  expect(entries).toContain("/src/live-controls.js");
  expect(entries).toContain("/src/composer.js");
  expect(entries).toContain("/src/event-score.js");
  expect(entries).toContain("/src/recording-v3.js");
  expect(entries.some(path => path.startsWith("/data/"))).toBe(false);
  expect(await page.evaluate(async () => {
    await fetch("/data/sessions.json");
    return (await (await caches.open("market-music-shell-v8")).keys()).length;
  })).toBe(entries.length);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#status")).toContainText("Offline");
  const hash = encodeRecording({ durationMs: 1000, frames: [{ offsetMs: 0, price: 100,
    presetId: "classic-v1", note: 60, harmony: null, intensity: 0, event: null }] });
  await page.goto("/" + hash);
  await page.locator("#play").click();
  await expect.poll(() => page.evaluate(() => window.marketMusic.inspect().playback.audio?.contextState)).toBe("running");
  await expect(page.locator("#recording-error")).toBeEmpty();
  const replay = await context.newPage();
  await replay.goto("/" + encodeRecording(eventRecording()));
  await replay.locator("#play").click();
  await expect.poll(() => replay.evaluate(() => window.marketMusic.inspect().playback.audio?.rack?.last?.renderer)).toBe("rack-v3");
  await expect(replay.locator("#recording-error")).toBeEmpty();
});

test("new shell waits for old clients and activation removes only app-owned old caches", async ({ page, context }) => {
  const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
  let worker = source.replace("}v8`", "}v7`");
  const types = { js: "application/javascript", css: "text/css", html: "text/html", webmanifest: "application/manifest+json", png: "image/png" };
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    try {
      const body = path === "/sw.js" ? worker : await readFile(new URL(".." + (path === "/" ? "/index.html" : path), import.meta.url));
      response.writeHead(200, { "Content-Type": types[path.split(".").at(-1)] ?? (path === "/" ? "text/html" : "application/json"), "Cache-Control": "no-store" });
      response.end(body);
    } catch (cause) {
      response.writeHead(404); response.end(cause.message);
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    await page.goto(url);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      await caches.open("market-music-shell-obsolete");
      await caches.open("unrelated-cache");
    });
    await page.reload();
    worker = source;
    const replacementReady = context.waitForEvent("serviceworker");
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
    const replacement = await replacementReady;
    await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting))).toBe(true);
    expect(await page.evaluate(() => navigator.serviceWorker.controller.state)).toBe("activated");
    const next = await context.newPage();
    await page.close();
    // Let activation finish before navigation can become another old-worker client.
    await expect.poll(() => replacement.evaluate(() =>
      !self.registration.waiting && self.registration.active?.state === "activated")).toBe(true);
    await next.goto(url);
    await expect.poll(() => next.evaluate(() => caches.keys())).toEqual(expect.arrayContaining(["market-music-shell-v8", "unrelated-cache"]));
    expect(await next.evaluate(() => caches.keys())).not.toContain("market-music-shell-v7");
    expect(await next.evaluate(() => caches.keys())).not.toContain("market-music-shell-obsolete");
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
