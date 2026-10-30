# Market as Music — data + mapping spec (Research)

## Data source
- **HF Data Library** (https://hfdatalibrary.com): free 1-minute OHLCV bars for 1,253 US stocks/ETFs incl. SPY, QQQ, from 2022-03-07 to present. CSV/Parquet download. UPDATE 2026-10-29: downloads now require a free account (Google/ORCID sign-in) and API key.
- License: CC BY 4.0 (redistribution and commercial OK). Must ship this attribution in README and app footer:
  - "Data from the HF Data Library (Elkassabgi 2026), https://hfdatalibrary.com, CC BY 4.0."
  - "Data provided for free by IEX. By accessing or using IEX Historical Data, you agree to the IEX Historical Data Terms of Use."
- Bundle per-day CSVs in the repo (390 bars/day each, tiny). No runtime API.
- Fallback with no account: IEX HIST raw feed (https://iextrading.com/api/1.0/hist?date=YYYYMMDD) gives a public TOPS pcap.gz per day, ~6.7 GB each. Build SPY 1-min bars from its trade messages with a one-time script, then delete the raw files. Same IEX attribution applies. Volume is IEX-only (same as HF).
- Rejected: FRED S&P 500 (S&P prohibits reproduction without permission), Stooq (redistribution terms unclear), paid APIs (need keys).
- Limitation: no licensed free minute data for 1987 / 2008 / 2010 flash crash. Leave them out.

## Days to bundle (SPY, 1-minute, Clean version) — verify each against the data before shipping
1. 2022-09-13: hot CPI print, steep all-day selloff
2. 2024-08-05: global selloff (yen carry-trade unwind), gap down + VIX spike
3. 2025-01-27: DeepSeek shock (also bundle NVDA)
4. 2025-04-03 / 2025-04-04: tariff crash, two straight big down days
5. 2025-04-09: tariff pause, huge intraday rally (the "euphoria" track)
6. A calm control day picked from the data (lowest realized vol in 2023)

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
