import { createSoundScore } from "./sound.js";

const NOTES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const percent = value => value === null ? "n/a" : `${(value * 100).toFixed(4)}%`;
const decimal = value => value === null ? "n/a" : value.toFixed(4);

export function createDebugPanel(features, root) {
  const score = createSoundScore(features);
  const bars = new Map(score.bars.map(bar => [bar.minute, bar]));
  const nodes = new Map();
  let frame = null;
  function write(id, value) {
    if (!nodes.has(id)) nodes.set(id, root.querySelector(`[data-debug="${id}"]`));
    const node = nodes.get(id);
    if (node.textContent !== value) node.textContent = value;
  }

  return {
    render(snapshot) {
      const ended = snapshot.state === "ended" || snapshot.state === "disposed";
      const bar = ended ? null : bars.get(snapshot.minute) ?? null;
      const wallMinute = 570 + snapshot.minute;
      const time = ended ? "16:00" :
        `${String(Math.floor(wallMinute / 60)).padStart(2, "0")}:${String(wallMinute % 60).padStart(2, "0")}`;
      write("state", `${snapshot.state}${snapshot.state === "paused" || snapshot.state === "starting" ? " · mapping preview" : ""}`);
      write("bar", ended ? "No current bar" : `${time} · minute ${snapshot.minute} · ${bar ? `bar ${bar.index} (zero-based)` : "rest — no observed bar"}`);
      write("return", percent(bar?.return ?? null));
      write("sigma", percent(features.sigma));
      write("note", bar ? `${NOTES[bar.note % 12]}${Math.floor(bar.note / 12) - 1} (MIDI ${bar.note})` : "n/a");
      write("gain", decimal(bar?.gain ?? null));
      write("drive", decimal(bar?.drive ?? null));
      write("rules", bar ? bar.rules.join(", ") || "none" : "none");
      write("waiting", snapshot.waiting ?? "none");
      write("reason", snapshot.reason);
      frame = {
        session: features.session.id, state: snapshot.state, minute: snapshot.minute,
        barIndex: bar?.index ?? null, return: bar?.return ?? null, sigma: features.sigma,
        note: bar?.note ?? null, gain: bar?.gain ?? null, drive: bar?.drive ?? null,
        rules: bar ? [...bar.rules] : [], waiting: snapshot.waiting, reason: snapshot.reason,
      };
    },
    inspect: () => frame && { ...frame, rules: [...frame.rules] },
  };
}
