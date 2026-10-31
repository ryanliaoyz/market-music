// Tone is loaded as a pinned local browser script; this module stays Node-importable.
export function createToneVoices(Tone, rawContext, output) {
  if (!Tone) throw new Error("Tone.js is unavailable. Reload the page to retry.");
  // Tone.dispose() closes even a borrowed native context. Keep native ownership
  // in the engine while still disposing Tone's ticker and initialized modules.
  const borrowed = new Proxy(rawContext, {
    get(target, key) {
      if (key === "close") return async () => {};
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set: (target, key, value) => Reflect.set(target, key, value, target),
  });
  const context = new Tone.Context({ context: borrowed, lookAhead: 0 });
  const voices = new Set();

  function play(mapping, preset, when, duration) {
    const filter = new Tone.Filter({ context, frequency: mapping.cutoff, type: "lowpass" });
    const distortion = new Tone.Distortion({ context, distortion: mapping.drive / 48 });
    filter.connect(distortion);
    distortion.connect(output);
    const synths = [];
    for (const [hz, gain] of [[mapping.frequency, mapping.gain], [mapping.harmonyFrequency, mapping.gain * 0.35]]) {
      if (hz === null || gain === 0) continue;
      const synth = new Tone.Synth({ context, oscillator: { type: preset.oscillator },
        envelope: { attack: Math.min(preset.attack, duration / 4), decay: 0.08,
          sustain: preset.id === "plucky-v1" ? 0.1 : 0.6, release: preset.release } });
      synth.volume.value = 20 * Math.log10(gain);
      synth.connect(filter);
      synth.triggerAttackRelease(hz, duration * 0.7, when);
      synths.push(synth);
    }
    const entry = { when, dispose() {
      context.clearTimeout(entry.timer);
      for (const synth of synths) synth.dispose();
      filter.dispose(); distortion.dispose(); voices.delete(entry);
    } };
    voices.add(entry);
    entry.timer = context.setTimeout(() => entry.dispose(), Math.max(0, when - rawContext.currentTime) + duration + preset.release);
  }

  return {
    play,
    cancelFrom(time) { for (const voice of [...voices]) if (voice.when >= time) voice.dispose(); },
    stop() { for (const voice of [...voices]) voice.dispose(); },
    // The wrapper does not own the native context; the shared engine closes it.
    dispose() { this.stop(); context.dispose(); },
    inspect: () => ({ activeToneFrames: voices.size }),
  };
}
