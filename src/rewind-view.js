// Paused-Live view: the price chart shows the retained history and doubles as the clip selector.
// Selection is in rewind-buffer milliseconds; starts snap to the 500 ms beat grid.
const VIEW = { x: 52, width: 706 }, PLOT = { left: 60, width: 690, top: 24, height: 240 };
const STEP = 500, MINIMUM = 500;

const seconds = ms => {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

export function defaultSelection({ startMs, endMs }, lengthMs = 30000) {
  if (endMs - startMs < MINIMUM) return null;
  return { startMs: Math.max(startMs, Math.ceil((endMs - lengthMs) / STEP) * STEP), endMs };
}

// Clamp a proposed selection inside the frozen range, keeping the grid and a minimum length.
export function clampSelection({ startMs, endMs }, range) {
  const lastStart = Math.floor((range.endMs - MINIMUM) / STEP) * STEP;
  const start = Math.min(lastStart, Math.max(range.startMs, Math.floor(startMs / STEP) * STEP));
  const end = Math.min(range.endMs, Math.max(start + MINIMUM, Math.round(endMs)));
  return { startMs: start, endMs: range.endMs - end < STEP / 2 ? range.endMs : end };
}

export function createRewindView(figure, { onSelect }) {
  const node = id => figure.querySelector(`[data-visual="${id}"]`);
  const svg = figure.querySelector("svg");
  const overlay = figure.querySelector(".rewind-select");
  const band = overlay.querySelector(".rewind-band");
  const handles = { start: overlay.querySelector("#rewind-start"), end: overlay.querySelector("#rewind-end") };
  let range = null, selection = null, drag = null;

  const fraction = ms => (ms - range.startMs) / Math.max(1, range.endMs - range.startMs);
  const msAt = clientX => {
    const box = overlay.getBoundingClientRect();
    return range.startMs + Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * (range.endMs - range.startMs);
  };
  function choose(next) {
    selection = clampSelection(next, range);
    place();
    onSelect({ ...selection });
  }
  function place() {
    // Cover exactly the SVG plot area so pointer positions map to chart time.
    const box = svg.getBoundingClientRect(), frame = figure.getBoundingClientRect();
    const scale = box.width / VIEW.width;
    Object.assign(overlay.style, { left: `${box.left - frame.left + (PLOT.left - VIEW.x) * scale}px`, width: `${PLOT.width * scale}px`,
      top: `${box.top - frame.top}px`, height: `${box.height}px` });
    if (!range) return;
    const left = selection ? fraction(selection.startMs) * 100 : 0, right = selection ? fraction(selection.endMs) * 100 : 0;
    band.hidden = !selection;
    band.style.left = `${left}%`; band.style.width = `${right - left}%`;
    for (const [key, handle] of Object.entries(handles)) {
      handle.hidden = !selection;
      if (!selection) continue;
      const value = selection[`${key}Ms`];
      handle.style.left = `${fraction(value) * 100}%`;
      handle.setAttribute("aria-valuemin", String((range.startMs - range.endMs) / 1000));
      handle.setAttribute("aria-valuemax", "0");
      handle.setAttribute("aria-valuenow", String((value - range.endMs) / 1000));
      handle.setAttribute("aria-valuetext", value === range.endMs ? "at pause" : `${((range.endMs - value) / 1000).toFixed(1)} seconds before pause`);
    }
  }

  overlay.addEventListener("pointerdown", event => {
    if (!range || event.button > 0) return;
    const key = Object.keys(handles).find(name => handles[name] === event.target);
    const at = msAt(event.clientX);
    drag = key ? { key } : { anchor: at };
    overlay.setPointerCapture(event.pointerId);
    if (!key) choose({ startMs: at, endMs: at + MINIMUM });
    event.preventDefault();
  });
  overlay.addEventListener("pointermove", event => {
    if (!drag) return;
    const at = msAt(event.clientX);
    if (drag.key === "start") choose({ startMs: Math.min(at, selection.endMs - MINIMUM), endMs: selection.endMs });
    else if (drag.key === "end") choose({ startMs: selection.startMs, endMs: Math.max(at, selection.startMs + MINIMUM) });
    else choose({ startMs: Math.min(drag.anchor, at), endMs: Math.max(drag.anchor, at, Math.min(drag.anchor, at) + MINIMUM) });
  });
  const release = () => { drag = null; };
  overlay.addEventListener("pointerup", release);
  overlay.addEventListener("pointercancel", release);
  for (const [key, handle] of Object.entries(handles)) handle.addEventListener("keydown", event => {
    if (!selection) return;
    const step = event.shiftKey ? 10 * STEP : STEP;
    const current = selection[`${key}Ms`];
    // Arrow steps land on the beat grid; the end may also sit exactly at the pause point.
    const target = {
      ArrowLeft: Math.floor((current - 1) / STEP) * STEP - (step - STEP), ArrowDown: Math.floor((current - 1) / STEP) * STEP - (step - STEP),
      ArrowRight: Math.floor(current / STEP) * STEP + step, ArrowUp: Math.floor(current / STEP) * STEP + step,
      Home: key === "start" ? range.startMs : selection.startMs + MINIMUM, End: key === "end" ? range.endMs : selection.endMs - MINIMUM,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    if (key === "start") choose({ startMs: Math.min(target, selection.endMs - MINIMUM), endMs: selection.endMs });
    else choose({ startMs: selection.startMs, endMs: Math.max(target, selection.startMs + MINIMUM) });
  });

  return {
    get selection() { return selection && { ...selection }; },
    show(frozen, initial) { range = { startMs: frozen.startMs, endMs: frozen.endMs }; selection = initial; overlay.hidden = false; },
    hide() { range = selection = drag = null; overlay.hidden = true; },
    render(trace, { previewMs = null } = {}) {
      if (!range) return;
      const priced = trace.filter(point => point.price !== null);
      const prices = priced.map(point => point.price);
      const low = prices.length ? Math.min(...prices) : null, high = prices.length ? Math.max(...prices) : null;
      const x = ms => PLOT.left + fraction(ms) * PLOT.width;
      const y = price => PLOT.top + PLOT.height * (low === high ? 0.5 : 1 - (price - low) / (high - low));
      let previous = null;
      node("line").setAttribute("d", priced.map(point => {
        const command = previous !== null && point.offsetMs === previous + STEP ? "L" : "M";
        previous = point.offsetMs;
        return `${command}${x(point.offsetMs)},${y(point.price)}`;
      }).join(" "));
      node("reveal").setAttribute("width", PLOT.width);
      node("point").setAttribute("visibility", "hidden");
      node("flash").setAttribute("opacity", 0);
      node("background").setAttribute("fill", "hsl(200 45% 14%)");
      const cursor = previewMs === null ? null : x(selection.startMs + previewMs);
      node("cursor").setAttribute("visibility", cursor === null ? "hidden" : "visible");
      if (cursor !== null) { node("cursor").setAttribute("x1", cursor); node("cursor").setAttribute("x2", cursor); }
      node("high").textContent = high === null ? "—" : high.toFixed(2);
      node("low").textContent = low === null ? "—" : low.toFixed(2);
      const span = range.endMs - range.startMs;
      const labels = figure.querySelectorAll(".chart-axis span");
      [labels[0].textContent, labels[1].textContent, labels[2].textContent] = [`−${seconds(span)}`, `−${seconds(span / 2)}`, "paused"];
      node("description").textContent = `Last ${seconds(span)} before pause. ${selection ? `Selected ${((selection.endMs - selection.startMs) / 1000).toFixed(1)} seconds.` : ""}`;
      place();
    },
  };
}
