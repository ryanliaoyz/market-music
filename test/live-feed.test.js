import { test } from "node:test";
import assert from "node:assert/strict";
import { createLiveFeed, LIVE_URL } from "../src/live-feed.js";
import { fakeTime, sockets, ticker, heartbeat } from "./helpers/websocket.js";

function setup() {
  const clock = fakeTime(), { Socket, instances } = sockets(), ticks = [], statuses = [], trades = [];
  const feed = createLiveFeed({ ...clock, monotonic: clock.now, random: () => 1,
    WebSocket: Socket, onTick: tick => ticks.push(tick), onTrade: trade => trades.push(trade), onStatus: status => statuses.push(status) });
  feed.start();
  return { clock, instances, ticks, trades, statuses, feed, socket: instances[0] };
}

test("keyless subscriptions, snapshots, batches and capture timestamps", () => {
  const { feed, socket, ticks, clock } = setup();
  assert.equal(socket.url, LIVE_URL);
  socket.open();
  assert.deepEqual(socket.sent, [{ type: "subscribe", channel: "ticker", product_ids: ["BTC-USD"] },
    { type: "subscribe", channel: "market_trades", product_ids: ["BTC-USD"] },
    { type: "subscribe", channel: "heartbeats" }]);
  clock.advance(100);
  const message = ticker(0, "100", "snapshot");
  message.events[0].tickers.push({ product_id: "ETH-USD", price: "20" }, { product_id: "BTC-USD", price: "101" });
  socket.message(message);
  assert.deepEqual(ticks.map(t => t.price), [100, 101]);
  assert.equal(ticks[0].elapsedMs, 100);
  assert.equal(ticks[0].exchangeTimeMs, Date.parse(message.timestamp));
  assert.ok(Object.isFrozen(ticks[0]));
  assert.equal(feed.inspect().state, "live");
  feed.stop(); assert.equal(clock.count(), 0);
});

test("market trades validate once, ignore snapshots, deduplicate and sequence independently", () => {
  const { feed, socket, trades, ticks, clock, instances } = setup();
  const trade = { product_id: "BTC-USD", trade_id: "1", price: "60000.01", size: "0.02", side: "BUY", time: "2026-10-30T12:00:00Z" };
  const batch = (seq, values, type = "update") => ({ channel: "market_trades", sequence_num: seq, events: [{ type, trades: values }] });
  socket.message(batch(0, [trade], "snapshot"));
  assert.equal(trades.length, 0);
  socket.message(ticker(0)); socket.message(batch(1, [trade]));
  socket.message(batch(1, [{ ...trade, trade_id: "2" }]));
  socket.message(batch(2, [trade, { ...trade, trade_id: "2", size: "NaN" }, { ...trade, product_id: "ETH-USD" }]));
  socket.message(batch(4, [{ ...trade, trade_id: "3" }]));
  assert.equal(trades.length, 2); assert.equal(ticks.length, 1);
  assert.equal(trades[0].size, 0.02); assert.ok(Object.isFrozen(trades[0]));
  assert.equal(trades[1].discontinuity, true);
  assert.equal(feed.inspect().rejected, 3); assert.equal(feed.inspect().tradeSequence, 4);
  socket.onclose(); clock.advance(1000);
  instances[1].message(batch(0, [trade]));
  assert.equal(trades.at(-1).connectionId, 2);
  feed.stop(); assert.equal(clock.count(), 0);
});

test("invalid data is observable; duplicate/order detection is ticker-channel scoped", () => {
  const { feed, socket, ticks } = setup();
  socket.onmessage({ data: "{" }); socket.message(null);
  socket.message(ticker(0, "")); socket.message(ticker(1, "Infinity"));
  socket.message({ ...ticker(2), timestamp: "bad" });
  socket.message(ticker(3)); socket.message(heartbeat);
  socket.message(ticker(3)); socket.message(ticker(2)); socket.message(ticker(5));
  assert.equal(ticks.length, 2);
  assert.equal(ticks[1].discontinuity, true);
  assert.equal(feed.inspect().gaps, 1);
  assert.equal(feed.inspect().rejected, 7);
  feed.stop();
});

test("error and close schedule one retry, stale callbacks cannot emit, sequence resets", () => {
  const { feed, socket, instances, clock, ticks } = setup();
  const stale = socket.onmessage, close = socket.onclose;
  socket.onerror(); close();
  assert.equal(feed.inspect().retryAt, 1000);
  assert.equal(clock.count(), 1);
  stale({ data: JSON.stringify(ticker()) }); assert.equal(ticks.length, 0);
  clock.advance(1000); instances[1].open(); instances[1].message(ticker());
  assert.equal(ticks[0].connectionId, 2);
  assert.equal(instances[1].sent.length, 3);
  instances[1].onclose();
  assert.equal(feed.inspect().retryAt, 3000);
  feed.stop(); clock.advance(60000); assert.equal(instances.length, 2);
});

test("timeouts, stale price, terminal subscription rejection and explicit retry", () => {
  const { feed, socket, clock, instances } = setup();
  clock.advance(10000); assert.equal(feed.inspect().state, "reconnecting");
  clock.advance(1000);
  const next = instances[1]; next.message(ticker()); next.message(heartbeat);
  for (let i = 0; i < 5; i++) { next.message(heartbeat); clock.advance(1000); }
  assert.equal(feed.inspect().reason, "stale-price");
  clock.advance(5000); assert.equal(feed.inspect().state, "reconnecting");
  clock.advance(2000);
  instances[2].message({ type: "error", message: "Unknown product" });
  assert.equal(feed.inspect().state, "error"); assert.equal(clock.count(), 0);
  assert.equal(instances[2].closed, undefined);
  feed.stop(); feed.start(); assert.equal(instances.length, 4);
  feed.stop(); assert.ok(socket.closed);
});

test("quiet subscribed markets remain open; only Stop unsubscribes", () => {
  const { feed, socket, clock } = setup(); socket.open();
  socket.message({ channel: "subscriptions", events: [{ subscriptions: { ticker: {} } }] });
  socket.message({ channel: "subscriptions", events: [{ subscriptions: { ticker: ["BTC-USD"] } }] });
  for (let i = 0; i < 30; i++) {
    socket.message({ ...heartbeat, events: [{ heartbeat_counter: String(i) }] }); clock.advance(1000);
  }
  assert.equal(socket.closed, undefined); assert.equal(feed.inspect().state, "waiting");
  feed.stop(); assert.equal(socket.closed, true);
  assert.deepEqual(socket.sent.slice(-3), [{ type: "unsubscribe", channel: "ticker", product_ids: ["BTC-USD"] },
    { type: "unsubscribe", channel: "market_trades", product_ids: ["BTC-USD"] },
    { type: "unsubscribe", channel: "heartbeats" }]);
  assert.equal(clock.count(), 0);
});

test("backoff caps and resets after a healthy connection", () => {
  const { feed, instances, clock } = setup();
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    instances.at(-1).onclose();
    assert.equal(feed.inspect().retryAt - clock.now(), delay); clock.advance(delay);
  }
  const socket = instances.at(-1); socket.message(ticker()); socket.message(heartbeat);
  for (let i = 0; i < 31; i++) { clock.advance(1000); socket.message(heartbeat); }
  socket.onclose();
  assert.equal(feed.inspect().retryAt - clock.now(), 1000);
  feed.stop();
});
