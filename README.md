# Market as Music

A static web page that plays a day of stock-market trading as music. Each minute of
price data becomes one beat: price picks the note, volume sets the loudness, and
volatility adds distortion. See `SPEC.md` for the full mapping.

## Run it

Serve the folder with any static server, for example `python3 -m http.server`, and
open `http://localhost:8000`.

## Test

`npm test` runs the unit tests with Node's built-in test runner (Node 22+).

## Deploy

Every push to `main` runs the tests and deploys the site to GitHub Pages.

## Data attribution

Price data comes from [HF Data Library](https://hfdatalibrary.com), licensed under
CC BY 4.0, with prices sourced from IEX.
