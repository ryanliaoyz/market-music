export function fakeTime() {
  let time = 0, id = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimeout(callback, delay) { timers.set(++id, { callback, at: time + delay }); return id; },
    clearTimeout(key) { timers.delete(key); },
    advance(ms) {
      const end = time + ms;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        time = next[1].at; timers.delete(next[0]); next[1].callback();
      }
      time = end;
    },
    count: () => timers.size,
  };
}

export function sockets() {
  const instances = [];
  class Socket {
    constructor(url) { this.url = url; this.sent = []; this.readyState = 0; instances.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.closed = true; this.readyState = 3; }
    open() { this.readyState = 1; this.onopen?.(); }
    message(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
  }
  return { Socket, instances };
}

export const ticker = (sequence_num = 0, price = "100", type = "update") => ({
  channel: "ticker", sequence_num, timestamp: "2026-10-30T12:00:00Z",
  events: [{ type, tickers: [{ product_id: "BTC-USD", price }] }],
});
export const heartbeat = { channel: "heartbeats", sequence_num: 0, events: [{ heartbeat_counter: 1 }] };
