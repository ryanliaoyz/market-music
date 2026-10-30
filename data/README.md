# Bundled sessions

These eight CSVs are slices of HF Data Library's **Clean, 1-minute** SPY and NVDA
histories downloaded on 2026-10-29. Attribution and license are in the
[root README](../README.md#data-attribution). Volume covers IEX only, not the
consolidated market. Prices are the source's prices, without further adjustment.

## Coverage and verification

Only observed regular-session bars are included, in source order. Timestamps are
America/New_York wall time with no UTC suffix; the session is 09:30 inclusive to
16:00 exclusive. Missing minutes stay missing: no synthetic bars, zero-volume
placeholders, interpolation, or forward-fill. Every bundled day has its opening
bar; the control's last observed bar is 15:52, while the event days end at 15:59.
The column names are normalized to lowercase and the timestamp
separator to `T`; numeric text is retained from the source.

`sessions.json` holds labels, observed counts, previous-session dates and last
observed IEX closes, and verification metrics. Only that prior-close context is
retained from unbundled sessions. Returns are ratios minus one (not percentages).
They use the last observed regular-session bar rather than an official
consolidated closing auction.

| Symbol | Date | Bars | Opening gap | Open to last close | Prior close to last close |
| --- | --- | ---: | ---: | ---: | ---: |
| SPY | 2022-09-13 | 383 | −2.24% | −2.19% | −4.38% |
| SPY | 2023-12-26 | 370 | +0.10% | +0.34% | +0.43% |
| SPY | 2024-08-05 | 374 | −3.99% | +1.12% | −2.91% |
| SPY | 2025-01-27 | 388 | −2.15% | +0.79% | −1.39% |
| NVDA | 2025-01-27 | 370 | −12.49% | −5.04% | −16.90% |
| SPY | 2025-04-03 | 383 | −3.45% | −1.44% | −4.84% |
| SPY | 2025-04-04 | 387 | −2.54% | −3.38% | −5.84% |
| SPY | 2025-04-09 | 384 | −0.43% | +9.83% | +9.36% |

CPI day sells off further after its opening gap. August 5 and SPY's DeepSeek day
recover intraday but remain below their prior closes; NVDA falls much harder.
The tariff sessions show consecutive steep losses followed by April 9's huge
intraday rally. These bars support the price stories; they do not establish news
causation or independently measure the VIX spike.

The control ranks lowest among **248 full-length 2023 sessions** in the download
(250 sessions total, excluding July 3 and November 24 early closes). Rank by
`sqrt(sum(log(close[i] / close[i-1])²))` over adjacent observed bars, excluding the
overnight gap, without annualizing or filling missing minutes. December 26 is
0.2633%; November 24, the excluded absolute minimum, is 0.2238% before its 13:00
close. This is observed-bar realized volatility, not an estimate corrected for
missing trades. The selection deliberately favors equal scheduled session length.

## Loader and inspection

`src/data.js` has no runtime service dependency. `loadCatalog()` fetches and
validates `sessions.json`; pass one of its entries to `loadSession(session)`.
The CSV boundary checks dates, session times, strict minute ordering, finite
positive OHLC, price bounds, nonnegative integer volume, and the catalog count.
HTTP and parsing failures propagate to the caller.

The result is `{ session, bars, missingMinutes }`. Each bar has numeric
`open`, `high`, `low`, `close`, `volume`, its original local `timestamp`, and
`minute` (0 = 09:30, 389 = 15:59). `missingMinutes` includes every unobserved slot,
including leading/trailing gaps if present. Use `minute`, not array index, for
elapsed market time. `parseSessionCsv(text, session)` exposes the same parsing
for local data; `session` is a validated catalog entry.

For development inspection, serve the site as described in the root README and
run this in the browser console:

```js
const { loadCatalog, loadSession } = await import('/src/data.js');
const sessions = await loadCatalog();
const day = await loadSession(sessions.find(s => s.id === 'SPY-2023-12-26'));
console.table(day.bars);
console.log(day.session, day.missingMinutes);
```

The loader is stateless: it returns the loaded bars and gap diagnostics and has
no cache or background requests. Playback and its debug panel are later milestones.

## Regenerate

Download the full SPY and NVDA Clean 1-minute CSV histories using the HF
[CSV API flow](https://hfdatalibrary.com/pages/api). Authenticate using only the
`HF_API_KEY` environment variable in the `X-API-Key` header; keep keys and signed
download URLs out of files and logs. Store the downloaded **data** outside the
repository, named `SPY_clean.csv` and `NVDA_clean.csv`.

From the repository root, with those files in `/tmp/opencode`, run:

```sh
python3 scripts/bundle-data.py /tmp/opencode
npm test
```

The Python standard-library script slices only the selected sessions, derives
the catalog, and asserts the control selection against all full-length 2023
candidates. The complete source histories are not bundled. Provider revisions
may change these results; investigate changed coverage or rankings before
replacing the snapshot.
