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
inspection and the future debug panel; no audio or playback state is needed.
