import { FRAME_MS } from "./live-features.js";

// Slots end at their cutoff; an exact boundary belongs to the preceding interval.
export function createBeatAggregator(exchangeOrigin) {
  const bins = new Map();
  let finalized = -1, last = null, lateTrades = 0, outsideTrades = 0;
  let previousQuote = null;
  function bin(slot) {
    if (!bins.has(slot)) bins.set(slot, { count: 0, size: 0, buy: 0, sell: 0,
      hits: [0, 0, 0, 0], quotes: 0, movement: 0, low: null, high: null, tick: null });
    return bins.get(slot);
  }
  function prune(receiptOffset) {
    const oldest = Math.ceil(receiptOffset / FRAME_MS) - 132;
    for (const key of bins.keys()) if (key < oldest) {
      const old = bins.get(key).tick;
      if (old && (!last || old.sourceOffsetMs > last.sourceOffsetMs)) last = old;
      bins.delete(key);
    }
    return oldest;
  }
  return {
    tick(tick, offset) {
      const slot = Math.max(finalized + 1, Math.ceil(offset / FRAME_MS));
      const b = bin(slot), mid = tick.mid;
      if (previousQuote !== null) b.movement += Math.abs(Math.log(mid) - Math.log(previousQuote));
      previousQuote = mid;
      b.low = b.low === null ? mid : Math.min(b.low, mid);
      b.high = b.high === null ? mid : Math.max(b.high, mid);
      b.quotes++;
      b.tick = { ...tick, sourceOffsetMs: offset, discontinuity: tick.discontinuity || b.tick?.discontinuity };
      prune(offset);
    },
    trade(trade, receiptOffset) {
      const offset = trade.exchangeTimeMs - exchangeOrigin;
      const slot = Math.ceil(offset / FRAME_MS);
      const oldest = prune(receiptOffset);
      if (slot <= finalized) { lateTrades++; return; }
      if (offset < 0 || slot < oldest || offset > receiptOffset + FRAME_MS || slot > Math.ceil(receiptOffset / FRAME_MS) + 1) {
        outsideTrades++; return;
      }
      const b = bin(slot);
      const sub = slot === 0 ? 0 : Math.max(0, Math.ceil((offset - (slot - 1) * FRAME_MS) / 125) - 1);
      b.count++; b.size += trade.size;
      b.tradeDiscontinuity ||= trade.discontinuity;
      if (trade.aggressor === 1) b.buy += trade.size; else b.sell += trade.size;
      b.hits[sub]++;
    },
    sample(slot) {
      for (const [key, old] of bins) if (key < slot && old.tick && (!last || old.tick.sourceOffsetMs > last.sourceOffsetMs)) last = old.tick;
      const b = bins.get(slot) ?? { count: 0, size: 0, buy: 0, sell: 0,
        hits: [0, 0, 0, 0], quotes: 0, movement: 0, low: null, high: null, tick: null };
      const carried = !b.tick;
      if (b.tick) last = b.tick;
      finalized = slot;
      for (const key of bins.keys()) if (key <= slot) bins.delete(key);
      return { ...b, carried, tick: last && { ...last, price: last.mid,
        discontinuity: carried ? false : last.discontinuity } };
    },
    inspect: () => ({ pendingBeats: bins.size, finalized, lateTrades, outsideTrades }),
  };
}
