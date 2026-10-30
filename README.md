# Market as Music

A static web page that plays a day of stock-market trading as music. Each minute of
price data becomes one beat: price picks the note, volume sets the loudness, and
volatility adds distortion.

## Overview

Eight bundled HF Clean sessions (seven SPY days and NVDA's DeepSeek day) play
entirely in the browser, with no backend, runtime API, or credentials. The data loader
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

### How the mapping works

| Market feature | Sound / visual |
| --- | --- |
| Close price within the day's close range | 16 C-minor-pentatonic notes from C3 to C6; synchronized price line |
| Minute volume relative to the day's median | Log-scaled lead gain, capped at 0.22 |
| Rolling 5-minute volatility relative to the day's peak | Triangle-to-saw blend, brighter filter, more distortion; blue-to-orange background |
| Positive / negative adjacent-minute return | Major third above / tritone below the lead |
| Absolute one-minute return greater than 3× the day's population σ | Spike bell / drop crash, with green / pink flash |
| Nonzero opening gap from the prior session's last observed close | Opening gong and gold flash |
| Cumulative bar-based VWAP | Low sine drone mapped over C2–C3 |

One exchange minute is one beat at base 120 BPM. Normalization uses the full
historical day; missing minutes remain silent rests. Returns across missing minutes
are excluded from one-minute events. The opening gap is separate from intraday σ.
See [the feature formulas](SPEC.md#feature-calculation-conventions) and
[exact sound mapping](SPEC.md#sound-engine-conventions) for numerical conventions.

The code follows that pipeline: `src/data.js` validates bundled files,
`src/features.js` calculates features, `src/sound.js` maps and synthesizes them,
and `src/playback.js` schedules the audio-clock timeline. `src/main.js` connects
the controls, `src/visuals.js` renders the chart, and `src/debug.js` renders diagnostics.

## Run it

From the repository root, serve the folder with Python 3:

```sh
python3 -m http.server
```

Open `http://localhost:8000`. No build or npm install is needed to run the site.
Use HTTP rather than opening `index.html` as a local file: the app fetches its data.

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

### Manual playback check (Ryan)

Try both SPY and NVDA, pause mid-day, seek while paused
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
hosting import:

1. Import the repository as a static site (Vercel's **Other** framework preset).
2. Leave the build command empty and use the repository root (`.`) as the output
   directory. No install step or environment variables are needed for serving.
3. Serve `index.html`, `src/`, and `data/` together, preserving their relative paths.
   Any static host that serves JavaScript modules and JSON/CSV files can do this.
4. Open the deployed HTTPS URL and perform the
   [manual playback check](#manual-playback-check-ryan), including SPY, NVDA, and
   the debug panel. Confirm data loads and audio starts after pressing Play.

Hosting import and the deployed URL check are still Ryan's and remain pending.

## Add a trading day

1. Obtain the full Clean 1-minute history for the symbol, including the prior
   trading session, using the [data regeneration guide](data/README.md#regenerate).
   This is an offline maintenance step; the running site never uses the HF key.
2. Add the date and display title under the symbol in `SESSIONS` in
   `scripts/bundle-data.py`. For a new symbol, supply its `<SYMBOL>_clean.csv`
   alongside the existing source histories. Use a full-length regular session;
   the playback timeline assumes 390 minute slots.
3. Regenerate from the repository root with
   `python3 scripts/bundle-data.py /tmp/opencode` after placing source histories
   there as described in the guide. The script rewrites the selected CSVs and
   `data/sessions.json`; do not hand-edit those generated files. Keep full source
   histories outside the repository.
4. Review the generated diff, prior close, missing-minute coverage, and the day's
   claimed price story. Update `data/README.md` and the explicit expected catalog,
   coverage, and return values in `test/data.test.js` for the new session.
5. Run `npm test`, then serve the site and select the new day for a manual listen
   and debug-panel check. The picker reads the catalog automatically.

## Known limitations and remaining handoff

- Data is an IEX-only snapshot, not consolidated market volume or official closing
  auction prices. Missing minutes are preserved, including the calm control's
  final seven minutes. See [coverage and provenance](data/README.md#coverage-and-verification).
- This is historical sonification: pitch range, gain reference, volatility peak,
  and event threshold use the entire day, including future bars. VWAP is a
  bar-based approximation. Sounds across days are normalized independently.
- Only the bundled recent sessions are supported; no live feed or licensed minute
  data for the 1987, 2008, or 2010 flash-crash examples is included.
- Automated browser coverage is Chromium only. Audio requires a user gesture;
  delayed/background timers skip expired beats rather than playing a burst later.
  Pause, seek, and speed changes restart the displayed minute.
- **Manual listening is still Ryan's:** automated checks inspect Web Audio state
  and timing, not perceived timbre, musical quality, or speaker/headphone output.
  Ryan also owns hosting import and the deployed URL check described above.

### Ryan's credential and automation cleanup

These owner-side actions are pending; this handoff does not claim they are done.
The static site needs none of these credentials or bot jobs:

- [ ] Revoke the HF Data Library API key used to download the source histories.
- [ ] Revoke the GitHub token used by the bot; it covers both **market-music and
  dotfiles**, so remove its stored copies from both projects' automation/settings.
- [ ] Delete any bot deploy key from the affected repositories' **Settings → Deploy
  keys**, and remove its private-key copy from the bot environment.
- [ ] Remove bot jobs, including scheduled jobs and external bot runners for
  market-music and dotfiles. The repository's `.github/workflows/ci.yml` is the
  normal test workflow and requires no bot token; keep it.

## Data attribution

Data from the HF Data Library (Elkassabgi 2026), https://hfdatalibrary.com, CC BY 4.0.

Data provided for free by IEX. By accessing or using IEX Historical Data, you agree to the [IEX Historical Data Terms of Use](https://www.iex.io/legal/hist-data-terms).
