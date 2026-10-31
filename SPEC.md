# Runtime contracts

The pipeline is `src/data.js` (validation) → `src/features.js` (pure calculations)
→ `src/sound.js` (mapping/synthesis) → `src/playback.js` (audio-clock scheduling).
`src/main.js` connects controls and session loading; `src/visuals.js` and
`src/debug.js` render playback snapshots. See the [data guide](data/README.md) for
loader contracts, source choices, and session verification, and the
[README](README.md) for running, testing, deployment, and manual checks.

## Live crypto contracts

The live pipeline is `live-feed.js` (Coinbase validation/connection) →
`live-playback.js` (receive-time buffer/scheduling) → `live-features.js` (causal
frames) → `sound.js` (shared mapping/synthesis). `main.js` wires Start/Stop and the
existing chart/debug surfaces. Historical CSV loading and the 390-minute player
retain their separate contracts below.

### Subscription lifecycle

- Selecting Live does not connect. Start resumes audio from its user gesture and
  opens `wss://advanced-trade-ws.coinbase.com`, subscribing separately to public
  `ticker` for `BTC-USD` and `heartbeats`, with no JWT. Stop sends unsubscribe
  messages when open, closes the socket, cancels retries/audio, and clears the
  session. Mode selection is disabled until Stop. There is no live Pause.
- States are stopped, starting, waiting for first price, buffering, playing,
  reconnecting, and error. Subscription errors leave Stop available and do not
  close a healthy socket; Stop then Start retries. Audio failures propagate and
  remain actionable while Stop retains subscription ownership.
- Connection/subscription timeout is 10 seconds; missing heartbeats for five
  seconds cause reconnect. A healthy subscribed but quiet market stays connected
  and produces rests. Reconnect uses jittered exponential backoff up to 30 seconds,
  resetting after 30 healthy seconds. Obsolete callbacks cannot emit data.
- A network drop silences audio and clears the delayed segment. Reconnection
  resubscribes, then buffers five seconds from its first fresh tick. Missing data
  is never backfilled. Coinbase is the only shipped provider; Kraken is contingency
  only, as described in the README.

### Receive timeline and mapping

- The first valid tick anchors a segment. Frame zero uses that tick; subsequent
  cutoffs occur every 500 ms. The newest tick received within each interval is
  used; there is no carried price in empty intervals. Exchange timestamps are
  labels only. Monotonic browser receipt time determines the timeline.
- Every frame has a playback deadline exactly 5,000 ms after its source cutoff.
  Frames are prepared during buffering, then scheduled up to 100 ms ahead on the
  audio clock by a 25 ms timer, with 470 ms voice duration. No frame consumes ticks
  newer than its source cutoff. Ticks between cutoffs are quantized to the next
  cutoff (at most another 500 ms); network/exchange latency is additional.
- Late timers skip missed audio deadlines instead of shifting the delay or playing
  a catch-up burst. Suspended audio does not consume a backlog on return. Buffered
  and input frame bins are bounded; the visible chart retains up to 120 delayed
  frames, with gaps across missing slots, reconnects, and sequence discontinuities.
- Return is current price / preceding adjacent frame price − 1, otherwise null.
  Pitch uses the trailing 60-second observed range (flat → midpoint). Realized
  volatility is the root sum of squared available returns over ten frame slots;
  intensity uses the trailing peak. Event threshold is 3× population σ of preceding
  available returns in the window; require ten prior returns and positive σ.
  No future tick can revise an emitted mapping.
- Live gain is 0.11. `ticker.volume_24_h` is not trade size, so live has no
  volume-derived gain, VWAP drone, or opening gong. Scale, harmony, timbre, and
  spike/drop hits reuse `mapSoundFrame()` and `engine.playMapping()`. Historical
  `createSoundScore()`/`playBar()` use the same mapping/synthesis with their original
  normalization. A later Tone.js implementation can replace synthesis without
  changing feed or timeline code.

### Capture and diagnostics

Validated ticks are immutable plain values: provider/product, connection ID,
ticker-channel sequence, exchange/receipt timestamps, monotonic session offset,
price, and sequence-gap flag. Duplicate/out-of-order messages are rejected;
unrelated products are ignored. Heartbeat counters accept integer or decimal-string
representations. Malformed payloads are counted and exposed, not silently recovered
into fabricated prices.

