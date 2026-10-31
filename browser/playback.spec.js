import { test, expect } from "@playwright/test";

const inspect = page => page.evaluate(() => window.marketMusic.inspect());
const field = (page, name) => page.locator(`[data-debug="${name}"]`);
const pageErrors = new WeakMap();

async function seek(page, minute) {
  const slider = page.getByRole("slider", { name: "Session time (New York)" });
  await slider.fill(String(minute));
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  pageErrors.set(page, errors);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  await page.getByText("Debug panel", { exact: true }).click();
});

test.afterEach(({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

test("bundled session loads paused and debug previews follow keyboard seeking", async ({ page }) => {
  await expect(page.getByLabel("Trading day").locator("option")).toHaveCount(8);
  await expect(page.locator("#status")).toContainText("383 observed minutes");
  await expect(page.getByLabel("Speed")).toHaveValue("1.625");
  await expect(field(page, "state")).toHaveText("paused · mapping preview");
  await expect(field(page, "bar")).toHaveText("09:30 · minute 0 · bar 0 (zero-based)");
  await expect(field(page, "return")).toHaveText("n/a");
  await expect(field(page, "rules")).toContainText("opening-gong");
  expect((await inspect(page)).playback.audio).toBeNull();

  const slider = page.getByRole("slider");
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuetext", "09:31");
  await expect(field(page, "bar")).toContainText("minute 1 · bar 1");
  await expect(field(page, "return")).toHaveText("0.1380%");
  await expect(field(page, "note")).toHaveText(/^[A-G].*\(MIDI \d+\)$/);
  await expect(field(page, "gain")).toHaveText(/^0\.\d{4}$/);
  await expect(field(page, "drive")).toHaveText(/^\d+\.\d{4}$/);
  const snapshot = await inspect(page);
  expect(snapshot.visuals.close).toBe(402.805);
  expect(snapshot.debug.minute).toBe(snapshot.visuals.minute);
  expect(snapshot.debug.barIndex).toBe(snapshot.playback.barIndex);

  const summary = page.getByText("Debug panel", { exact: true });
  await summary.focus();
  await summary.press("Enter");
  await expect(field(page, "note")).toBeHidden();
  await summary.press("Enter");
  await expect(field(page, "note")).toBeVisible();
});

test("real audio advances, pauses, resumes, seeks and changes speed", async ({ page }) => {
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await inspect(page)).playback.minute).toBeGreaterThan(1);
  expect((await inspect(page)).playback.audio.contextState).toBe("running");
  await expect(field(page, "state")).toHaveText("playing");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await inspect(page);
  await expect(field(page, "state")).toHaveText("paused · mapping preview");
  // Cross several scheduler ticks to catch a timer that survives pause.
  await page.waitForTimeout(200);
  expect((await inspect(page)).playback.position).toBe(paused.playback.position);
  expect((await inspect(page)).playback.audio.activeVoices).toBe(0);

  await seek(page, 100);
  await expect(page.getByRole("slider")).toHaveAttribute("aria-valuetext", "11:10");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await inspect(page)).playback.minute).toBeGreaterThan(100);
  await page.getByLabel("Speed").selectOption("0.5");
  await expect.poll(async () => (await inspect(page)).playback.speed).toBe(0.5);
  await seek(page, 200);
  await expect.poll(async () => (await inspect(page)).debug.minute).toBeGreaterThanOrEqual(200);
  await expect(field(page, "state")).toHaveText("playing");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const current = await inspect(page);
  expect(current.debug.minute).toBe(current.playback.minute);
  expect(current.visuals.minute).toBe(current.playback.minute);
});

test("all Tone presets run on real Web Audio and switch during playback", async ({ page }) => {
  await page.getByLabel("Sound preset").selectOption("ambient-v1");
  expect((await inspect(page)).debug.presetId).toBe("ambient-v1");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  for (const id of ["ambient-v1", "plucky-v1", "bass-heavy-v1", "classic-v1"]) {
    await page.getByLabel("Sound preset").selectOption(id);
    await expect.poll(async () => (await inspect(page)).playback.audio.lastScheduled?.presetId).toBe(id);
    expect((await inspect(page)).debug.presetId).toBe(id);
  }
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  expect((await inspect(page)).playback.audio.activeToneFrames).toBe(0);
  await page.getByLabel("Mode", { exact: true }).selectOption("live");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  expect(await page.evaluate(async () => {
    const { createSoundEngine } = await import("/src/sound.js");
    const context = new AudioContext();
    const engine = createSoundEngine({ bars: [], openingGapReturn: null }, { context });
    await engine.resume();
    const { mapSoundFrame } = await import("/src/sound.js");
    engine.playMapping(mapSoundFrame({ close: 100, return: null, vwap: null },
      { low: 100, high: 100, peakVolatility: 0 }, { gain: 0.11, presetId: "ambient-v1" }),
      { when: context.currentTime + 0.1 });
    await engine.dispose();
    const state = context.state;
    await context.close();
    return state;
  })).toBe("running");
});

