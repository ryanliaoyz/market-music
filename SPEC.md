# Runtime contracts

The pipeline is `src/data.js` (validation) → `src/features.js` (pure calculations)
→ `src/sound.js` (mapping/synthesis) → `src/playback.js` (audio-clock scheduling).
`src/main.js` connects controls and session loading; `src/visuals.js` and
`src/debug.js` render playback snapshots. See the [data guide](data/README.md) for
loader contracts, source choices, and session verification, and the
[README](README.md) for running, testing, deployment, and manual checks.

## Deployment boundary

The application is a static HTTPS site with no backend: live subscriptions connect
directly from the browser to Coinbase, and recording replay/WAV export run locally.
The service worker stays at the app root so its scope covers the shell. See the
[production path and acceptance checklist](README.md#deploy).

Release v2 does not change the `#recording=v1.` format or its synthesis semantics.
Version 2.1 adds musical live synthesis and `#recording=v2.` while retaining v1 replay.
Worker cache versions track shell changes independently of release numbering;
documentation-only changes do not require a cache bump.

## Recording contracts

`recording.js` consumes live schedule/cancel callbacks, including already queued
lookahead at Record time. Capture starts on the next scheduled frame; cancelled
frames are removed and preset replacements upsert the same schedule ID. Relative
delayed playback offsets preserve rests and remain stable when rescheduling converts
deadlines to audio-clock time again. Capture ends at 30 seconds (at most 60 frames),
manual stop, or the live segment/audio interruption boundary. Endpoints exclude
unheard future frames; empty intervals do not create a clip. Completed clips stay
in memory until replaced by another recording or the page is unloaded.

`recording-codec.js` owns the `#recording=v1.` contract: unpadded base64url of a
big-endian binary payload, at most 4,096 ASCII characters including the prefix.
The four-byte header is product byte (1 = BTC-USD), uint16 duration milliseconds,
and uint8 frame count. Each 24-byte frame contains uint16 relative milliseconds,
float64 price, uint8 preset index in the existing versioned preset order, uint8
MIDI note, uint8 harmony (255 = none), float64 intensity, uint8 event (0 = none,
1 = drop, 2 = spike), and two reserved zero bytes. Decoder validation rejects
unknown versions/products/presets/flags, incorrect lengths, unordered timestamps,
out-of-clip offsets, nonfinite/out-of-range synthesis, and nonpositive prices
(maximum 1e12). Decode validates once before passing typed clip values inward.

Version 2 uses the same header, limits and first 24 frame bytes, with preset indices
in `LIVE_PRESETS` order. Each 29-byte frame adds three uint8 chord MIDI notes,
a uint8 four-step rhythm mask and uint8 accent (0–3). Reserved bytes stay zero.
Notes must belong to the preset scale, the mask to its versioned rhythm options,
harmony must equal the first chord note, and intensity must equal accent / 3.
A clip cannot mix synthesis versions. Sixty frames fit comfortably below 4 KiB.
The decoder accepts both prefixes; encoding chooses from the captured preset version.

The compact synthesis snapshot is deliberate: prices alone cannot reproduce the
causal normalization preceding a mid-session capture. Version 1 fixes gain at
0.11 and derives frequency, harmony frequency, filter and drive from captured
notes/intensity. Preset IDs and version 1 synthesis semantics remain replay
contracts. A format/synthesis change requires a new version.

`live-music.js` expands resolved v2 notes/chords/masks/accents identically for live,
replay and WAV; it does not recompute market history. Existing v1 preset definitions
and synthesis remain frozen. New musical definitions require new preset IDs.

`recording-playback.js` schedules those mappings with the shared sound engine,
requires a Start gesture, preserves gaps, skips late deadlines, and stops all tails
at the endpoint. It never opens a feed. `wav.js` uses the same mappings with native
OfflineAudioContext (mono, 44,100 Hz) and PCM16 WAV encoding. Tone's offline wrapper
advances its own clock; frame cleanup waits until rendering finishes. WAV length
is the clip duration rounded up to the next sample, without an added release tail.
The URL, an in-memory clip, and temporary download Blob URLs are the only outputs;
there is no backend, audio hosting, or recording persistence. Recording/debug state
is inspectable in the existing Debug panel and `window.marketMusic.inspect()`.

## Mobile and shell cache contracts

`main.js` owns foreground-only lifecycle handling. Hidden visibility or pagehide
pauses historical playback and stops live/shared replay. Live Stop closes the
socket, cancels retries/watchdogs, clears the delayed segment and finishes capture.
Returning never auto-starts; the next Start gesture resumes historical at its
minute, restarts replay, or reconnects live with a fresh five-second buffer.
Pending audio-start completions cannot undo Stop/Pause. Browser audio suspension
detected by playback snapshots follows the same interruption path. Audio contexts
are created lazily and resumed in the gesture path; a non-running resume is an error.

`pwa.js` registers the root worker in secure contexts and exposes registration state
through existing diagnostics. `sw.js` atomically precaches an explicit same-origin
GET shell allowlist. The scoped entry URL maps to cached index.html; query variants
and other requests remain network-only. Data files, live messages, recordings and
exports never enter Cache Storage. Shared recording hashes are decoded in memory.
Offline catalog failure is actionable and does not block shared replay or mode selection.

Each deployment changing shell contents bumps the worker cache version. No
skipWaiting/clients.claim: updates wait for old clients to close to avoid mixing
versions. Activation deletes only obsolete `market-music-shell-` caches. Icons are
generated from `scripts/generate-icons.py`; maskable artwork stays in the safe zone.

## Live crypto contracts

The live pipeline is `live-feed.js` (Coinbase validation/connection) →
`live-playback.js` (receive-time buffer/scheduling) → `live-features.js` (causal
frames) → `sound.js` (shared mapping/synthesis). `main.js` wires Start/Stop and the
existing chart/debug surfaces. Historical CSV loading and the 390-minute player
retain their separate contracts below.

### Subscription lifecycle

- Selecting Live does not connect. Start resumes audio from its user gesture and
  opens `wss://advanced-trade-ws.coinbase.com`, subscribing separately to public
  `ticker` and `market_trades` for `BTC-USD`, plus `heartbeats`, with no JWT. Stop sends unsubscribe
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
  Musical pitch starts at degree 7 in C natural minor and moves by signed 1–3 scale
  degrees per adjacent return, normalized by the largest absolute return in the
  current and preceding 39 slots (20 seconds). Magnitudes below 0.1 of that range
  hold the degree; flat/gapped returns also hold. Degrees stay within 0–14 by octave
  wrapping (seven degrees), avoiding saturation during a sustained trend. Realized
  volatility is the root sum of squared available returns over ten frame slots;
  intensity uses the trailing peak. Event threshold is 3× population σ of preceding
  available returns in the window; require ten prior returns and positive σ.
  No future tick can revise an emitted mapping.
- Trend sums current and preceding 15 slots' returns, with a neutral band of half
  the recent return range. At eight-slot (four-second) bar boundaries, rising,
  falling and neutral trends select degree progressions `[0,3,4,0]`, `[0,5,3,4]`,
  `[0,3,0,4]` respectively. Triads stack scale degrees 0/2/4 above that root.
- Trade rate uses the current and preceding seven slots, in trades/second. Rates
  above 2 and 8 select medium/high density. Average trade size relative to the
  preceding slots' mean selects rounded accents 1–3 (no trades → 0; first → 1).
  `market_trades` snapshots are ignored rather than played as fresh activity;
  updates validate product, ID, time, side, positive price and size. Independent
  channel sequencing rejects repeats; a bounded 2,048-ID set rejects overlapping
  trade batches. Reconnect clears trade bins and analysis with the price segment.
- `LIVE_PRESETS` owns four immutable v2 definitions. Classic masks are `[1,5,15]`
  with chord stabs; Ambient `[1,1,5]` with sustained texture; Plucky `[1,9,15]`
  with short chord arpeggios; Bass-heavy `[1,3,11]` with low melody and offbeat chords.
  Masks address four 125 ms subdivisions in each frame, at most four lead and three
  chord voices. Preset gates and texture affect timing as well as timbre.
- Base live gain is 0.11; accents multiply lead gain by 1 + accent / 6, with quiet
  chord voices. There is no VWAP drone or opening gong. Spike/drop hits remain.
  `live-music.js` maps prepared features; `engine.playMapping()` schedules them.
  Historical mapping retains its original presets and normalization. Preset changes
  preserve the feed, source analysis and five-second timeline.

### Capture and diagnostics

Validated ticks are immutable plain values: provider/product, connection ID,
ticker-channel sequence, exchange/receipt timestamps, monotonic session offset,
price, and sequence-gap flag. Duplicate/out-of-order messages are rejected;
unrelated products are ignored. Heartbeat counters accept integer or decimal-string
representations. Malformed payloads are counted and exposed, not silently recovered
into fabricated prices.

`createLivePlayback()` accepts injected clocks/timers and external audio contexts.
Its `onTick` callback emits every accepted tick before coalescing, adding segment ID
and session receipt offset. `onFrame` emits prepared frames with policy `live-v2`,
segment ID, source/session offsets, intended playback offset, normalization
references, and mapping. These callbacks are the GRO-27 recorder/replay seam; no
recording persistence or export is implemented here.

`onFrame` remains immutable source-time analysis; its default mapping is not a
record of what was played. `onSchedule(frame)` is the GRO-27 audio capture seam:
it emits the actual mapping, versioned `presetId`, duration, audio-clock `when`,
and existing session/source/playback offsets. Its `scheduleId` (`segmentId:slot`)
is unique within one Start session. `onCancel(scheduleId)` invalidates queued
frames on preset replacement, Stop, or reconnect. A recorder must upsert by this
ID, remove cancellations, and begin a new namespace per Start. Thus a replacement
inside lookahead captures only the final audible preset, never both versions.

Live `setPreset(id)` remaps future audio using each frame's original causal
references. It cancels/reschedules future lookahead voices at the same deadlines,
without resetting history, the segment, buffer, or connection. Already-started
frames/tails keep their preset; the next audible non-rest frame uses the new one.
Selection survives reconnect and Stop/Start. `inspect().presetId` is the selected
ID; `audible.mapping.presetId` is the audible one, which may still differ.

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

`src/presets.js` defines immutable, versioned IDs: `classic-v1` (default),
`ambient-v1`, `plucky-v1`, and `bass-heavy-v1`. IDs alone serialize the complete
sound definition; incompatible changes require a new ID. Unknown IDs are rejected.
Scores and mappings carry `presetId`, scale intervals, MIDI root, and oscillator.
`createSoundScore(features, { presetId })` and `mapSoundFrame(..., { presetId })`
share the pure mapping. Classic's formulas below remain the default.

Ambient uses sine/soft attack, Plucky triangle/short decay with major-pentatonic
intervals `[0, 2, 4, 7, 9]`, and Bass-heavy sawtooth with root MIDI 36.
Ambient and Classic use root 48 and minor-pentatonic `[0, 3, 5, 7, 10]`.
Each lead spans three octaves, its drone starts an octave below the root;
signed chromatic harmony and rule IDs remain unchanged for every preset.

New presets use `src/tone-engine.js` and vendored Tone.js 15.1.22, without Transport
or sample assets. Tone uses the engine's audio clock with zero added lookahead.
Per-frame Synth envelopes feed a lowpass at mapping cutoff then distortion
(`drive / 48`); lead gain is applied as synth dB volume. Native sine drones and
deterministic event hits retain their original synthesis. Frame nodes are freed
after their envelopes, and Stop disconnects them immediately. Tone's wrapper is
disposed without closing the borrowed native context; the engine owns native
closure. Classic continues through the original Web Audio graph.

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

`setPreset(id)` updates historical scoring and stops voices. Historical playback
restarts the displayed minute when playing and updates paused previews, preserving
end state; a change during pending resume leaves playback paused. `cancelScheduled(time)`
cancels only future voice graphs (used by live playback, which has no drone).

`stop()` immediately cancels/disconnects voices, drone, and queued audio, leaving
the engine reusable. Natural voice endings release nodes. `await dispose()` also
disconnects output and closes only an owned context. `inspect()` exposes context
time/state, pending resume, voice/drone state, disposal, and the last scheduled
bar's return, σ, MIDI note, gain, drive, timing, and rules. `score` exposes all
mappings and normalization references. Neither is the audible cursor.

## Playback conventions

`createPlayback(features, options)` lazily owns a sound engine. `play()` resumes
audio from the Start gesture; `pause()`, `seek(minute)`, `setSpeed(speed)`, and
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
- End stops sounds/timers; Start restarts at zero, following the opening-gong policy.
- `inspect()` exposes state, fractional position, minute, observed bar index (null
  for rests), speed, next scheduling minute, waiting reason, last transition, and
  engine diagnostics. `window.marketMusic.inspect()` adds page loading/error state.

## Visual conventions

`main.js` renders four native radio cards, retaining their selection across days
and matching preset families across modes. Shared replay disables the cards because
its captured presets drive synthesis. The primary button reads Start/Stop in all
modes and exposes `aria-pressed`; historical Stop calls pause and retains its minute.
Debug and credits use closed-by-default native disclosures. Recording actions stay
outside Debug. The mobile grid uses two card columns, expanding to four on desktop.

The fixed viewport scene sits behind the controls. Its ambient glow uses the rendered
visual intensity (teal → warm) and debug note position, without another timer or
lookahead. Only the ambient layer eases between values; reduced motion removes easing
and event flashes. Derived values remain inspectable through the existing visual/debug
snapshots and the scene's `--scene-hue`, `--scene-energy` and `--note-position` properties.

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

`createDebugPanel(features, root)` refreshes `createSoundScore` on preset changes and
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
