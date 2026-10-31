const SCALE = [0, 3, 5, 7, 10];
const clamp = value => Math.max(0, Math.min(1, value));
const frequency = midi => 440 * 2 ** ((midi - 69) / 12);
const median = sorted => {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length === 0 ? 0 : sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const scaleNote = (position, octaves, root) => {
  const step = Math.round(clamp(position) * octaves * SCALE.length);
  return root + 12 * Math.floor(step / SCALE.length) + SCALE[step % SCALE.length];
};

// Input is the validated, enriched computeFeatures result, not raw market data.
export function createSoundScore(features) {
  const closes = features.bars.map(bar => bar.close);
  const low = Math.min(...closes);
  const high = Math.max(...closes);
  const volumes = features.bars.map(bar => bar.volume).sort((a, b) => a - b);
  const medianVolume = median(volumes);
  const positive = volumes.filter(volume => volume > 0);
  const volumeReference = medianVolume || median(positive) || 1;
  const peakVolatility = Math.max(0, ...features.bars.map(bar => bar.rollingVolatility ?? 0));
  return {
    medianVolume,
    volumeReference,
    peakVolatility,
    bars: features.bars.map((bar, index) => mapSoundFrame({ ...bar, index, sigma: features.sigma },
      { low, high, peakVolatility, volumeReference },
      { opening: index === 0 && features.openingGapReturn !== null && features.openingGapReturn !== 0 })),
  };
}

export function mapSoundFrame(bar, { low, high, peakVolatility, volumeReference }, { gain, opening = false } = {}) {
  const position = price => high === low ? 0.5 : (price - low) / (high - low);
  const note = scaleNote(position(bar.close), 3, 48);
  const intensity = peakVolatility ? clamp((bar.rollingVolatility ?? 0) / peakVolatility) : 0;
  const harmony = bar.return > 0 ? note + 4 : bar.return < 0 ? note - 6 : null;
  const rules = [];
  if (harmony !== null) rules.push(bar.return > 0 ? "up-major-third" : "down-tritone");
  if (bar.event) rules.push(bar.event === "drop" ? "drop-crash" : "spike-bell");
  if (opening) rules.push("opening-gong");
  return { index: bar.index, minute: bar.minute, return: bar.return, sigma: bar.sigma,
    note, frequency: frequency(note), harmony, harmonyFrequency: harmony === null ? null : frequency(harmony),
    gain: gain ?? 0.22 * clamp(Math.log2(1 + bar.volume / volumeReference) / 2),
    intensity, cutoff: 400 + 7600 * intensity, drive: 24 * intensity,
    droneNote: bar.vwap === null ? null : scaleNote(position(bar.vwap), 1, 36), rules };
}

function distortionCurve(drive) {
  return Float32Array.from({ length: 1025 }, (_, index) => {
    const x = index / 512 - 1;
    return drive === 0 ? x : Math.tanh((1 + drive) * x) / Math.tanh(1 + drive);
  });
}

export function createSoundEngine(features, { context: suppliedContext } = {}) {
  const context = suppliedContext ?? new globalThis.AudioContext();
  const score = createSoundScore(features);
  const master = context.createGain();
  master.gain.value = 0.6;
  const compressor = context.createDynamicsCompressor();
  master.connect(compressor);
  compressor.connect(context.destination);
  const voices = new Set();
  let drone = null;
  let last = null;
  let disposed = false;
  let waiting = null;

  function assertOpen() {
    if (disposed) throw new Error("Sound engine is disposed");
  }

  function voice(source, nodes, when, duration, level) {
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, when);
    envelope.gain.linearRampToValueAtTime(level, when + Math.min(0.01, duration / 4));
    envelope.gain.exponentialRampToValueAtTime(0.00001, when + duration);
    const chain = [source, ...nodes, envelope];
    for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
    envelope.connect(master);
    const entry = { source, chain };
    voices.add(entry);
    source.onended = () => {
      for (const node of chain) node.disconnect();
      voices.delete(entry);
    };
    source.start(when);
    source.stop(when + duration);
  }

  function tone(hz, type, level, when, duration, mapping = null) {
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(hz, when);
    const nodes = [];
    if (mapping) {
      const shaper = context.createWaveShaper();
      shaper.curve = distortionCurve(mapping.drive);
      shaper.oversample = "2x";
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(mapping.cutoff, when);
      nodes.push(shaper, filter);
    }
    voice(oscillator, nodes, when, duration, level);
  }

  function hit(rule, when) {
    if (rule === "drop-crash") {
      const buffer = context.createBuffer(1, context.sampleRate * 0.6, context.sampleRate);
      const samples = buffer.getChannelData(0);
      let seed = 12345;
      for (let i = 0; i < samples.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        samples[i] = seed / 2 ** 31 - 1;
      }
      const noise = context.createBufferSource();
      noise.buffer = buffer;
      const filter = context.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = 4000;
      voice(noise, [filter], when, 0.6, 0.14);
    } else if (rule === "spike-bell") {
      tone(1046.5, "sine", 0.16, when, 0.7);
      tone(2093, "sine", 0.06, when, 0.45);
    } else if (rule === "opening-gong") {
      tone(130.81, "sine", 0.18, when, 1.5);
      tone(181.83, "sine", 0.08, when, 1.2);
      tone(275.61, "sine", 0.04, when, 0.9);
    }
  }

  function stop() {
    for (const { source, chain } of voices) {
      source.stop();
      for (const node of chain) node.disconnect();
    }
    voices.clear();
    if (drone) {
      drone.oscillator.stop();
      drone.oscillator.disconnect();
      drone.gain.disconnect();
      drone = null;
    }
    last = null;
  }

  function playMapping(mapping, { when, duration = 0.5, skipIfLate = false } = {}) {
    assertOpen();
    const now = context.currentTime;
    when ??= now;
    if (!Number.isFinite(when)) throw new RangeError("Schedule time must be now or later");
    if (!Number.isFinite(duration) || duration <= 0) throw new RangeError("Beat duration must be positive");
    if (when < now) {
      if (skipIfLate) return null;
      throw new RangeError("Schedule time must be now or later");
    }
    return schedule(mapping, when, duration);
  }

  function schedule(mapping, when, duration) {
    for (const [type, mix] of [["triangle", 1 - mapping.intensity], ["sawtooth", mapping.intensity]]) {
      if (mix === 0 || mapping.gain === 0) continue;
      tone(mapping.frequency, type, mapping.gain * mix, when, duration * 0.9, mapping);
      if (mapping.harmonyFrequency !== null) tone(mapping.harmonyFrequency, type, mapping.gain * mix * 0.35, when, duration * 0.9, mapping);
    }
    if (mapping.droneNote !== null) {
      if (!drone) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        gain.gain.value = 0;
        oscillator.connect(gain);
        gain.connect(master);
        oscillator.start(when);
        drone = { oscillator, gain };
      }
      drone.oscillator.frequency.setValueAtTime(frequency(mapping.droneNote), when);
      drone.gain.gain.setValueAtTime(0.045, when);
      drone.gain.gain.setValueAtTime(0, when + duration);
    }
    for (const rule of mapping.rules) hit(rule, when);
    last = { ...mapping, rules: [...mapping.rules], when, duration };
    return { ...last, rules: [...last.rules] };
  }

  return {
    score,
    playMapping,
    async resume() {
      assertOpen();
      waiting = "audio-context-resume";
      try {
        await context.resume();
      } finally {
        waiting = null;
      }
    },
    playBar(index, { when, duration = 0.5, skipIfLate = false } = {}) {
      assertOpen();
      const now = context.currentTime;
      when ??= now;
      if (!Number.isInteger(index) || index < 0 || index >= score.bars.length) throw new RangeError("Invalid bar index");
      if (!Number.isFinite(when)) throw new RangeError("Schedule time must be now or later");
      if (!Number.isFinite(duration) || duration <= 0) throw new RangeError("Beat duration must be positive");
      // The audio clock can pass the scheduler's deadline between clock reads.
      if (when < now) {
        if (skipIfLate) return null;
        throw new RangeError("Schedule time must be now or later");
      }
      return schedule(score.bars[index], when, duration);
    },
    stop,
    async dispose() {
      if (disposed) return;
      stop();
      master.disconnect();
      compressor.disconnect();
      disposed = true;
      if (!suppliedContext) await context.close();
    },
    inspect() {
      return {
        currentTime: context.currentTime, contextState: context.state, waiting, disposed,
        activeVoices: voices.size, droneActive: drone !== null,
        lastScheduled: last === null ? null : { ...last, rules: [...last.rules] },
      };
    },
  };
}
