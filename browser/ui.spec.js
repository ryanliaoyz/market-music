import { readFile } from "node:fs/promises";
import { test, expect } from "./fixtures.js";

const chooseDay = (page, id) => page.locator(`input[name="day"][value="${id}"]`).check();
const inspect = page => page.evaluate(() => window.marketMusic.inspect());

for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  for (const font of ["default", "monospace"]) {
    test(`layout fits at ${viewport.width}px with usable controls (${font} font)`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/?debug");
      if (font === "monospace") {
        await page.locator("#chart").evaluate(node => { node.style.fontFamily = "monospace"; });
      }
      await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
      const startBox = await page.locator("#play").boundingBox();
      expect(startBox.y + startBox.height).toBeLessThanOrEqual(viewport.height);
      const heading = await page.locator("h2").boundingBox();
      const trace = await page.locator("#chart svg").boundingBox();
      expect(trace.x >= heading.x + heading.width || trace.y >= heading.y + heading.height).toBe(true);
      await page.getByText("Debug panel", { exact: true }).click();
      await chooseDay(page, "NVDA-2025-01-27");
      await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();

      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      const chart = await page.locator("#chart").boundingBox();
      for (const label of await page.locator("#chart .chart-scale > span, #chart .chart-axis > span").all()) {
        const box = await label.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(chart.x);
        expect(box.x + box.width).toBeLessThanOrEqual(chart.x + chart.width);
        expect(await label.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
      }
      for (const text of await page.locator(".eyebrow, #chart figcaption, .preset-description, .day-summary, .day-meta, #hearing").all()) {
        expect(await text.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
      }
      const dayCard = page.locator(".day-card").filter({ has: page.locator('input[value="NVDA-2025-01-27"]') });
      for (const control of [page.getByRole("tab", { name: "Replay a day" }), page.getByRole("tab", { name: "Live BTC" }), dayCard, page.getByRole("button", { name: "Start", exact: true }),
        page.getByLabel("Speed"), page.getByLabel("Volume", { exact: true }), page.getByRole("slider", { name: "Session time (New York)" }),
        page.getByRole("slider", { name: "Clip start (New York)" }), page.getByRole("slider", { name: "Clip end (New York)" }),
        page.locator("#debug summary"), ...await page.locator("#preset").getByRole("radio").all()]) {
        const box = await control.boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      }
      await page.getByRole("slider", { name: "Session time (New York)" }).fill("100");
      await expect(page.getByRole("slider", { name: "Session time (New York)" })).toHaveAttribute("aria-valuetext", "11:10");
      await expect(page.locator("#time")).toHaveText("11:10");
    });
  }
}

test("keyboard navigation has visible focus and operates playback controls", async ({ page }) => {
  await page.goto("/?debug");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  const controls = [page.getByRole("tab", { name: "Replay a day" }), page.locator('input[name="day"]').first(), page.getByRole("button", { name: "Start", exact: true }),
    page.getByRole("radio", { name: "Classic", exact: true }), page.getByLabel("Volume", { exact: true }), page.getByLabel("Speed"), page.getByRole("slider", { name: "Session time (New York)" }),
    page.getByRole("slider", { name: "Clip start (New York)" }), page.getByRole("slider", { name: "Clip end (New York)" }),
    page.getByRole("button", { name: "Download WAV" }), page.getByRole("button", { name: "Copy link" }), page.locator("#debug summary")];
  for (const control of controls) {
    await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
    const focusRing = await control.getAttribute("type") === "radio" ? control.locator("+ span") : control;
    await expect(focusRing).toHaveCSS("outline-style", "solid");
    await expect(focusRing).toHaveCSS("outline-width", "3px");
    if (await control.getAttribute("name") === "preset") {
      await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("radio", { name: "Ambient", exact: true })).toBeChecked();
      await expect.poll(() => page.evaluate(() => window.marketMusic.inspect().playback.presetId)).toBe("ambient-v1");
    }
    if (await control.getAttribute("id") === "seek") {
      await page.keyboard.press("ArrowRight");
      await expect(control).toHaveAttribute("aria-valuetext", "09:31");
    }
  }
  await page.keyboard.press("Enter");
  await expect(page.locator("#debug")).toHaveAttribute("open", "");
  await expect(page.locator("#time")).toHaveAttribute("aria-live", "off");
});

