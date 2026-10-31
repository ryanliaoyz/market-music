export const SIGNAL_POLICY = Object.freeze({ d: 0.45, history: 600, baselineSeconds: 1800,
  noiseFloor: 0.00005, smoothingSeconds: 1, hysteresis: 0.15 });

export function createLiveControls() {
  const weights = [1];
  for (let k = 1; k < SIGNAL_POLICY.history; k++) weights.push(weights[k - 1] * (k - 1 - SIGNAL_POLICY.d) / k);
  let history = [], variance = 0, baseline = 0, rate = 0, rateBaseline = 0, armed = true, pending = null;
  let diagnostics = null, volMean = 0, volVariance = 0, moodMean = 0, moodVariance = 0;
  const smooth = {}, levels = {};
  function level(name, target, low, high, cadence, slot, dt = 0.5) {
    target = Math.max(low, Math.min(high, target));
    smooth[name] = (smooth[name] ?? 0) + (1 - Math.exp(-dt / SIGNAL_POLICY.smoothingSeconds)) * (target - (smooth[name] ?? 0));
    let value = levels[name] ?? 0;
    if (slot % cadence === 0) {
      while (value < high && smooth[name] > value + 0.5 + SIGNAL_POLICY.hysteresis) value++;
      while (value > low && smooth[name] < value - 0.5 - SIGNAL_POLICY.hysteresis) value--;
    }
    levels[name] = value;
    return value;
  }
  return {
    sample(mid, spread, trades, slot, event, movement = 0, sigma = 0) {
      const log = Math.log(mid), previous = history.at(-1);
      const change = previous === undefined ? 0 : log - previous;
      const alpha = 1 - Math.exp(-0.5 / SIGNAL_POLICY.baselineSeconds);
      variance += (1 - Math.exp(-0.5 / 10)) * (Math.max(change * change, movement * movement) - variance);
      baseline += alpha * (variance - baseline);
      rate += (1 - Math.exp(-0.5 / 10)) * (trades.count * 2 - rate);
      rateBaseline += alpha * (rate - rateBaseline);
      const vol = Math.sqrt(variance), floor = SIGNAL_POLICY.noiseFloor;
      const volRatio = vol / Math.max(floor, Math.sqrt(baseline));
      // Difference from the oldest retained log price cancels the truncated filter's DC residual.
      const series = [...history, log].slice(-SIGNAL_POLICY.history);
      const origin = series[0];
      const fractional = series.reduce((sum, value, i) => sum + weights[series.length - 1 - i] * (value - origin), 0);
      const fiveMinute = log - (history.length >= 600 ? history[history.length - 600] : log);
      const volZ = (vol - volMean) / Math.max(floor, Math.sqrt(volVariance));
      const moodZ = history.length >= 600 ? (fiveMinute - moodMean) / Math.max(floor * Math.sqrt(600), Math.sqrt(moodVariance)) : 0;
      volVariance = (1 - alpha) * (volVariance + alpha * (vol - volMean) ** 2);
      volMean += alpha * (vol - volMean);
      if (history.length >= 600) {
        moodVariance = (1 - alpha) * (moodVariance + alpha * (fiveMinute - moodMean) ** 2);
        moodMean += alpha * (fiveMinute - moodMean);
      }
      const total = trades.buy + trades.sell;
      const raw = { energy: Math.max(vol > floor ? volRatio : 0, rate > 1 ? rate / Math.max(1, rateBaseline) : 0),
        contour: Math.abs(fractional) < floor ? 0 : fractional / Math.max(floor, vol),
        tension: Math.max(0, volZ) + spread / mid * 10000,
        mood: 1.5 + moodZ,
        flow: total ? 3 * (trades.buy / total - trades.sell / total) : 0 };
      const controls = { energy: level("energy", raw.energy, 0, 4, 16, slot),
        contour: level("contour", raw.contour, -8, 7, 1, slot),
        tension: level("tension", raw.tension, 0, 7, 4, slot),
        mood: level("mood", raw.mood, 0, 3, 32, slot),
        flow: level("flow", raw.flow, -3, 3, 1, slot),
        hits: trades.hits.map(count => level("hits", count ? Math.log2(count + 1) : 0, 0, 3, 1, slot, 0.125)) };
      if (event && armed) { pending = event; armed = false; }
      if (!event && Math.abs(change) < 2 * Math.max(floor, sigma ?? 0)) armed = true;
      controls.event = slot % 4 === 0 ? pending : null;
      if (slot % 4 === 0) pending = null;
      history = series;
      diagnostics = { raw, smoothed: { ...smooth }, controls: structuredClone(controls), armed, pendingEvent: pending,
        samples: history.length, baselineVolatility: Math.sqrt(baseline), rateBaseline,
        reason: slot % 32 === 0 ? "phrase-boundary" : slot % 4 === 0 ? "bar-boundary" : "beat" };
      return controls;
    },
    inspect: () => structuredClone(diagnostics),
  };
}
