// Mock only the external Tone API; engine, mapping and native graph remain real.
export function fakeTone() {
  const nodes = [], contexts = [];
  class Context {
    constructor(options) { this.options = options; this.timers = new Map(); contexts.push(this); }
    setTimeout(callback, delay) { const id = this.timers.size + 1; this.timers.set(id, { callback, delay }); return id; }
    clearTimeout(id) { this.timers.delete(id); }
    clearInterval(id) { this.timers.delete(id); }
    dispose() { this.disposed = true; this.options.context.close(); }
  }
  class Node {
    constructor(options) {
      this.options = options;
      this.volume = new Param(); this.frequency = new Param(); this.gain = new Param(); this.delayTime = new Param();
      this.oscillator = { start() {} };
      this.envelope = new Envelope(options.envelope ?? {});
      nodes.push(this);
    }
    connect(output) { this.output = output; }
    triggerAttackRelease(...args) { this.trigger = args; }
    dispose() { this.disposed = true; }
    start() { this.started = true; }
  }
  class Param {
    events = [];
    history = [];
    setTargetAtTime(...args) { const event = ["target", ...args]; this.events.push(event); this.history.push(event); }
    setValueAtTime(...args) { const event = ["set", ...args]; this.events.push(event); this.history.push(event); }
    cancelScheduledValues(time) { this.events = this.events.filter(event => event[2] < time); }
  }
  class Envelope {
    constructor(options = {}) { Object.assign(this, options); this.events = []; this.notes = []; }
    triggerAttackRelease(...args) { this.events.push(["note", ...args]); this.notes.push(args); }
    triggerRelease(time) { this.events.push(["release", time]); }
    cancel(time) { this.events = this.events.filter(event => event[2] < time); }
  }
  class PolySynth extends Node {
    constructor(options) { super(options); this.voices = []; this.maxPolyphony = options.maxPolyphony; }
    _getNextAvailableVoice() {
      const voice = new Node(this.options.options);
      voice.connect(this);
      this.voices.push(voice);
      return voice;
    }
    dispose() { super.dispose(); this.voices.forEach(voice => voice.dispose()); }
  }
  class AmplitudeEnvelope extends Node {
    constructor(options) { super(options); this.events = []; this.notes = []; }
    triggerAttackRelease(...args) { this.events.push(["note", ...args]); this.notes.push(args); }
    triggerRelease(time) { this.events.push(["release", time]); }
    cancel(time) { this.events = this.events.filter(event => event[2] < time); }
  }
  class Reverb extends Node { ready = Promise.resolve(); }
  class OfflineContext extends Context {
    constructor(context) { super({ context }); }
    async render() { return this.options.context.startRendering(); }
  }
  return { Context, OfflineContext, Synth: Node, MonoSynth: Node, PolySynth, Filter: Node,
    Distortion: Node, FeedbackDelay: Node, Reverb, Gain: Node, Noise: Node, AmplitudeEnvelope, nodes, contexts };
}
