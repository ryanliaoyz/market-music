import { test, expect } from "@playwright/test";

for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  for (const font of ["default", "monospace"]) {
    test(`layout fits at ${viewport.width}px with usable controls (${font} font)`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      if (font === "monospace") {
        await page.addStyleTag({ content: ".chart-labels { font-family: monospace; }" });
      }
      await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
      await page.getByText("Debug panel", { exact: true }).click();
      await page.getByLabel("Trading day").selectOption("NVDA-2025-01-27");
      await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();

      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      const chart = await page.locator("#chart svg").boundingBox();
      for (const label of await page.locator(".chart-labels text").all()) {
        const box = await label.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(chart.x);
        expect(box.x + box.width).toBeLessThanOrEqual(chart.x + chart.width);
      }
      for (const control of [page.getByLabel("Trading day"), page.getByRole("button", { name: "Play", exact: true }),
        page.getByLabel("Speed"), page.getByRole("slider"), page.locator("#debug summary")]) {
        const box = await control.boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      }
      await page.getByRole("slider").fill("100");
      await expect(page.getByRole("slider")).toHaveAttribute("aria-valuetext", "11:10");
      await expect(page.locator("#time")).toHaveText("11:10");
    });
  }
}

test("keyboard navigation has visible focus and operates playback controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
  const controls = [page.getByLabel("Trading day"), page.getByRole("button", { name: "Play", exact: true }),
    page.getByLabel("Speed"), page.getByRole("slider"), page.locator("#debug summary")];
  for (const control of controls) {
    await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
    await expect(control).toHaveCSS("outline-style", "solid");
    await expect(control).toHaveCSS("outline-width", "3px");
    if (await control.getAttribute("id") === "seek") {
      await page.keyboard.press("ArrowRight");
      await expect(control).toHaveAttribute("aria-valuetext", "09:31");
    }
  }
  await page.keyboard.press("Enter");
  await expect(page.locator("#debug")).toHaveAttribute("open", "");
  await expect(page.locator("#time")).toHaveAttribute("aria-live", "off");
});
