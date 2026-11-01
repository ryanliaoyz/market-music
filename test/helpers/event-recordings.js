export function eventRecording() {
  return { version: 3, renderer: "rack-v3", durationMs: 2400, frames: [
    { offsetMs: 0, presetId: "classic-v3", change: 0, events: [
      ...[48, 52, 55, 59, 62].map(note => ({ part: "pad", note, offset: 0, duration: 1.8, velocity: 0.03 })),
      { part: "lead", note: 60, offset: 0.25, duration: 0.2, velocity: 0.08 },
      { part: "bass", note: 24, offset: 0, duration: 0.4, velocity: 0.09 },
      { part: "kick", offset: 0, duration: 0.08, velocity: 0.14 },
      { part: "kick", offset: 0, duration: 0.08, velocity: 0.08 },
      { part: "hat", offset: 0.125, duration: 0.08, velocity: 0.025 },
      { part: "snare", offset: 0.375, duration: 0.08, velocity: 0.08 },
      { part: "arp", note: 72, offset: 0.125, duration: 0.1, velocity: 0.04 },
      { part: "riser", note: 60, offset: 0, duration: 2, velocity: 0.05 },
      { part: "stinger", note: 48, offset: 0, duration: 0.45, velocity: 0.08 },
      { part: "cadence", note: 48, offset: 0, duration: 1.8, velocity: 0.05 },
    ] },
    { offsetMs: 500, presetId: "ambient-v3", change: 123, events: [] },
    { offsetMs: 1000, presetId: "bass-heavy-v3", change: -12, events: [
      { part: "bass", note: 36, offset: 0, duration: 0.4, velocity: 0.12 },
    ] },
    { offsetMs: 1500, presetId: "arpeggio-v3", change: 20, events: [
      { part: "arp", note: 72, offset: 0.375, duration: 0.1, velocity: 0.07 },
    ] },
  ] };
}
