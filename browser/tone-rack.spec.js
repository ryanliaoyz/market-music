import { test, expect } from "./fixtures.js";

test("vendored Tone allocates no nodes per frame, after preset changes or idle, and renders the rack audibly", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { createSoundEngine } = await import("/src/sound.js");
    const { musicalMapping } = await import("/src/live-music.js");
    const { LIVE_PRESETS } = await import("/src/presets.js");
    let nativeNodes = 0, toneNodes = 0;
    const originals = new Map();
    for (const name of Object.getOwnPropertyNames(BaseAudioContext.prototype).filter(name => name.startsWith("create"))) {
      const original = BaseAudioContext.prototype[name];
      originals.set(name, original);
      BaseAudioContext.prototype[name] = function (...args) { nativeNodes++; return original.apply(this, args); };
    }
    const constructors = new Map();
    const tone = new Proxy(Tone, { get(target, name) {
      const value = target[name];
      if (typeof value !== "function") return value;
      if (!constructors.has(name)) constructors.set(name, new Proxy(value, {
        construct(target, args) { toneNodes++; return Reflect.construct(target, args); },
      }));
      return constructors.get(name);
    } });
    const context = new AudioContext();
    const engine = createSoundEngine({ bars: [], openingGapReturn: null }, { context, tone });
    const mapping = id => musicalMapping({ degree: 7, chordDegree: 3, tradeRate: 20, accent: 3 }, id);
    try {
      await engine.resume();
      const baseline = { nativeNodes, toneNodes };
      for (let frame = 0; frame < 80; frame++) {
        engine.playMapping(mapping(LIVE_PRESETS[frame % 4].id), { when: context.currentTime + 0.05,
          energy: frame % 5, beatIndex: frame, hits: [1, 2, 3, 1], beatDuration: 0.5 });
        engine.cancelScheduled(context.currentTime + 0.001);
      }
      // Cross PolySynth's normal idle-collection interval before retriggering.
      await new Promise(resolve => setTimeout(resolve, 1600));
      for (const preset of LIVE_PRESETS) engine.playMapping(mapping(preset.id), { when: context.currentTime + 0.05 });
      const after = { nativeNodes, toneNodes };
      engine.stop();
      const stopped = engine.inspect();
      await engine.resume();
      const restarted = engine.inspect();
      await engine.dispose();

      const offline = new OfflineAudioContext(1, 44100, 44100);
      const renderer = createSoundEngine({ bars: [], openingGapReturn: null }, { context: offline });
      let peak = 0;
      try {
        await renderer.prepare();
        renderer.playMapping(mapping("ambient-v2"), { when: 0, energy: 3, beatIndex: 1, hits: [1, 2, 3, 1] });
        for (const sample of (await renderer.renderOffline()).getChannelData(0)) {
          if (!Number.isFinite(sample)) throw new Error("Nonfinite rack output");
          peak = Math.max(peak, Math.abs(sample));
        }
      } finally { await renderer.dispose(); }
      return { baseline, after, stoppedRack: stopped.rack, stoppedFrames: stopped.activeToneFrames,
        restarted: restarted.rack.ready, borrowedState: context.state, peak };
    } finally {
      await engine.dispose(); await context.close();
      for (const [name, original] of originals) BaseAudioContext.prototype[name] = original;
    }
  });
  expect(result.after).toEqual(result.baseline);
  expect(result.stoppedRack).toBeNull();
  expect(result.stoppedFrames).toBe(0);
  expect(result.restarted).toBe(true);
  expect(result.borrowedState).toBe("running");
  expect(result.peak).toBeGreaterThan(0.001);
  expect(result.peak).toBeLessThanOrEqual(10 ** (-1 / 20));
});