`createLivePlayback()` accepts injected clocks/timers and external audio contexts.
Its `onTick` callback emits every accepted tick before coalescing, adding segment ID
and session receipt offset. `onFrame` emits prepared frames with policy `live-v1`,
segment ID, source/session offsets, intended playback offset, normalization
references, and mapping. These callbacks are the GRO-27 recorder/replay seam; no
recording persistence or export is implemented here.

`inspect()` exposes active/state/reason, buffer duration, queue size, segment ID,
newest received price/time, delayed cursor, delayed chart frames, audible frame,
and audio diagnostics. Only delayed prices appear on the main chart; newest received
data belongs in Debug. Audible frame timing, rather than scheduler lookahead,
drives mapping diagnostics and event flashes. Reduced motion suppresses flashes.
`window.marketMusic.inspect()` adds provider errors/retry timing, sequence/gap and
rejection counters, tick/heartbeat ages, and rendered chart/debug snapshots.

## Feature calculation conventions

`computeFeatures(loadedSession)` returns enriched `bars` with session and
missing-minute metadata preserved, without mutation or retained state. Returns
and volatility are fractions (`0.01` = 1%), inspectable without audio/playback.

| Field | Definition |
| --- | --- |
| `return` | `close / previousClose - 1`, only across adjacent exchange minutes; null for the first bar or after a gap. |
| `sigma`, `returnCount` | Whole-day population standard deviation and count of non-null one-minute returns, not annualized. No returns → null σ; flat returns → zero σ. |
| `eventThreshold`, `event` | Threshold = `3 * sigma`; `"drop"` / `"spike"` only when absolute return strictly exceeds it, otherwise null. Uses future bars intentionally, not deviation from the mean. |
| `rollingVolatility`, `rollingReturnCount` | Square root of summed squared available returns ending in `[currentMinute - 4, currentMinute]`, and their count. No annualization, demeaning, or warm-up scaling; partial windows use available returns, empty windows give null. |
| `vwap` | Cumulative `sum(((high + low + close) / 3) * volume) / sum(volume)`, a bar-based approximation. Zero volume leaves it unchanged; null until positive volume. |
| `openingGapReturn` | First open / catalog previous close − 1; null if the opening minute is absent, zero for no gap. Separate from σ and rolling volatility. |

## Sound engine conventions

`createSoundScore(features)` purely maps enriched features, preserving observed
bar indices and exchange minutes without inserting bars. Normalization uses the
full historical day.

- **Pitch:** nearest of 16 C-minor-pentatonic notes, C3–C6 (MIDI 48–84), across
  minimum/maximum close; flat days use the midpoint. VWAP uses that price range,
  clamped, over C2–C3; null VWAP silences the sine drone.
- **Lead gain:** `0.22 * clamp(log2(1 + volume / reference) / 2, 0, 1)`.
  Median volume gives 0.11, zero gives silence, 3× median reaches the ceiling.
  Reference = median volume, or median positive volume if zero, or 1 if all zero.
  Score diagnostics expose median/reference; drone and event levels are independent.
- **Timbre:** rolling volatility / day peak, or zero if unavailable/zero,
  crossfades triangle → sawtooth, raises low-pass cutoff 400 → 8000 Hz, and sets
  waveshaper drive 0 → 24. Zero drive is identity; positive drive uses normalized tanh.
- **Harmony:** positive return adds +4 semitones; negative adds −6, at 35% of
  lead gain. Zero/null returns add none.
- **Events:** feature drops trigger deterministic high-passed noise; spikes trigger
  a two-sine-partial bell. A nonzero available opening gap triggers a three-partial
  gong only at bar index 0; replaying that bar repeats it.
- **Voices:** lead/harmony use short attack and exponential release over 90% of
  the beat. One sine drone persists between calls with per-beat pitch/gain and
  silence after the last scheduled beat. Master gain 0.6 feeds a compressor.

`createSoundEngine(features, { context } = {})` owns an AudioContext unless supplied.
Call `await engine.resume()` from a user gesture. `playBar(index, { when, duration })`
schedules chronologically, without overlapping beats, on the audio clock; defaults
are now and 0.5 seconds. It returns the mapping. Playback supplies `skipIfLate: true`
to return null without allocating sounds when a beat expires before the engine
reads the clock; other callers reject past times. The engine creates no timers;
playback owns speed, rests, and seeking.