test("preset cards retain selection across days and modes with Debug closed", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  await expect(page.locator("#preset").getByRole("radio")).toHaveCount(4);
  await expect(page.locator("#debug")).not.toHaveAttribute("open");
  await page.getByRole("radio", { name: "Plucky", exact: true }).check();
  await expect(page.getByRole("radio", { name: "Plucky", exact: true }).locator("+ .preset-content")).toHaveCSS("border-top-color", "rgb(145, 227, 205)");
  await chooseDay(page, "NVDA-2025-01-27");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  await expect(page.getByRole("radio", { name: "Plucky", exact: true })).toBeChecked();
  await expect.poll(() => page.evaluate(() => window.marketMusic.inspect().playback.presetId)).toBe("plucky-v1");
  await page.getByRole("tab", { name: "Live BTC" }).click();
  await expect(page.getByRole("radio", { name: "Plucky", exact: true })).toBeChecked();
  await expect.poll(() => page.evaluate(() => window.marketMusic.inspect().playback.presetId)).toBe("arpeggio-v3");
  await expect(page.getByRole("slider", { name: "Session time (New York)" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Record", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download WAV" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  await expect(page.locator("#debug")).not.toHaveAttribute("open");
  await page.getByRole("tab", { name: "Replay a day" }).click();
  await expect.poll(() => page.evaluate(() => window.marketMusic.inspect().playback.presetId)).toBe("plucky-v1");
});

test("full-screen scene follows cursor intensity and Start/Stop reflects playback", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  const viewport = page.viewportSize();
  expect(await page.locator("#scene").boundingBox()).toEqual({ x: 0, y: 0, ...viewport });
  const before = await page.locator("#scene").evaluate(node => node.style.getPropertyValue("--scene-hue"));
  await page.getByRole("slider", { name: "Session time (New York)" }).fill("100");
  const after = await page.locator("#scene").evaluate(node => node.style.getPropertyValue("--scene-hue"));
  expect(after).not.toBe(before);
  await expect(page.locator(".aurora")).toHaveCSS("transition-duration", "0s");
  await expect(page.locator(".event-flash")).toHaveCSS("visibility", "hidden");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => window.marketMusic.inspect().playback.state)).toBe("playing");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.evaluate(() => window.marketMusic.inspect().playback.state)).toBe("paused");
});

test("mode tabs follow the ARIA tab pattern and Debug stays hidden without ?debug", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  await expect(page.locator("#debug")).toBeHidden();
  await expect(page.getByRole("tab", { name: "Shared clip" })).toBeHidden();
  const historical = page.getByRole("tab", { name: "Replay a day" }), live = page.getByRole("tab", { name: "Live BTC" });
  await expect(historical).toHaveAttribute("aria-selected", "true");
  await historical.focus();
  await page.keyboard.press("ArrowRight");
  await expect(live).toBeFocused();
  await expect(live).toHaveAttribute("aria-selected", "true");
  await expect(historical).toHaveAttribute("tabindex", "-1");
  await expect(page.locator("#historical-source")).toBeHidden();
  await expect(page.locator("#hearing")).toContainText("trading activity drives the rhythm");
  await expect.poll(async () => (await inspect(page)).mode).toBe("live");
  await page.keyboard.press("Home");
  await expect(historical).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#historical-source")).toBeVisible();
  await expect(page.locator("#debug")).toBeHidden();
});

