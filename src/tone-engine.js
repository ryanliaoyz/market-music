import { patternVoices } from "./live-music.js";
import { EVENT_CAPS, eventKit } from "./event-score.js";

export const RACK_CAPS = Object.freeze({ pad: 4, lead: 2, arp: 4, bass: 1 });

// Tone is pinned to 15.1.22. Its PolySynth pool normally grows lazily and shrinks
// on idle. Freeze that pool here; oscillator restarts would also allocate nodes.
export function createToneVoices(Tone, rawContext, output, eventMode = false) {
  if (!Tone) throw new Error("Tone.js is unavailable. Reload the page to retry.");
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
  const nodes = [];
  const own = node => { nodes.push(node); return node; };
  const filter = own(new Tone.Filter({ context, frequency: 4000, type: "lowpass" }));
  const distortion = own(new Tone.Distortion({ context, distortion: 0.12 }));
  const drive = own(new Tone.Gain({ context, gain: 1 }));
  const delay = own(new Tone.FeedbackDelay({ context, delayTime: 0.375, feedback: 0.22, wet: 0.12 }));
  const reverb = own(new Tone.Reverb({ context, decay: 1.2, preDelay: 0.015, wet: 0.12 }));
  const padGain = own(new Tone.Gain({ context, gain: 1 }));
  const gate = own(new Tone.Gain({ context, gain: 1 }));
  filter.connect(drive); drive.connect(distortion); distortion.connect(delay); delay.connect(reverb); reverb.connect(gate); gate.connect(output);
  padGain.connect(filter);

  function startVoice(voice) {
    voice.oscillator.start(0);
    return { voice, until: 0, when: 0 };
  }
  const parts = {};
  const caps = eventMode ? EVENT_CAPS : RACK_CAPS;
  for (const [name, cap] of Object.entries(caps)) {
    if (name === "bass" && !eventMode) {
      const synth = own(new Tone.MonoSynth({ context, oscillator: { type: "sawtooth" },
        envelope: { attack: 0.01, decay: 0.08, sustain: 0.6, release: 0.12 } }));
      synth.connect(filter);
      parts[name] = [startVoice(synth)];
    } else {
      const synth = own(new Tone.PolySynth({ context, voice: Tone.Synth, maxPolyphony: cap,
        options: { oscillator: { type: name === "pad" ? "sine" : "triangle" },
          envelope: { attack: 0.01, decay: 0.08, sustain: 0.6, release: 0.1 } } }));
      context.clearInterval(synth._gcTimeout);
      parts[name] = Array.from({ length: cap }, () => startVoice(synth._getNextAvailableVoice()));
      synth.connect(name === "pad" ? padGain : filter);
    }
  }
  const kick = own(new Tone.Synth({ context, oscillator: { type: "sine" },
    envelope: { attack: 0.002, decay: 0.08, sustain: 0, release: 0.08 } }));
  kick.oscillator.start(0); kick.connect(distortion);
  const drums = {};
  for (const name of ["snare", "hat"]) {
    const noise = own(new Tone.Noise({ context, type: "white" }));
    const highpass = own(new Tone.Filter({ context, type: "highpass", frequency: name === "hat" ? 7000 : 1800 }));
    const envelope = own(new Tone.AmplitudeEnvelope({ context, attack: 0.001, decay: 0.025,
      sustain: 0, release: name === "hat" ? 0.025 : 0.08 }));
    noise.connect(highpass); highpass.connect(envelope); envelope.connect(distortion); noise.start(0);
    drums[name] = envelope;
  }
  let ready = false, disposed = false, last = null, dropped = 0;
  const readiness = reverb.ready.then(() => { ready = true; });
  const frames = [];

  function note(part, hz, gain, when, gate, preset) {
    const slot = part === "bass" && !eventMode ? parts.bass[0] : parts[part].find(slot => slot.until <= when + 1e-8);
    if (!slot) {
      if (eventMode) throw new Error(`V3 voice capacity exceeded: ${part}`);
      dropped++; return;
    }
    const { voice } = slot;
    voice.envelope.attack = Math.min(preset.attack, gate / 4);
    voice.envelope.release = preset.release;
    voice.volume.setTargetAtTime(20 * Math.log10(Math.max(gain, 0.00001)), when, 0.01);
    voice.frequency.setTargetAtTime(hz, when, 0.005);
    if (eventMode && part === "riser") voice.frequency.setTargetAtTime(hz * 2, when + gate / 2, gate / 4);
    voice.envelope.triggerAttackRelease(gate, when);
    voice.filterEnvelope?.triggerAttackRelease(gate, when);
    slot.when = when; slot.until = when + gate + preset.release;
  }

  function play(mapping, preset, when, duration, { energy, beatDuration = 0.5, beatIndex = mapping.index ?? 0, hits = [] } = {}) {
    gate.gain.setTargetAtTime(1, when, 0.005);
    filter.frequency.setTargetAtTime(mapping.cutoff, when, 0.03);
    drive.gain.setTargetAtTime(1 + mapping.drive / 48, when, 0.03);
    delay.delayTime.setTargetAtTime(beatDuration * 0.75, when, 0.03);
    const voices = mapping.mask !== undefined ? patternVoices(mapping, duration) :
      [[mapping.frequency, mapping.gain], [mapping.harmonyFrequency, mapping.gain * 0.35]]
        .map(([hz, gain]) => ({ hz, gain, offset: 0, duration: duration * 0.7 }));
    const melodicCount = mapping.mask === undefined ? 1 : voices.length - mapping.chord.length;
    voices.forEach(({ hz, gain, offset, duration: gate }, index) => {
      if (hz === null || gain === 0) return;
      const part = index >= melodicCount || preset.texture === "pad" || preset.id === "ambient-v1" ? "pad" :
        preset.texture === "bass" || preset.id === "bass-heavy-v1" ? "bass" : preset.texture === "arpeggio" ? "arp" : "lead";
      note(part, hz, gain, when + offset, gate, preset);
    });
    if (energy >= 2) {
      kick.frequency.setValueAtTime(130, when);
      kick.frequency.setTargetAtTime(45, when + 0.005, 0.025);
      kick.volume.setTargetAtTime(-18, when, 0.005);
      kick.envelope.triggerAttackRelease(0.08, when);
      padGain.gain.setTargetAtTime(0.72, when, 0.008);
      padGain.gain.setTargetAtTime(1, when + 0.08, 0.06);
      for (let step = 0; step < 4; step++) if (hits[step] > 0 || step === 2) {
        drums.hat.triggerAttackRelease(0.02, when + step * beatDuration / 4, 0.025);
      }
      if (energy >= 3 && beatIndex % 2 === 1) drums.snare.triggerAttackRelease(0.06, when, 0.05);
    }
    for (const rule of mapping.rules) {
      if (rule === "drop-crash") drums.snare.triggerAttackRelease(0.2, when, 0.08);
      if (rule === "spike-bell" || rule === "opening-gong") note("arp", rule === "spike-bell" ? 1046.5 : 130.81, 0.06, when, 0.4, preset);
    }
    frames.push({ when, until: when + duration + preset.release });
    while (frames[0]?.until < rawContext.currentTime) frames.shift();
    last = { energy: energy ?? null, delaySeconds: beatDuration * 0.75,
      ducking: energy >= 2, reason: energy >= 2 ? "kick" : "no-kick" };
  }

  function cancelFrom(time) {
    for (const slots of Object.values(parts)) for (const slot of slots) {
      slot.voice.envelope.cancel(time);
      slot.voice.filterEnvelope?.cancel(time);
      slot.voice.frequency.cancelScheduledValues(time);
      slot.voice.volume.cancelScheduledValues(time);
      if (slot.until >= time) {
        slot.voice.envelope.triggerRelease(time);
        slot.voice.filterEnvelope?.triggerRelease(time);
        slot.until = slot.when >= time ? time : time + slot.voice.envelope.release;
      }
    }
    kick.envelope.cancel(time); kick.envelope.triggerRelease(time);
    kick.frequency.cancelScheduledValues(time);
    kick.volume.cancelScheduledValues(time);
    for (const envelope of Object.values(drums)) { envelope.cancel(time); envelope.triggerRelease(time); }
    filter.frequency.cancelScheduledValues(time); delay.delayTime.cancelScheduledValues(time);
    drive.gain.cancelScheduledValues(time); gate.gain.cancelScheduledValues(time);
    padGain.gain.cancelScheduledValues(time); padGain.gain.setTargetAtTime(1, time, 0.02);
    for (let index = frames.length - 1; index >= 0; index--) if (frames[index].when >= time) frames.splice(index, 1);
  }
  function playEvents(events, presetId, when, { skipIfLate = false } = {}) {
    const preset = eventKit(presetId);
    gate.gain.setTargetAtTime(1, skipIfLate ? Math.max(when, rawContext.currentTime) : when, 0.005);
    // Sort only for voice allocation; stable ties retain the score's event order.
    for (const event of [...events].sort((a, b) => a.offset - b.offset)) {
      const time = when + event.offset;
      if (skipIfLate && time < rawContext.currentTime) continue;
      if (event.part === "kick") {
        kick.frequency.setValueAtTime(130, time);
        kick.frequency.setTargetAtTime(45, time + 0.005, 0.025);
        kick.volume.setValueAtTime(20 * Math.log10(Math.max(event.velocity, 0.00001)), time);
        kick.envelope.triggerAttackRelease(event.duration, time);
        padGain.gain.setTargetAtTime(0.72, time, 0.008);
        padGain.gain.setTargetAtTime(1, time + 0.08, 0.06);
      } else if (event.part === "hat" || event.part === "snare") {
        drums[event.part].triggerAttackRelease(event.duration, time, event.velocity);
      } else {
        note(event.part, 440 * 2 ** ((event.note - 69) / 12), event.velocity, time, event.duration, preset);
      }
    }
    const until = when + Math.max(0.5, ...events.map(event => event.offset + event.duration + preset.release));
    frames.push({ when, until });
    while (frames[0]?.until < rawContext.currentTime) frames.shift();
    last = { renderer: "rack-v3", presetId, events: structuredClone(events), ducking: events.some(event => event.part === "kick") };
  }
  return {
    play, playEvents, cancelFrom, ready: readiness,
    silence() {
      cancelFrom(rawContext.currentTime);
      for (const slots of Object.values(parts)) for (const slot of slots) slot.until = rawContext.currentTime;
      gate.gain.cancelScheduledValues(rawContext.currentTime);
      gate.gain.setValueAtTime(0, rawContext.currentTime);
      frames.length = 0;
    },
    dispose() {
      disposed = true;
      for (const node of nodes.reverse()) node.dispose();
      context.dispose();
    },
    inspect: () => ({ activeToneFrames: disposed ? 0 : frames.filter(frame => frame.until > rawContext.currentTime).length,
        rack: { ready, disposed, caps, dropped, last,
        voices: Object.fromEntries(Object.entries(parts).map(([name, slots]) =>
          [name, slots.filter(slot => slot.until > rawContext.currentTime).length])) } }),
    async render() { await readiness; return context.render(); },
  };
}