test("missing minutes clear mapping and the price marker", async ({ page }) => {
  const missing = await page.evaluate(async () => {
    const { loadCatalog, loadSession } = await import("/src/data.js");
    return (await loadSession((await loadCatalog())[0])).missingMinutes[0];
  });
  const sigma = await field(page, "sigma").textContent();
  expect(sigma).not.toBe("n/a");
  await seek(page, missing);
  await expect(field(page, "bar")).toContainText("rest — no observed bar");
  for (const name of ["note", "return", "gain", "drive"]) {
    await expect(field(page, name)).toHaveText("n/a");
  }
  await expect(field(page, "rules")).toHaveText("none");
  await expect(field(page, "sigma")).toHaveText(sigma);
  await expect(page.locator('[data-visual="point"]')).toBeHidden();
  const snapshot = await inspect(page);
  expect(snapshot.debug.barIndex).toBeNull();
  expect(snapshot.visuals.close).toBeNull();
  await seek(page, 0);
  await expect(page.locator('[data-visual="point"]')).toBeVisible();
  await expect(field(page, "rules")).toContainText("opening-gong");
});

test("end stops audio, speed changes preserve end, and Play restarts", async ({ page }) => {
  await page.getByLabel("Speed").selectOption("4");
  await seek(page, 389);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(field(page, "state")).toHaveText("ended");
  await expect(page.locator("#time")).toHaveText("16:00 — End");
  await expect(field(page, "bar")).toHaveText("No current bar");
  expect((await inspect(page)).playback.audio.activeVoices).toBe(0);
  await page.getByLabel("Speed").selectOption("0.5");
  await expect(field(page, "state")).toHaveText("ended");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(field(page, "state")).toHaveText("playing");
  await expect(field(page, "bar")).toContainText("minute 0 · bar 0");
  await expect(field(page, "rules")).toContainText("opening-gong");
});

test("switching sessions during playback hides stale values and loads paused", async ({ page }) => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route("**/NVDA-2025-01-27.csv", async route => {
    await held;
    await route.continue();
  });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(field(page, "state")).toHaveText("playing");
  try {
    await page.getByLabel("Trading day").selectOption("NVDA-2025-01-27");
    await expect(page.locator("#status")).toHaveText("Loading session…");
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
    await expect(page.locator("#chart")).toBeHidden();
    await expect(page.locator("#debug")).toBeHidden();
    const loading = await inspect(page);
    expect(loading.playback).toBeNull();
    expect(loading.debug).toBeNull();
  } finally {
    release();
  }
  await expect(field(page, "state")).toHaveText("paused · mapping preview");
  await expect(page.locator("#status")).toContainText("370 observed minutes");
  const loaded = await inspect(page);
  expect(loaded.debug.session).toBe("NVDA-2025-01-27");
  expect(loaded.playback.audio).toBeNull();
  expect(loaded.debug.minute).toBe(0);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(async () => (await inspect(page)).playback.minute).toBeGreaterThan(0);
});

test("failed session fetch shows an actionable error and another day recovers", async ({ page }) => {
  await page.route("**/NVDA-2025-01-27.csv", route => route.fulfill({ status: 503, body: "Unavailable" }));
  await page.getByLabel("Trading day").selectOption("NVDA-2025-01-27");
  await expect(page.locator("#status")).toContainText("HTTP 503");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
  await expect(page.locator("#debug")).toBeHidden();
  await expect(page.locator("#chart")).toBeHidden();
  await page.getByLabel("Trading day").selectOption("SPY-2022-09-13");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  await expect(field(page, "state")).toHaveText("paused · mapping preview");
  expect((await inspect(page)).error).toBeNull();
});
