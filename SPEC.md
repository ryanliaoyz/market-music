# Market as Music — data + mapping spec (Research)

## Data source
- **HF Data Library** (https://hfdatalibrary.com): free 1-minute OHLCV bars for 1,253 US stocks/ETFs incl. SPY, QQQ, from 2022-03-07 to present. CSV/Parquet download. UPDATE 2026-10-29: downloads now require a free account (Google/ORCID sign-in) and API key.
- License: CC BY 4.0 (redistribution and commercial OK). Must ship this attribution in README and app footer:
  - "Data from the HF Data Library (Elkassabgi 2026), https://hfdatalibrary.com, CC BY 4.0."
  - "Data provided for free by IEX. By accessing or using IEX Historical Data, you agree to the IEX Historical Data Terms of Use."
- Bundle only the selected regular-session CSVs in the repo. A full session has 390 possible minute slots (09:30–15:59 America/New_York), but Clean data has missing minutes. Preserve observed bars and expose missing minute indices explicitly; never fabricate OHLCV or forward-fill. No runtime API.
- Fallback with no account: IEX HIST raw feed (https://iextrading.com/api/1.0/hist?date=YYYYMMDD) gives a public TOPS pcap.gz per day, ~6.7 GB each. Build SPY 1-min bars from its trade messages with a one-time script, then delete the raw files. Same IEX attribution applies. Volume is IEX-only (same as HF).
- Rejected: FRED S&P 500 (S&P prohibits reproduction without permission), Stooq (redistribution terms unclear), paid APIs (need keys).
- Limitation: no licensed free minute data for 1987 / 2008 / 2010 flash crash. Leave them out.

## Days to bundle (SPY, 1-minute, Clean version) — verify each against the data before shipping
1. 2022-09-13: hot CPI print, steep all-day selloff
2. 2024-08-05: global selloff (yen carry-trade unwind), gap down + VIX spike
3. 2025-01-27: DeepSeek shock (also bundle NVDA)
4. 2025-04-03 / 2025-04-04: tariff crash, two straight big down days
5. 2025-04-09: tariff pause, huge intraday rally (the "euphoria" track)
6. 2023-12-26: calm control, lowest realized volatility among full-length 2023 sessions. Exclude the July 3 and November 24 half-days so the control has the same session length as the event days. November 24 is the absolute minimum but is a shortened session.

Session verification and the volatility selection method are documented in `data/README.md`.

## Mapping (per 1-minute bar; one bar = one beat)
- Pitch: close mapped onto a minor pentatonic scale over 3 octaves, using the day's min..max range (always sounds musical).
- Tempo: base 120 BPM; playback speed adjustable (default whole day ≈ 2 min).
- Loudness: volume bar, log-scaled, normalized to day's median.
- Timbre/distortion: rolling 5-min realized volatility drives filter cutoff + waveshaper drive. Calm = clean sine/triangle, wild = distorted saw.
- Direction: up bar = major-third harmony added, down bar = minor/tritone.
- Events: |1-min return| > 3σ of the day plays a percussion hit (crash cymbal on drops, bright bell on spikes). Opening gap plays a gong at the start.
- Bass drone: VWAP (volume-weighted average price) as a low sustained note, so you can hear price pulling away from it.
- Visuals: price line drawn in sync, background color by volatility, flash on events.
- Debug panel: current bar, return, σ, chosen note, volume gain, distortion amount, and which rule fired.

## Feature calculation conventions

`computeFeatures(loadedSession)` in `src/features.js` accepts the validated loader
result and returns a new result with enriched `bars`, preserving the session and
missing-minute metadata. It does not mutate the input or retain state.

- `return`: simple fractional close-to-close return (`close / previousClose - 1`)
  only for adjacent exchange minutes. The first bar and bars after a gap have
  `null` returns; multi-minute moves are not treated as one-minute events.
- `sigma`: population standard deviation of all available one-minute returns for
  the selected day, excluding nulls (not annualized). `returnCount` exposes the
  sample count. A day with no returns has null σ; a flat day has zero σ.
- `eventThreshold`: `3 * sigma`. Each bar's `event` is `"drop"` or `"spike"` only
  when its absolute return strictly exceeds this threshold, otherwise `null`.
  The threshold uses the whole day, intentionally including future bars for this
  historical playback. It is not a deviation-from-mean test.
- `rollingVolatility`: square root of the sum of squared available returns whose
  ending minute lies in `[currentMinute - 4, currentMinute]`. No annualization,
  demeaning, or warm-up scaling; partial windows use what is available.
  `rollingReturnCount` exposes coverage; an empty window gives `null`, not zero.
- `vwap`: cumulative `sum(((high + low + close) / 3) * volume) / sum(volume)`.
  This is a bar-based approximation, not trade-level VWAP. Zero-volume bars leave
  it unchanged; it is `null` until the first positive-volume bar.
- `openingGapReturn`: first open divided by the catalog's previous close minus
  one, separately available for the opening gong. It is `null` if the opening
  minute is absent; a zero gap is zero. It never contributes to σ or volatility.

All returns and volatility values are fractions (0.01 means 1%). These values,
coverage counts, and event labels are available directly to development-console
inspection; no audio or playback state is needed.

## Sound engine conventions

`createSoundScore(features)` in `src/sound.js` is a pure mapping of the enriched
feature result. It preserves observed bar indices and exchange minutes, adding no
beats for missing minutes. All mappings use the full historical day, like σ.

- Close is quantized to the nearest of 16 C-minor-pentatonic notes, C3 through C6
  inclusive (MIDI 48–84), using the day's minimum and maximum **close**. A flat day
  uses the range midpoint. VWAP uses the same price range, clamped to it, over
  C2–C3 for the bass drone; null VWAP is silent.
- Lead gain is `0.22 * clamp(log2(1 + volume / reference) / 2, 0, 1)`, so median
  volume has gain 0.11, zero volume is silent, and three times median reaches the
  ceiling. The reference is the day's median volume; if zero, use the median of
  positive volumes, or 1 for an all-zero day. The median and chosen reference are
  inspectable in the score. Event hits and the drone have independent levels.
- Volatility intensity is rolling volatility divided by the day's peak, or zero
  for unavailable/zero volatility. It crossfades triangle to sawtooth, raises the
  low-pass cutoff from 400 to 8000 Hz, and sets waveshaper drive from 0 to 24.
  Zero drive is an identity curve; positive drive uses normalized tanh saturation.
- A positive one-minute return adds a major third (+4 semitones); a negative one
  adds a tritone below (−6), at 35% of lead gain. Zero/null returns add no harmony.
- Feature events alone fire deterministic synthesized hits: high-passed noise for
  a drop, two sine partials for a spike bell. A nonzero, available opening gap
  fires a three-partial gong only when scheduling bar index 0. Replaying that bar
  intentionally replays the gong; a zero/unknown gap does not fire it.
- Each lead/harmony voice has a short attack and exponential release over 90% of
  the beat. One sine drone persists between calls, with pitch and gain scheduled
  for each beat; its gain is zero after the last scheduled beat. A master gain of
  0.6 feeds a dynamics compressor before the destination.

`createSoundEngine(features, { context } = {})` owns a new AudioContext unless one
is supplied. Call `await engine.resume()` from a user gesture. `playBar(index,
{ when, duration })` schedules on the audio clock and returns the chosen mapping;
time defaults to now, duration to 0.5 seconds (120 BPM). Call in chronological order
with non-overlapping beats. Timing, speed, missing-minute rests, and seek policy
belong to playback (M4); this engine creates no timers. The ≈2-minute day default
uses faster-than-base playback there.

`stop()` immediately disconnects/cancels all voices, drone, and future scheduled
sounds; the engine can then be reused. `await dispose()` also disconnects the
output and closes only an owned context. Natural voice endings release their
nodes. `inspect()` exposes context time/state, pending resume, allocated voice and
drone state, disposal, and the last scheduled bar's return, σ, MIDI note, gain,
drive, timing, and fired rules. `score` exposes all mappings and normalization
references. Neither diagnostic represents the current audible playback cursor.

## Playback conventions

`createPlayback(features, options)` in `src/playback.js` owns a lazily created sound
engine. `play()` resumes audio from the Play gesture; `pause()`, `seek(minute)`,
`setSpeed(speed)`, and `dispose()` cancel queued sounds immediately. The page loads
the selected day paused and disposes the old player on selection changes. Only the
latest requested session may update the controls; load and resume errors appear
in the status line and development diagnostics.

- The timeline always covers 390 exchange-minute slots, 09:30–15:59. Missing slots
  are rests, with no invented bars; the end is 16:00. A beat lasts `0.5 / speed`
  seconds. Speeds are 0.5×, 1×, 1.625× (default, 120 seconds), 2×, and 4×.
- A 25 ms timer schedules up to 100 ms ahead against the audio clock, with 30 ms
  startup lead time. The audible cursor comes from that clock, independently of
  the last scheduled mapping. Delayed/background timers skip expired beats rather
  than bunching them together. A suspended audio clock leaves the cursor still.
- Pause retains the current integer minute. Resume, seek, and speed changes replay
  that minute from its start, cancelling prior voices and event tails. Seeking
  accepts integer slots 0–389 and preserves playing/paused state. A change while
  audio resume is pending cancels the play request and leaves playback paused.
- End-of-session stops all sounds and timers; Play then restarts at minute zero.
  Replaying the first observed bar follows the engine's opening-gong policy.
- `inspect()` exposes state, fractional position, minute, observed bar index (null
  for rests), speed, next scheduling minute, waiting reason, last transition, and
  engine diagnostics. `window.marketMusic.inspect()` adds page loading/error state.
  The debug panel also displays the current cursor mapping and playback reasons.

## Visual conventions

`createVisuals(features, svg)` in `src/visuals.js` renders playback snapshots from
the existing 25 ms audio-clock notifications; it owns no timer or event queue.
It never uses the sound engine's lookahead mapping as the visible current bar.

- The SVG shows close price over all 390 minute slots, scaled to the day's minimum
  and maximum close (flat days sit at mid-height). The line is progressively
  revealed at the fractional playback cursor. Missing minutes break the path and
  hide the current-price point; no price is invented. Seeking rewinds/reveals the
  line immediately; the end reveals the full line with the cursor at 16:00.
- Background intensity uses the same rolling-volatility/day-peak normalization
  as sound: cool blue at zero/unavailable volatility, warm orange at the peak.
  A missing current bar has zero intensity, not a carried-forward value.
- Drop/spike events flash pink/green; a nonzero opening gap flashes gold on minute
  zero. Opacity fades from 35% to zero during the first half of the current beat,
  so it follows speed and cannot accumulate stale event timers. Startup lead time,
  paused/starting/ended states, and seeks before audio starts show no flash.
  Reduced-motion preferences hide the flash layer. No CSS transitions delay the
  cursor or background. Paused seeking previews the target bar's background.
- Day loading hides the old chart; a new session rebuilds its scale and path.
  `window.marketMusic.inspect().visuals` exposes the last rendered position,
  minute, close (null for rests), intensity, event, flash strength, and playback
  waiting/transition reason. This is render state, not future scheduled audio.

## Debug panel conventions

`createDebugPanel(features, root)` in `src/debug.js` maps the selected session once
with `createSoundScore` and renders the same audio-clock snapshots as the chart.
The collapsible panel owns no timer, audio context, or firing history.

- Current bar means the cursor's exchange minute and zero-based observed bar index,
  not the engine's last scheduled bar. Paused/starting states label values as mapping
  previews. All matching rule IDs are shown, including harmony and opening gong;
  they describe the bar's mapping, not proof that a sound played (late timers may
  skip beats). An empty rule list is shown as `none`.
- Return and day population σ are displayed as percentages to four decimal places;
  unavailable values are `n/a`. σ stays visible during rests. The note has its name,
  octave, and MIDI number. Lead gain is linear and drive ranges from 0 to 24, both
  displayed to four decimal places; zero remains distinct from unavailable.
- Missing minutes show a rest and clear note/return/gain/drive/rules. End/disposal
  shows no current bar. Waiting reason and last transition stay inspectable.
- The panel is hidden during session loading or load failure, then rebuilt for the
  selected day. Native details/summary provides keyboard toggling; values are not
  an announcing live region. Unchanged text is not rewritten on clock ticks.
  `window.marketMusic.inspect().debug` exposes the last rendered values without
  display rounding, plus session, state, minute, bar index, and playback reasons.

## Browser verification

M7 uses Playwright with headless Chromium against a local static server and the
bundled sessions. `npm test` includes unit and browser checks; CI installs Chromium
and runs the same command. Browser tests use normal controls, real Web Audio, and
the existing development inspection surface, without replacing the audio clock.
They cover paused previews, keyboard seek/panel toggling, play/pause/resume,
playing seek and speed changes, missing-minute rests, end/replay, session switching,
and fetch failure recovery. Assertions wait for observable state rather than
requiring exact wall-clock beat timing. Failure traces and screenshots are retained.

Chromium is the initial automated browser target. Audible quality and deployed
playback require the manual check in the README. Hosting import and the deployed
URL check belong to Ryan; M7's browser checks do not require an account or token.