`stop()` immediately cancels/disconnects voices, drone, and queued audio, leaving
the engine reusable. Natural voice endings release nodes. `await dispose()` also
disconnects output and closes only an owned context. `inspect()` exposes context
time/state, pending resume, voice/drone state, disposal, and the last scheduled
bar's return, σ, MIDI note, gain, drive, timing, and rules. `score` exposes all
mappings and normalization references. Neither is the audible cursor.

## Playback conventions

`createPlayback(features, options)` lazily owns a sound engine. `play()` resumes
audio from the Play gesture; `pause()`, `seek(minute)`, `setSpeed(speed)`, and
`dispose()` immediately cancel queued sounds. Day changes dispose the old player
and load paused. Only the latest request may update controls; loading/resume errors
appear in the status line and development diagnostics.

- Timeline: 390 slots, 09:30–15:59 America/New_York, ending at 16:00. Missing slots
  are rests. Beat duration = `0.5 / speed` seconds; speeds are 0.5×, 1×, 1.625×
  (default, 120 seconds/day), 2×, and 4×.
- A 25 ms timer schedules up to 100 ms ahead on the audio clock with 30 ms startup
  lead. The audible cursor is independent of the last scheduled mapping. Delayed
  timers skip expired beats; suspended audio leaves the cursor still.
- Pause retains the integer minute. Resume, seek, and speed changes replay it from
  the start, cancelling voices/tails. Seek accepts integer slots 0–389 and preserves
  playing/paused state. Changes during pending resume cancel play and leave paused.
- End stops sounds/timers; Play restarts at zero, following the opening-gong policy.
- `inspect()` exposes state, fractional position, minute, observed bar index (null
  for rests), speed, next scheduling minute, waiting reason, last transition, and
  engine diagnostics. `window.marketMusic.inspect()` adds page loading/error state.

## Visual conventions

`createVisuals(features, svg)` renders the existing 25 ms playback snapshots,
without its own timer/event queue or the sound engine's lookahead mapping.

- SVG close prices span all 390 slots and the day's close range; flat days sit at
  mid-height. The line reveals to the fractional cursor; gaps break it and hide
  the current-price point. Seek updates immediately; end reveals all with a 16:00 cursor.
- Background uses sound's volatility intensity: blue at zero/unavailable, orange
  at peak. Missing bars use zero, never a carried-forward value. Paused seeks
  preview the target background; no CSS transitions delay the cursor/background.
- Drops/spikes flash pink/green; a nonzero opening gap flashes gold at minute zero.
  Opacity fades 35% → zero over the beat's first half, following speed without stale
  timers. Startup lead, paused/starting/ended states, and seeks before audio starts
  show no flash. Reduced-motion preferences hide flashes.
- Loading hides the old chart; each session rebuilds scale/path.
  `window.marketMusic.inspect().visuals` exposes rendered position, minute, close
  (null for rests), intensity, event, flash strength, and waiting/transition reason.

## Debug panel conventions

`createDebugPanel(features, root)` calls `createSoundScore` once per session and
renders the chart's playback snapshots, with no timer, audio context, or firing history.

- Current bar = cursor minute and zero-based observed index, not last scheduled bar.
  Paused/starting values are labeled mapping previews. All matching rule IDs appear,
  including harmony/gong; none displays as `none`. Rules describe mappings, not proof
  of playback: late timers may skip beats.
- Return/day population σ display as percentages to four decimal places; unavailable
  values are `n/a`. Notes include name, octave, MIDI. Linear gain and drive (0–24)
  show four decimals, distinguishing zero from unavailable.
- Rests clear note/return/gain/drive/rules but retain σ. End/disposal has no current
  bar; waiting/transition reasons remain inspectable.
- Loading/failure hides the panel; a new session rebuilds it. Native details/summary
  supports keyboard toggling. Values are not an announcing live region; unchanged
  text is not rewritten on ticks. `window.marketMusic.inspect().debug` exposes
  unrounded rendered values, session, state, minute, bar index, and playback reasons.
