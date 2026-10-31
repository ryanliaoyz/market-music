import { musicalMapping } from "./live-music.js";

export const LIVE_POLICY = "live-v2";
export const FRAME_MS = 500;
export const WINDOW_FRAMES = 120;

export function createLiveFeatures() {
  let frames = [], pending = null, previous = null, id = 0, connection = null, broken = false;
  let degree = 7, chordDegree = 0;
  return {
    accept(tick) {
      if (connection !== tick.connectionId || tick.discontinuity) broken = true;
      connection = tick.connectionId;
      pending = tick;
    },
    gap() { pending = null; previous = null; broken = true; },
    sample(elapsedMs, trades = { count: 0, size: 0 }) {
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
      const movements = history.filter(frame => slot - frame.slot < 40 && frame.return !== null).map(frame => Math.abs(frame.return));
      const range = Math.max(Math.abs(value ?? 0), ...movements, 0);
      const normalizedChange = range && value !== null ? value / range : 0;
      const step = Math.abs(normalizedChange) < 0.1 ? 0 : Math.sign(normalizedChange) * Math.max(1, Math.round(Math.abs(normalizedChange) * 3));
      degree += step;
      if (degree > 14) degree -= 7;
      if (degree < 0) degree += 7;
      const trendReturn = history.filter(frame => slot - frame.slot < 16).reduce((sum, frame) => sum + (frame.return ?? 0), value ?? 0);
      const trend = range && Math.abs(trendReturn) > range * 0.5 ? Math.sign(trendReturn) : 0;
      if (slot % 8 === 0) {
        const progression = trend > 0 ? [0, 3, 4, 0] : trend < 0 ? [0, 5, 3, 4] : [0, 3, 0, 4];
        chordDegree = progression[Math.floor(slot / 8) % 4];
      }
      const tradeHistory = history.filter(frame => slot - frame.slot < 8);
      const tradeRate = (trades.count + tradeHistory.reduce((sum, frame) => sum + frame.tradeCount, 0)) / ((Math.min(slot, 7) + 1) * 0.5);
      const count = tradeHistory.reduce((sum, frame) => sum + frame.tradeCount, 0);
      const meanSize = count ? tradeHistory.reduce((sum, frame) => sum + frame.tradeSize, 0) / count : 0;
      const sizeRatio = trades.count && meanSize ? trades.size / trades.count / meanSize : 1;
      const accent = trades.count ? Math.min(3, Math.max(1, Math.round(sizeRatio))) : 0;
      const frame = { id: id++, slot, elapsedMs, exchangeTimeMs: tick?.exchangeTimeMs ?? null,
        price: tick?.price ?? null, return: value, sigma, event, rollingVolatility,
        discontinuity: broken || !adjacent, references, policy: LIVE_POLICY, mapping: null,
        degree, chordDegree, normalizedChange, range, trend, tradeCount: trades.count, tradeSize: trades.size, tradeRate, accent };
      if (tick) frame.mapping = musicalMapping(frame, "classic-v2");
      frames = [...history, frame];
      previous = tick ? frame : null;
      broken = false;
      return frame;
    },
    inspect: () => ({ policy: LIVE_POLICY, frames: structuredClone(frames), pending: pending !== null }),
  };
}
