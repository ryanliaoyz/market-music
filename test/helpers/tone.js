// Mock only the external Tone API; engine, mapping and native graph remain real.
export function fakeTone() {
  const nodes = [], contexts = [];
  class Context {
    constructor(options) { this.options = options; this.timers = new Map(); contexts.push(this); }
    setTimeout(callback, delay) { const id = this.timers.size + 1; this.timers.set(id, { callback, delay }); return id; }
    clearTimeout(id) { this.timers.delete(id); }
    dispose() { this.disposed = true; this.options.context.close(); }
  }
  class Node {
    constructor(options) { this.options = options; this.volume = {}; nodes.push(this); }
    connect(output) { this.output = output; }
    triggerAttackRelease(...args) { this.trigger = args; }
    dispose() { this.disposed = true; }
  }
  return { Context, Synth: Node, Filter: Node, Distortion: Node, nodes, contexts };
}
