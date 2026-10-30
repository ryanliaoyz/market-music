# Market as Music

A static web page that plays a day of stock-market trading as music. Each minute of
price data becomes one beat: price picks the note, volume sets the loudness, and
volatility adds distortion. See `SPEC.md` for the full mapping.

## Overview

The static scaffold and eight bundled HF Clean sessions are ready. The data loader
validates OHLCV and exposes missing minutes without filling them. Feature mapping,
audio, playback, and visualization are planned in `TODO.md`.

See [the data guide](data/README.md) for verified session moves, provenance,
regeneration, and loader usage.

## Run it

Serve the folder with any static server, for example `python3 -m http.server`, and
open `http://localhost:8000`.

## Test

`npm test` runs the unit tests with Node's built-in test runner (Node 22+).

## Deploy

Every pull request and push to `main` runs the tests. Hosting is connected separately (Vercel), which redeploys on every push to `main`.

## Data attribution

Data from the HF Data Library (Elkassabgi 2026), https://hfdatalibrary.com, CC BY 4.0.

Data provided for free by IEX. By accessing or using IEX Historical Data, you agree to the [IEX Historical Data Terms of Use](https://www.iex.io/legal/hist-data-terms).
