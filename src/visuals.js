const LEFT = 60;
const TOP = 24;
const WIDTH = 690;
const HEIGHT = 240;
const x = minute => LEFT + minute / 390 * WIDTH;

export function createVisuals(features, svg) {
  const node = id => svg.querySelector(`[data-visual="${id}"]`);
  const prices = features.bars.map(bar => bar.close);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const peak = Math.max(...features.bars.map(bar => bar.rollingVolatility ?? 0));
  const y = price => TOP + HEIGHT * (high === low ? 0.5 : 1 - (price - low) / (high - low));
  const bars = new Map(features.bars.map(bar => [bar.minute, bar]));
  let previousMinute = -2;
  const path = features.bars.map(bar => {
    const command = bar.minute === previousMinute + 1 ? "L" : "M";
    previousMinute = bar.minute;
    return `${command}${x(bar.minute)},${y(bar.close)}`;
  }).join(" ");
  node("line").setAttribute("d", path);
  node("high").textContent = high.toFixed(2);
  node("low").textContent = low.toFixed(2);
  let frame = null;

  return {
    render(snapshot) {
      const { minute, position, state } = snapshot;
      const bar = bars.get(minute);
      const intensity = bar && peak > 0 ? (bar.rollingVolatility ?? 0) / peak : 0;
      const event = bar?.event ?? (minute === 0 && features.openingGapReturn ? "opening" : null);
      const phase = position - minute;
      // The audio clock holds position at zero during startup lead time.
      const flash = state === "playing" && event && phase > 0 ? Math.max(0, 1 - phase * 2) : 0;
      const color = event === "drop" ? "#ff8b91" : event === "spike" ? "#a5f3ce" : "#f5d58b";
      node("background").setAttribute("fill", `hsl(${220 - intensity * 195} 45% ${12 + intensity * 12}%)`);
      node("reveal").setAttribute("width", x(Math.min(389, position)) - LEFT);
      node("cursor").setAttribute("x1", x(position));
      node("cursor").setAttribute("x2", x(position));
      node("point").setAttribute("visibility", bar && state !== "ended" ? "visible" : "hidden");
      if (bar) {
        node("point").setAttribute("cx", x(minute));
        node("point").setAttribute("cy", y(bar.close));
      }
      node("flash").setAttribute("fill", color);
      node("flash").setAttribute("opacity", flash * 0.35);
      node("description").textContent = state === "ended" ? "Session complete." :
        bar ? `Minute ${minute}: close ${bar.close.toFixed(2)}${bar.event ? `, ${bar.event} event` : ""}.` :
          `Minute ${minute}: no observed bar.`;
      frame = {
        session: features.session.id, state, position, minute, close: bar?.close ?? null,
        intensity, event, flash, waiting: snapshot.waiting, reason: snapshot.reason,
      };
    },
    inspect: () => frame && { ...frame },
  };
}
