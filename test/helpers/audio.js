class AudioParam {
  value = 0;
  events = [];
  setValueAtTime(value, time) { this.events.push(["set", value, time]); }
  linearRampToValueAtTime(value, time) { this.events.push(["linear", value, time]); }
  exponentialRampToValueAtTime(value, time) { this.events.push(["exponential", value, time]); }
  cancelScheduledValues(time) { this.events = this.events.filter(event => event[2] < time); }
}

class AudioNode {
  connections = [];
  gain = new AudioParam();
  frequency = new AudioParam();
  stops = [];
  connect(node) { this.connections.push(node); }
  disconnect() { this.connections = []; }
  start(time) { this.started = time; }
  stop(time) { this.stops.push(time); }
}

// Replace only Web Audio, keeping the project's score and graph construction real.
export class AudioContext {
  currentTime = 10;
  sampleRate = 8000;
  state = "suspended";
  nodes = [];
  destination = new AudioNode();
  node(kind) {
    const node = new AudioNode();
    node.kind = kind;
    this.nodes.push(node);
    return node;
  }
  createGain() { return this.node("gain"); }
  createDynamicsCompressor() { return this.node("compressor"); }
  createOscillator() { return this.node("oscillator"); }
  createWaveShaper() { return this.node("shaper"); }
  createBiquadFilter() { return this.node("filter"); }
  createBufferSource() { return this.node("noise"); }
  createBuffer(channels, length) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  async resume() { this.state = "running"; }
  async close() { this.state = "closed"; }
}
