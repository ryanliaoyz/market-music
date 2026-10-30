# Market as Music

A static web page that plays a day of stock-market trading as music. Each minute of
price data becomes one beat: price picks the note, volume sets the loudness, and
volatility adds distortion. See `SPEC.md` for the full mapping.

## Overview

The static scaffold and eight bundled HF Clean sessions are ready. The data loader
validates OHLCV and exposes missing minutes without filling them. The pure feature
calculator provides per-minute returns, rolling volatility, signed 3σ events, and
cumulative VWAP. The Web Audio engine maps those features to notes, harmony,
volume, timbre, a VWAP drone, and synthesized event hits. The day picker, play/pause,
minute seek, and speed controls play any bundled session. A synchronized price line,
volatility-colored background, and event flashes follow the audible cursor.
The collapsible debug panel shows the current bar's return, day σ, note, gain,
distortion drive, and mapping rules alongside playback state and waiting reasons.

See [the data guide](data/README.md) for verified session moves, provenance,
regeneration, and loader usage.

For features, pass the loader result to `computeFeatures` from `src/features.js`.
Inspect the returned `bars`, `sigma`, `eventThreshold`, and coverage counts in the
browser development console. See [the feature conventions](SPEC.md#feature-calculation-conventions)
for formulas, missing-data handling, and the separate opening gap.

## Run it

Serve the folder with any static server, for example `python3 -m http.server`, and
open `http://localhost:8000`.

Choose a trading day and press Play to enable audio. The default 1.625× speed plays
the full 09:30–16:00 New York session in two minutes; 1× is 120 BPM. Missing minutes
are silent rests. Pause/resume, seek, and speed changes restart the current minute;
changing days stops audio and loads the new day paused. Play after the end replays
the day. The opening gong repeats only when replaying the opening bar.

The chart reveals close prices across the full session, leaving breaks at missing
minutes. Its background runs from cool blue (calm) to warm orange (the day's peak
rolling volatility). Drops flash pink, spikes green, and the opening gong gold.
Flashes stop on pause and are hidden when your system requests reduced motion.

Expand **Debug panel** to inspect the cursor's mapping, including paused seek
previews. Returns and day σ are percentages; notes include MIDI numbers, gain is
linear, and drive runs from 0 to 24. Missing minutes show a rest with unavailable
bar values; day σ remains visible. Rules describe the current bar's mappings, not
a history of sounds fired. The panel updates without an announcing live region.

In the development console, `window.marketMusic.inspect()` exposes session loading
and errors, playback state, audible minute/bar index (null during a missing minute),
speed, next scheduling minute, last transition reason, audio-resume waiting, and
the engine's last scheduled mapping. Its `visuals` entry exposes the last rendered
position, close, volatility intensity, event, flash strength, and transition/waiting
reason. Its `debug` entry exposes the panel's unrounded values. The scheduled bar
may be ahead of the cursor; the panel uses the cursor instead.
See [playback conventions](SPEC.md#playback-conventions) for timing details.

For a manual playback check, try both SPY and NVDA, pause mid-day, seek while paused
and playing, change speeds, and switch days during playback. Check that old audio
stops immediately, Play resumes the displayed minute, and the end stays silent
until replayed. Listen with speakers/headphones to check timbre and event hits.
Watch the chart through these controls: the price marker should disappear in
missing minutes, seeking backward should hide later prices, and switching days
should clear the old chart. Check flashes against event sounds at 0.5× speed,
then enable your system's reduced-motion setting and check that flashes disappear.
With the debug panel open, seek while paused, check a missing minute, replay the
opening gong, and switch days. Check that previews are labeled, rest values clear,
and old session values disappear during loading.

## Test

With Node 22+ and Python 3 installed, set up the test dependencies once:

```sh
npm ci
npx playwright install --with-deps chromium
```

`npm test` runs the Node unit tests followed by the Playwright browser tests in
headless Chromium with real Web Audio and bundled data. The browser runner starts
and stops a local Python static server on port 4173; keep that port free.
Use `npm run test:unit` or `npm run test:browser` to run either suite alone.
Browser failures save screenshots and traces in `test-results/`; CI uploads that
folder as an artifact. Open a downloaded trace with `npx playwright show-trace`
and choose its `trace.zip` file. Browser checks observe audio state and the cursor;
use the manual playback check above to assess audible quality.

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

Every pull request and push to `main` runs both test suites. Ryan handles the Vercel
hosting import separately: serve this repository as a static site with no build
command and the repository root as the output directory. After import, check the
deployed URL using the manual playback check above, including both SPY and NVDA
and the debug panel. Hosting import and deployed playback verification are pending.

## Data attribution

Data from the HF Data Library (Elkassabgi 2026), https://hfdatalibrary.com, CC BY 4.0.

Data provided for free by IEX. By accessing or using IEX Historical Data, you agree to the [IEX Historical Data Terms of Use](https://www.iex.io/legal/hist-data-terms).
