export const LIVE_URL = "wss://advanced-trade-ws.coinbase.com";

export function createLiveFeed({ productId = "BTC-USD", onTick = () => {}, onTrade = () => {}, onStatus = () => {},
  WebSocket: Socket = globalThis.WebSocket, now = () => Date.now(),
  monotonic = () => performance.now(), setTimeout: later = globalThis.setTimeout,
  clearTimeout: cancel = globalThis.clearTimeout, random = Math.random } = {}) {
  let socket, timer, watchdog, generation = 0, running = false, attempts = 0;
  let started, connectionId = 0, sequence = -1, healthySince = null;
  let lastTickAt = null, lastHeartbeatAt = null, rejected = 0, gaps = 0;
  let state = "idle", reason = "created", error = null, retryAt = null;
  let connectedAt = 0;
  let rejectedSubscription = false;
  let tradeSequence = -1, tradeIds = new Set(), acceptedTrades = 0;

  function inspect() {
    return { provider: "coinbase", productId, state, reason, error, connectionId,
      sequence, tradeSequence, acceptedTrades, attempts, retryAt, rejected, gaps,
      tickAgeMs: lastTickAt === null ? null : now() - lastTickAt,
      heartbeatAgeMs: lastHeartbeatAt === null ? null : now() - lastHeartbeatAt };
  }
  function publish(next, why) { state = next; reason = why; onStatus(inspect()); }
  function disconnect() {
    generation++;
    cancel(timer); cancel(watchdog);
    timer = watchdog = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close(); socket = null;
    }
  }
  function fail(message, terminal = false) {
    if (!running || rejectedSubscription) return;
    error = message;
    if (terminal) {
      rejectedSubscription = true;
      cancel(timer); cancel(watchdog); timer = watchdog = null;
      publish("error", "subscription-rejected"); return;
    }
    disconnect();
    if (healthySince !== null && now() - healthySince >= 30000) attempts = 0;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)) * (0.8 + 0.2 * random());
    retryAt = now() + delay;
    publish("reconnecting", "connection-lost");
    timer = later(connect, delay);
  }
  function watch(token) {
    watchdog = later(() => {
      if (token !== generation || !running) return;
      if (now() - (lastHeartbeatAt ?? connectedAt) >= 5000) {
        fail("Coinbase heartbeat timed out"); return;
      }
      if (lastTickAt !== null && now() - lastTickAt >= 5000 && state === "live") publish("waiting", "stale-price");
      watch(token);
    }, 1000);
  }
  function connect() {
    if (!running) return;
    const token = ++generation;
    connectionId++; sequence = -1; lastTickAt = lastHeartbeatAt = healthySince = null;
    tradeSequence = -1; tradeIds.clear();
    connectedAt = now();
    retryAt = null;
    publish("connecting", "opening-socket");
    try { socket = new Socket(LIVE_URL); }
    catch (cause) { fail(cause.message); return; }
    timer = later(() => { if (token === generation) fail("Coinbase connection/subscription timed out"); }, 10000);
    socket.onopen = () => {
      if (token !== generation) return;
      socket.send(JSON.stringify({ type: "subscribe", channel: "ticker", product_ids: [productId] }));
      socket.send(JSON.stringify({ type: "subscribe", channel: "market_trades", product_ids: [productId] }));
      socket.send(JSON.stringify({ type: "subscribe", channel: "heartbeats" }));
    };
    socket.onerror = () => { if (token === generation) fail("Cannot connect to Coinbase. Check your connection and retry."); };
    socket.onclose = () => { if (token === generation) fail("Coinbase connection closed"); };
    socket.onmessage = event => {
      if (token !== generation || rejectedSubscription) return;
      let message;
      try { message = JSON.parse(event.data); }
      catch { rejected++; error = "Invalid Coinbase JSON"; onStatus(inspect()); return; }
      if (!message || typeof message !== "object") { rejected++; onStatus(inspect()); return; }
      if (message.type === "error") { fail(String(message.message || "Coinbase subscription rejected"), true); return; }
      if (message.channel === "subscriptions") {
        if (Array.isArray(message.events) && message.events.some(entry => Array.isArray(entry?.subscriptions?.ticker) && entry.subscriptions.ticker.includes(productId))) {
          cancel(timer); timer = null;
          publish("waiting", "first-price");
          if (!watchdog) watch(token);
        }
        return;
      }
      if (!["ticker", "market_trades", "heartbeats"].includes(message.channel)) return;
      if (!Number.isSafeInteger(message.sequence_num) || message.sequence_num < 0 || !Array.isArray(message.events)) {
        rejected++; error = "Invalid Coinbase envelope"; onStatus(inspect()); return;
      }
      if (message.channel === "market_trades") {
        if (message.sequence_num <= tradeSequence) { rejected++; onStatus(inspect()); return; }
        const discontinuity = tradeSequence >= 0 && message.sequence_num !== tradeSequence + 1;
        if (discontinuity) gaps++;
        tradeSequence = message.sequence_num;
        for (const entry of message.events) {
          if (!entry || !["snapshot", "update"].includes(entry.type) || !Array.isArray(entry.trades)) { rejected++; continue; }
          // Subscription snapshots are historical, not activity received in this live interval.
          if (entry.type === "snapshot") continue;
          for (const trade of entry.trades) {
            if (!trade || trade.product_id !== productId) continue;
            const price = typeof trade.price === "string" && trade.price.trim() ? Number(trade.price) : NaN;
            const size = typeof trade.size === "string" && trade.size.trim() ? Number(trade.size) : NaN;
            const exchangeTimeMs = Date.parse(trade.time);
            if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size <= 0 ||
                !Number.isFinite(exchangeTimeMs) || typeof trade.trade_id !== "string" || !trade.trade_id ||
                !["BUY", "SELL"].includes(trade.side) || tradeIds.has(trade.trade_id)) { rejected++; continue; }
            tradeIds.add(trade.trade_id);
            if (tradeIds.size > 2048) tradeIds.delete(tradeIds.values().next().value);
            acceptedTrades++;
            onTrade(Object.freeze({ productId, connectionId, sequence: tradeSequence, price, size,
              exchangeTimeMs, elapsedMs: monotonic() - started, discontinuity }));
          }
        }
        onStatus(inspect()); return;
      }
      // Coinbase sequences are scoped to a channel, not shared with heartbeats.
      if (message.channel === "heartbeats") {
        if (!message.events.length || !message.events.every(entry => entry &&
          (typeof entry.heartbeat_counter === "number" || typeof entry.heartbeat_counter === "string" && /^\d+$/.test(entry.heartbeat_counter)) &&
          Number.isSafeInteger(Number(entry.heartbeat_counter)) && Number(entry.heartbeat_counter) >= 0)) {
          rejected++; error = "Invalid Coinbase heartbeat"; onStatus(inspect()); return;
        }
        lastHeartbeatAt = now();
        if (healthySince === null) healthySince = now();
        if (!watchdog) watch(token);
        onStatus(inspect()); return;
      }
      if (message.sequence_num <= sequence) { rejected++; onStatus(inspect()); return; }
      const discontinuity = sequence >= 0 && message.sequence_num !== sequence + 1;
      if (discontinuity) gaps++;
      sequence = message.sequence_num;
      const exchangeTimeMs = Date.parse(message.timestamp);
      if (!Number.isFinite(exchangeTimeMs)) { rejected++; error = "Invalid Coinbase timestamp"; onStatus(inspect()); return; }
      let accepted = false;
      for (const entry of message.events) {
        if (!entry || !["snapshot", "update"].includes(entry.type) || !Array.isArray(entry.tickers)) {
          rejected++; continue;
        }
        for (const ticker of entry.tickers) {
          if (!ticker || ticker.product_id !== productId) continue;
          const price = typeof ticker.price === "string" && ticker.price.trim() !== "" ? Number(ticker.price) : NaN;
          if (!Number.isFinite(price) || price <= 0) { rejected++; error = "Invalid Coinbase price"; continue; }
          const receivedAtMs = now();
          lastTickAt = receivedAtMs;
          onTick(Object.freeze({ provider: "coinbase", productId, connectionId, sequence,
            exchangeTimeMs, receivedAtMs, elapsedMs: monotonic() - started, price, discontinuity }));
          accepted = true;
        }
      }
      if (accepted) {
        cancel(timer); timer = null; error = null;
        if (!watchdog) watch(token);
        publish("live", discontinuity ? "sequence-gap" : "price-received");
      } else onStatus(inspect());
    };
  }
  return {
    start() {
      if (running) return;
      running = true; started = monotonic(); attempts = 0; error = null; rejectedSubscription = false;
      connect();
    },
    stop() {
      running = false;
      if (socket?.readyState === 1) {
        socket.send(JSON.stringify({ type: "unsubscribe", channel: "ticker", product_ids: [productId] }));
        socket.send(JSON.stringify({ type: "unsubscribe", channel: "market_trades", product_ids: [productId] }));
        socket.send(JSON.stringify({ type: "unsubscribe", channel: "heartbeats" }));
      }
      disconnect(); retryAt = null; publish("stopped", "stopped");
    },
    inspect,
  };
}
