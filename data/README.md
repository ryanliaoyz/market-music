# Data guide

Eight CSVs slice HF Data Library's **Clean, 1-minute** SPY and NVDA histories,
downloaded on 2026-10-29. Volume is IEX-only; prices have no further adjustment.
The CC BY 4.0 license permits redistribution and commercial use. Retain the
[HF and IEX attribution](../README.md#data-attribution) in the README and app footer.

## Source choices

- [HF Data Library](https://hfdatalibrary.com) offers CSV/Parquet minute OHLCV for
  1,253 US stocks/ETFs, including SPY/QQQ, from 2022-03-07 onward. As of 2026-10-29,
  downloads require a free Google/ORCID account and API key; the app uses neither.
- An unimplemented, account-free alternative is the
  [IEX HIST feed](https://iextrading.com/api/1.0/hist?date=YYYYMMDD): daily TOPS
  pcap.gz files (~6.7 GB each). It would require a one-time trade-to-minute-bar
  converter and deletion of raw files afterward; the same IEX attribution applies.
- FRED's S&P 500 series prohibits reproduction without permission; Stooq's
  redistribution terms were unclear; paid APIs require keys. No licensed free
  minute data was available for the 1987/2008/2010 flash-crash examples.

## Coverage and verification

Only observed bars are included, in source order, from 09:30 inclusive to 16:00
exclusive, America/New_York wall time (no UTC suffix). No synthetic bars,
zero-volume placeholders, interpolation, or forward-fill. All days have opening
bars; the control ends at 15:52, event days at 15:59. Columns are lowercased and
the timestamp separator is `T`; numeric text is unchanged.

`data/sessions.json` holds labels, counts, verification metrics, and prior-session
dates/last observed IEX closes—the only retained context from unbundled sessions.
Its returns are ratios minus one, not percentages or official closing-auction returns.

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

CPI day falls further after its gap. August 5 (global selloff/yen carry-trade
unwind) and SPY's DeepSeek day recover intraday but stay below prior closes; NVDA
falls harder. Tariff losses precede April 9's tariff-pause rally. These price
stories do not establish news causation or independently measure the VIX spike.

The control has the lowest volatility among **248 full-length 2023 sessions**
(250 total minus July 3 and November 24 early closes). Rank by
`sqrt(sum(log(close[i] / close[i-1])²))` over adjacent observed bars, excluding the
overnight gap, without annualizing or filling missing minutes. December 26 is
0.2633%; November 24, the excluded absolute minimum, is 0.2238% before its 13:00
close. This observed-bar measure is not corrected for missing trades; selection
favors equal scheduled length. Unlike runtime one-minute returns, this ranking
includes moves between adjacent observed bars even across missing minutes.

## Loader and inspection

`src/data.js`: `loadCatalog()` fetches/validates the catalog; pass an entry to
`loadSession(session)`.
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

The loader has no state, cache, or background requests. For playback diagnostics,
see [the README](../README.md#diagnostics).

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

The Python standard-library script slices selected sessions, derives the catalog,
and asserts the control selection against full-length 2023 candidates. Do not
hand-edit generated CSVs/catalog or bundle full histories. Investigate changed
coverage/rankings from provider revisions before replacing the snapshot.

## Add a trading day

1. Obtain the symbol's full Clean minute history, including the prior session,
   using the regeneration flow above. Keep histories outside the repository.
2. Add the date/title to `SESSIONS` in `scripts/bundle-data.py`; for a new symbol,
   supply `<SYMBOL>_clean.csv` beside the other histories. Choose a full-length
   regular session: playback assumes 390 slots.
3. Regenerate, review the CSV/catalog diff, prior close, missing-minute coverage,
   and claimed price story. Update this guide and the expected catalog, coverage,
   and return values in `test/data.test.js`.
4. Run `npm test`, then serve the site for a manual listen and debug-panel check.
   The picker reads the catalog automatically.
