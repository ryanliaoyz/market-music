# Market as Music

A static web page that plays a day of stock-market trading as music. Each minute of
price data becomes one beat: price picks the note, volume sets the loudness, and
volatility adds distortion. See `SPEC.md` for the full mapping.

## Overview

The static scaffold and eight bundled HF Clean sessions are ready. The data loader
validates OHLCV and exposes missing minutes without filling them. The pure feature
calculator provides per-minute returns, rolling volatility, signed 3σ events, and
cumulative VWAP. The Web Audio engine maps those features to notes, harmony,
volume, timbre, a VWAP drone, and synthesized event hits. Playback controls and
visualization are planned in `TODO.md`.

See [the data guide](data/README.md) for verified session moves, provenance,
regeneration, and loader usage.

For features, pass the loader result to `computeFeatures` from `src/features.js`.
Inspect the returned `bars`, `sigma`, `eventThreshold`, and coverage counts in the
browser development console. See [the feature conventions](SPEC.md#feature-calculation-conventions)
for formulas, missing-data handling, and the separate opening gap.

## Run it

Serve the folder with any static server, for example `python3 -m http.server`, and
open `http://localhost:8000`.

## Test

`npm test` runs the unit tests with Node's built-in test runner (Node 22+).

## Audition the sound engine

Serve and open the site, then run this in the browser development console:

```js
const { loadCatalog, loadSession } = await import('./src/data.js');
const { computeFeatures } = await import('./src/features.js');
const { createSoundEngine } = await import('./src/sound.js');
const sessions = await loadCatalog();
const features = computeFeatures(await loadSession(sessions[0]));
const engine = createSoundEngine(features);
const button = document.createElement('button');
button.textContent = 'Audition first 16 bars';
button.onclick = async () => {
  await engine.resume(); // Audio must start from a user gesture.
  engine.stop();
  // Use one audio-clock origin; timers are not needed for this short audition.
  const start = engine.inspect().currentTime + 0.1;
  for (let i = 0; i < 16; i++) {
    engine.playBar(i, { when: start + i * 0.5, duration: 0.5 });
  }
};
document.body.append(button);
```

Click the button to hear the opening gong, lead/harmony, and drone. Use
`engine.score.bars.filter(bar => bar.rules.includes('drop-crash') || bar.rules.includes('spike-bell'))`
to find event indices and `engine.playBar(index)` to audition them. Inspect
`engine.score` for the whole mapping and `engine.inspect()` for audio state,
resume waiting, voice count, and the last **scheduled** bar (not a playback cursor).
`engine.stop()` cancels all queued sounds; `await engine.dispose()` releases the
engine and its audio context. Remove the audition button after disposing.

See [sound conventions](SPEC.md#sound-engine-conventions) for mapping choices and
the scheduling contract. Audition calm and volatile bars to check the clean-to-saw
transition, event sounds, and silence immediately after stopping.

## Deploy

Every pull request and push to `main` runs the tests. Hosting is connected separately (Vercel), which redeploys on every push to `main`.

## Data attribution

Data from the HF Data Library (Elkassabgi 2026), https://hfdatalibrary.com, CC BY 4.0.

Data provided for free by IEX. By accessing or using IEX Historical Data, you agree to the [IEX Historical Data Terms of Use](https://www.iex.io/legal/hist-data-terms).
