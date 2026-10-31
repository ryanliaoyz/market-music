import { patternVoices } from "./live-music.js";
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
  const offline = typeof rawContext.startRendering === "function";
  const context = offline ? new Tone.OfflineContext(rawContext) : new Tone.Context({ context: borrowed, lookAhead: 0 });
  const voices = new Set();

  function play(mapping, preset, when, duration) {
    const filter = new Tone.Filter({ context, frequency: mapping.cutoff, type: "lowpass" });
    const distortion = new Tone.Distortion({ context, distortion: mapping.drive / 48 });
    filter.connect(distortion);
    distortion.connect(output);
    const synths = [];
    const notes = mapping.mask !== undefined ? patternVoices(mapping, duration) :
      [[mapping.frequency, mapping.gain], [mapping.harmonyFrequency, mapping.gain * 0.35]]
        .map(([hz, gain]) => ({ hz, gain, offset: 0, duration: duration * 0.7 }));
    for (const { hz, gain, offset, duration: gate } of notes) {
      if (hz === null || gain === 0) continue;
      const synth = new Tone.Synth({ context, oscillator: { type: preset.oscillator },
        envelope: { attack: Math.min(preset.attack, duration / 4), decay: 0.08,
          sustain: preset.id.startsWith("plucky-") ? 0.1 : 0.6, release: preset.release } });
      synth.volume.value = 20 * Math.log10(gain);
      synth.connect(filter);
      synth.triggerAttackRelease(hz, gate, when + offset);
      synths.push(synth);
    }
    const entry = { when, dispose() {
      if (!offline) context.clearTimeout(entry.timer);
      for (const synth of synths) synth.dispose();
      filter.dispose(); distortion.dispose(); voices.delete(entry);
    } };
    voices.add(entry);
    // Tone advances offline timers before native rendering; disconnecting here would erase the graph.
    if (!offline) entry.timer = context.setTimeout(() => entry.dispose(), Math.max(0, when - rawContext.currentTime) + duration + preset.release);
  }

  return {
    play,
    cancelFrom(time) { for (const voice of [...voices]) if (voice.when >= time) voice.dispose(); },
    stop() { for (const voice of [...voices]) voice.dispose(); },
    // The wrapper does not own the native context; the shared engine closes it.
    dispose() { this.stop(); context.dispose(); },
    inspect: () => ({ activeToneFrames: voices.size }),
    render: () => context.render(),
  };
}
