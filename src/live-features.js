import { mapSoundFrame } from "./sound.js";

export const LIVE_POLICY = "live-v1";
export const FRAME_MS = 500;
export const WINDOW_FRAMES = 120;

export function createLiveFeatures() {
  let frames = [], pending = null, previous = null, id = 0, connection = null, broken = false;
  return {
    accept(tick) {
      if (connection !== tick.connectionId || tick.discontinuity) broken = true;
      connection = tick.connectionId;
      pending = tick;
    },
    gap() { pending = null; previous = null; broken = true; },
    sample(elapsedMs) {
      const slot = Math.floor(elapsedMs / FRAME_MS);
      const tick = pending;
      pending = null;
      if (frames.length && slot <= frames.at(-1).slot) return null;
      const adjacent = previous && slot === previous.slot + 1 && !broken;
      const value = tick && adjacent ? tick.price / previous.price - 1 : null;
      const history = frames.filter(frame => slot - frame.slot < WINDOW_FRAMES);
      const returns = history.filter(frame => frame.return !== null).map(frame => frame.return);
      const mean = returns.length ? returns.reduce((sum, r) => sum + r, 0) / returns.length : 0;
      const sigma = returns.length ? Math.sqrt(returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length) : null;
      const event = value !== null && returns.length >= 10 && sigma > 0 && Math.abs(value) > 3 * sigma ? (value < 0 ? "drop" : "spike") : null;
      const recent = history.filter(frame => slot - frame.slot < 10 && frame.return !== null).map(frame => frame.return);
      if (value !== null) recent.push(value);
      const rollingVolatility = Math.sqrt(recent.reduce((sum, r) => sum + r * r, 0));
      const prices = history.filter(frame => frame.price !== null).map(frame => frame.price);
      if (tick) prices.push(tick.price);
      const references = { low: prices.length ? Math.min(...prices) : null,
        high: prices.length ? Math.max(...prices) : null,
        peakVolatility: Math.max(rollingVolatility, ...history.map(frame => frame.rollingVolatility)) };
      const frame = { id: id++, slot, elapsedMs, exchangeTimeMs: tick?.exchangeTimeMs ?? null,
        price: tick?.price ?? null, return: value, sigma, event, rollingVolatility,
        discontinuity: broken || !adjacent, references, policy: LIVE_POLICY, mapping: null };
      if (tick) frame.mapping = mapSoundFrame({ index: frame.id, minute: slot, close: tick.price,
        return: value, sigma, event, rollingVolatility, vwap: null }, references, { gain: 0.11 });
      frames = [...history, frame];
      previous = tick ? frame : null;
      broken = false;
      return frame;
    },
    inspect: () => ({ policy: LIVE_POLICY, frames: structuredClone(frames), pending: pending !== null }),
  };
}
