import { test, expect } from "./fixtures.js";
import { encodeRecording } from "../src/recording-codec.js";
import { recordingCorpus } from "../test/helpers/recordings.js";

for (const clip of [recordingCorpus()[0], recordingCorpus()[4]]) {
  test(`${clip.frames[0].presetId} replay is unverified and volume is session-only`, async ({ page }) => {
    await page.goto("/" + encodeRecording(clip));
    await expect(page.locator("#replay-product")).toHaveText("shared clip · unverified");
    await expect(page.locator("#replay-product")).toBeVisible();
    await expect(page.locator("#live-product")).toBeHidden();
    await expect(page.locator("#feed-debug")).toBeHidden();
    await page.getByLabel("Volume", { exact: true }).fill("25");
    await page.locator("#play").click();
    await expect.poll(() => page.evaluate(() => window.marketMusic.inspect().playback.audio?.bus.volume)).toBe(0.25);
    await page.getByLabel("Volume", { exact: true }).fill("0");
    await expect.poll(() => page.evaluate(() => window.marketMusic.inspect().playback.audio.bus.volume)).toBe(0);
    await page.locator("#play").click();
    await page.getByLabel("Mode", { exact: true }).selectOption("live");
    await expect(page.locator("#live-product")).toBeVisible();
    await expect(page.locator("#replay-product")).toBeHidden();
    await expect(page.getByLabel("Volume", { exact: true })).toHaveValue("0");
    await page.reload();
    await expect(page.getByLabel("Volume", { exact: true })).toHaveValue("100");
  });
}

for (let presetIndex = 0; presetIndex < 8; presetIndex++) test(`preset ${presetIndex}: maximum clip and fuzzed links stay below −1 dBFS in PCM/WAV`, async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/");
  const result = await page.evaluate(async presetIndex => {
    const { recordingCorpus, fuzzHashes } = await import("/test/helpers/recordings.js");
    const { decodeRecording, recordingMapping } = await import("/src/recording-codec.js");
    const { createSoundEngine } = await import("/src/sound.js");
    const { renderWav } = await import("/src/wav.js");
    const clips = [recordingCorpus()[presetIndex]];
    clips.push({ durationMs: 1000, frames: clips[0].frames.map((frame, i) => ({ ...frame, offsetMs: i })) });
    let rejected = 0, accepted = 0, maxPeak = 0, wavPeak = 0;
    for (const [i, hash] of fuzzHashes(96).entries()) {
      if (i % 8 !== presetIndex) continue;
      let clip;
      try { clip = decodeRecording(hash); } catch { rejected++; continue; }
      clips.push(clip); accepted++;
    }
    for (const clip of clips) {
      const context = new OfflineAudioContext(1, Math.ceil(clip.durationMs * 44.1), 44100);
      const engine = createSoundEngine({ bars: [], openingGapReturn: null }, { context });
      try {
        for (const frame of clip.frames) engine.playMapping(recordingMapping(frame), { when: frame.offsetMs / 1000, duration: 0.47 });
        const data = (await engine.renderOffline()).getChannelData(0);
        let peak = 0;
        for (const sample of data) {
          if (!Number.isFinite(sample)) throw new Error("Nonfinite rendered sample");
          peak = Math.max(peak, Math.abs(sample));
        }
        if (peak === 0) throw new Error("Unexpected silent render");
        maxPeak = Math.max(maxPeak, peak);
      } finally { await engine.dispose(); }
    }
    for (const clip of [recordingCorpus()[presetIndex]]) {
      const bytes = new DataView(await (await renderWav(clip)).arrayBuffer());
      for (let at = 44; at < bytes.byteLength; at += 2) wavPeak = Math.max(wavPeak, Math.abs(bytes.getInt16(at, true)) / 32768);
    }
    return { rejected, accepted, maxPeak, wavPeak };
  }, presetIndex);
  expect(result.rejected + result.accepted).toBe(12);
  expect(result.maxPeak).toBeGreaterThan(0);
  expect(result.maxPeak).toBeLessThanOrEqual(10 ** (-1 / 20));
  expect(result.wavPeak).toBeGreaterThan(0);
  expect(result.wavPeak).toBeLessThanOrEqual(10 ** (-1 / 20));
});

test("production bus limits overload, attenuates highs and honors mute/volume", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { createSoundEngine } = await import("/src/sound.js");
    // Capture only the input node; the implementation constructs and processes the real bus.
    async function render(frequency, gain, volume) {
      const context = new OfflineAudioContext(1, 44100, 44100);
      const createGain = context.createGain.bind(context);
      let input;
      context.createGain = () => { const node = createGain(); input ??= node; return node; };
      const engine = createSoundEngine({ bars: [], openingGapReturn: null }, { context, volume });
      const oscillator = context.createOscillator();
      const boost = createGain(); boost.gain.value = gain;
      oscillator.frequency.value = frequency;
      oscillator.connect(boost); boost.connect(input); oscillator.start(0);
      const data = (await engine.renderOffline()).getChannelData(0);
      let peak = 0, sum = 0;
      for (let i = 0; i < data.length; i++) {
        peak = Math.max(peak, Math.abs(data[i]));
        if (i >= 22050) sum += data[i] ** 2;
      }
      oscillator.disconnect(); boost.disconnect(); await engine.dispose();
      return { peak, rms: Math.sqrt(sum / 22050) };
    }
    return { low: await render(1000, 0.1, 1), high: await render(20000, 0.1, 1),
      half: await render(1000, 0.1, 0.5), mute: await render(1000, 0.1, 0), overload: await render(1000, 100, 1) };
  });
  expect(result.overload.peak).toBeGreaterThan(0.8);
  expect(result.overload.peak).toBeLessThanOrEqual(10 ** (-1 / 20));
  expect(result.high.rms).toBeLessThan(result.low.rms * 0.25);
  expect(result.half.rms / result.low.rms).toBeCloseTo(0.5, 4);
  expect(result.mute.peak).toBe(0);
});