test("day cards show context without the day's outcome", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  const cards = page.locator(".day-card");
  await expect(cards).toHaveCount(8);
  await expect(page.getByRole("radio", { name: "Hot CPI selloff, SPY, Tue, Sep 13, 2022" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Hot CPI selloff, SPY, Tue, Sep 13, 2022" }))
    .toHaveAccessibleDescription("August inflation came in hotter than expected an hour before the open.");
  for (const text of await cards.allTextContents()) expect(text).not.toMatch(/%/);
  // No price line is drawn ahead of the cursor before Start.
  expect(Number(await page.locator('[data-visual="reveal"]').getAttribute("width"))).toBe(0);
  await page.locator('input[name="day"][value="SPY-2023-12-26"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('input[name="day"][value="SPY-2024-08-05"]')).toBeChecked();
  await expect(page.locator("#status")).toContainText("Global selloff");
});

test("a past day's clip is shared as a link and downloaded as WAV", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?debug");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  await chooseDay(page, "SPY-2025-04-09");
  await expect(page.locator("#status")).toContainText("Tariff pause rally");
  await page.getByRole("radio", { name: "Plucky", exact: true }).check();
  await page.getByLabel("Speed").selectOption("4");
  await page.getByRole("slider", { name: "Clip start (New York)" }).fill("220");
  await page.getByRole("slider", { name: "Clip end (New York)" }).fill("239");
  await expect(page.getByRole("slider", { name: "Clip end (New York)" })).toHaveAttribute("aria-valuetext", "13:30");
  await expect(page.locator("#clip-selection")).toHaveText("13:10–13:30 · 0:02 of audio");
  await expect(page.getByRole("slider", { name: "Session time (New York)" })).toHaveAttribute("aria-valuetext", "13:10");

  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.locator("#share-feedback")).toHaveText("Link copied ✓");
  const link = await page.getByLabel("Share link").inputValue();
  expect(link).toMatch(/\/#day=SPY-2025-04-09&sound=plucky-v1&speed=4&from=220&to=239$/);
  expect(link).not.toContain("debug");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download WAV" }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("market-music-SPY-2025-04-09-1310-1330.wav");
  const bytes = await readFile(await download.path());
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  // 20 minutes at 4x is 2.5 s, plus a 1.5 s release tail, as mono 16-bit 44.1 kHz.
  expect(bytes.length).toBe(44 + Math.ceil(4 * 44100) * 2);
  expect(bytes.subarray(44).some(value => value !== 0)).toBe(true);

  const fresh = await context.newPage();
  await fresh.goto(link);
  await expect(fresh.locator("#status")).toHaveText("Shared clip · Tariff pause rally · 13:10–13:30. Press Start to listen.");
  await expect(fresh.locator('input[name="day"][value="SPY-2025-04-09"]')).toBeChecked();
  await expect(fresh.getByRole("radio", { name: "Plucky", exact: true })).toBeChecked();
  await expect(fresh.getByLabel("Speed")).toHaveValue("4");
  expect(new URL(fresh.url()).hash).toBe("");
  const opened = await inspect(fresh);
  expect(opened.playback).toMatchObject({ presetId: "plucky-v1", speed: 4, minute: 220, range: { from: 220, to: 239 } });
  await fresh.getByRole("button", { name: "Start", exact: true }).click();
  await expect.poll(async () => (await inspect(fresh)).playback.state, { timeout: 10000 }).toBe("ended");
  await expect(fresh.locator("#time")).toHaveText("13:30 — End");
  await fresh.getByRole("button", { name: "Start", exact: true }).click();
  await expect.poll(async () => (await inspect(fresh)).playback.state).toBe("playing");
  expect((await inspect(fresh)).playback.minute).toBeGreaterThanOrEqual(220);
  await fresh.close();
});

test("invalid day links explain the problem and fall back to the first day", async ({ page }) => {
  await page.goto("/#day=SPY-1999-01-01&sound=classic-v1&speed=1&from=0&to=10");
  await expect(page.locator("#recording-error")).toHaveText("Unable to open link: This trading day is not available");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  expect((await inspect(page)).playback.session).toBe("SPY-2022-09-13");
});
