import { test, expect } from "./fixtures.js";

for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  for (const font of ["default", "monospace"]) {
    test(`layout fits at ${viewport.width}px with usable controls (${font} font)`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      if (font === "monospace") {
        await page.locator(".chart-labels").evaluate(node => { node.style.fontFamily = "monospace"; });
      }
      await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
      const startBox = await page.locator("#play").boundingBox();
      expect(startBox.y + startBox.height).toBeLessThanOrEqual(viewport.height);
      const heading = await page.locator("h2").boundingBox();
      const trace = await page.locator("#chart svg").boundingBox();
      expect(trace.x >= heading.x + heading.width || trace.y >= heading.y + heading.height).toBe(true);
      await page.getByText("Debug panel", { exact: true }).click();
      await page.getByLabel("Trading day").selectOption("NVDA-2025-01-27");
      await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();

      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      const chart = await page.locator("#chart svg").boundingBox();
      for (const label of await page.locator(".chart-labels text").all()) {
        const box = await label.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(chart.x);
        expect(box.x + box.width).toBeLessThanOrEqual(chart.x + chart.width);
      }
      for (const control of [page.getByLabel("Mode", { exact: true }), page.getByLabel("Trading day"), page.getByRole("button", { name: "Start", exact: true }),
        page.getByLabel("Speed"), page.getByLabel("Volume", { exact: true }), page.getByRole("slider", { name: "Session time (New York)" }), page.locator("#debug summary"), ...await page.getByRole("radio").all()]) {
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
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  const controls = [page.getByLabel("Mode", { exact: true }), page.getByLabel("Trading day"), page.getByRole("button", { name: "Start", exact: true }),
    page.getByRole("radio", { name: "Classic", exact: true }), page.getByLabel("Volume", { exact: true }), page.getByLabel("Speed"), page.getByRole("slider", { name: "Session time (New York)" }), page.locator("#debug summary")];
  for (const control of controls) {
    await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
    const focusRing = await control.getAttribute("type") === "radio" ? control.locator("+ .preset-content") : control;
    await expect(focusRing).toHaveCSS("outline-style", "solid");
    await expect(focusRing).toHaveCSS("outline-width", "3px");
    if (await control.getAttribute("type") === "radio") {
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
  await expect(page.getByRole("radio")).toHaveCount(4);
  await expect(page.locator("#debug")).not.toHaveAttribute("open");
  await page.getByRole("radio", { name: "Plucky", exact: true }).check();
  await expect(page.getByRole("radio", { name: "Plucky", exact: true }).locator("+ .preset-content")).toHaveCSS("border-top-color", "rgb(145, 227, 205)");
  await page.getByLabel("Trading day").selectOption("NVDA-2025-01-27");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
  await expect(page.getByRole("radio", { name: "Plucky", exact: true })).toBeChecked();
  await expect.poll(() => page.evaluate(() => window.marketMusic.inspect().playback.presetId)).toBe("plucky-v1");
  await page.getByLabel("Mode", { exact: true }).selectOption("live");
  await expect(page.getByRole("radio", { name: "Plucky", exact: true })).toBeChecked();
  await expect.poll(() => page.evaluate(() => window.marketMusic.inspect().playback.presetId)).toBe("plucky-v2");
  await expect(page.getByRole("slider", { name: "Session time (New York)" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Record", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download WAV" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  await expect(page.locator("#debug")).not.toHaveAttribute("open");
  await page.getByLabel("Mode", { exact: true }).selectOption("historical");
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
