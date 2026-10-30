# Market as Music

A static page that turns a trading day into music: price sets pitch, volume sets
loudness, and volatility adds distortion.

## Overview

Eight bundled HF Clean sessions (seven SPY days and NVDA's DeepSeek day) play in
the browser without a backend, runtime API, or credentials. A day picker,
play/pause, minute seek, and speed controls drive Web Audio, a synchronized price
line, volatility background, event flashes, and a collapsible debug panel.
Missing minutes remain silent rests, never fabricated bars.

| Market feature | Mapping |
| --- | --- |
| Close within the day's range | 16 C-minor-pentatonic notes, C3–C6; price line |
| Volume relative to the day's median | Log-scaled lead gain, capped at 0.22 |
| Rolling 5-minute volatility relative to the day's peak | Triangle-to-saw blend, brighter filter, distortion; blue-to-orange background |
| Positive / negative adjacent-minute return | Major third above / tritone below the lead |
| Absolute one-minute return > 3× day population σ | Spike bell / drop crash; green / pink flash |
| Nonzero opening gap from the prior session's last observed close | Gong and gold flash |
| Cumulative bar-based VWAP | Low sine drone, C2–C3 |

See [exact formulas and runtime contracts](SPEC.md) and
[session coverage, provenance, and data maintenance](data/README.md).

## Run

From the repository root with Python 3:

```sh
python3 -m http.server
```

Open `http://localhost:8000`. No build or npm install is needed. Use HTTP, not a
local `index.html` file, because the app fetches data.

Choose a day and press **Play** to enable audio. One exchange minute is one beat
at base 120 BPM (1×); the default 1.625× plays 09:30–16:00 New York time in two
minutes. Pause/resume, seek, and speed changes restart the displayed minute.
Changing days stops audio and loads paused; Play after the end replays the day.
The opening gong repeats only when replaying the opening bar.

### Diagnostics

Expand **Debug panel** for the cursor's return, day σ, note/MIDI number, linear
gain, drive, mapping rules, playback state, and waiting reasons. Paused seeks show
labeled previews; rests clear bar values but retain day σ. Rules describe mappings,
not a history of sounds fired. Values do not use an announcing live region.

In the browser console, `window.marketMusic.inspect()` exposes loading/errors,
playback position, scheduling and resume state, transition reasons, and the
engine's last scheduled mapping. Its `visuals` and `debug` entries expose the last
rendered chart state and unrounded panel values. Scheduled audio may be ahead of
the audible cursor; the chart and panel follow the cursor. See
[playback](SPEC.md#playback-conventions), [visual](SPEC.md#visual-conventions), and
[debug contracts](SPEC.md#debug-panel-conventions) for fields and timing.

### Manual playback check (Ryan)

- Try SPY and NVDA: pause mid-day, seek paused and playing, change speeds, and
  switch days during playback. Old audio must stop immediately, Play must resume
  the displayed minute, and the end must stay silent until replayed.
- Listen on speakers/headphones for calm-to-distorted timbre, harmony, drone, and
  event hits; automated checks cannot assess audible quality.
- Watch the chart: missing minutes break the line and hide the price marker,
  backward seeks hide later prices, and day changes clear the old chart. At 0.5×,
  compare event flashes with sounds. Pause must stop flashes; enabling the
  system's reduced-motion setting must hide them.
- With Debug open, seek paused, inspect a rest, replay the opening gong, and switch
  days. Previews must be labeled, rest values cleared, and old values hidden while
  loading.

## Test

With Node 22+ and Python 3, install test dependencies once:

```sh
npm ci
npx playwright install --with-deps chromium
```

Run `npm test` for Node unit tests followed by Playwright in headless Chromium
with real Web Audio and bundled data. Run either suite with `npm run test:unit`
or `npm run test:browser`. The browser runner starts/stops a Python server on
port 4173; keep it free.

Failures save screenshots and traces in `test-results/`; CI uploads that folder
as an artifact retained for seven days. Run `npx playwright show-trace` and choose
the downloaded `trace.zip`. Browser assertions observe state and cursor timing;
use the manual check above for listening.

## Audition the sound engine

Serve the site and run this in its browser console:

```js
const { loadCatalog, loadSession } = await import('./src/data.js');
const { computeFeatures } = await import('./src/features.js');
const { createSoundEngine } = await import('./src/sound.js');
const sessions = await loadCatalog();
const engine = createSoundEngine(computeFeatures(await loadSession(sessions[0])));
const button = document.createElement('button');
button.textContent = 'Audition first 16 bars';
button.onclick = async () => {
  await engine.resume(); // Requires a user gesture.
  engine.stop();
  const start = engine.inspect().currentTime + 0.1;
  for (let i = 0; i < 16; i++) {
    engine.playBar(i, { when: start + i * 0.5, duration: 0.5 });
  }
};
document.body.append(button);
```

Click the button for the opening gong, lead/harmony, and drone. Find event indices
with `engine.score.bars.filter(bar => bar.rules.includes('drop-crash') || bar.rules.includes('spike-bell'))`,
then audition with `engine.playBar(index)`. Compare calm and volatile bars and
check immediate silence after `engine.stop()`. `engine.score` holds mappings;
`engine.inspect()` shows audio state and the last scheduled bar, not the cursor.
Finish with `await engine.dispose(); button.remove();`. See the
[scheduling contract](SPEC.md#sound-engine-conventions).

## Deploy

Every pull request and push to `main` runs both test suites. Ryan's hosting import
and deployed playback check are [pending](TODO.md#m7-browser-tests-and-deploy).

1. Import into Vercel with the **Other** framework preset, an empty build command,
   and output directory `.`. Serving requires no install step or environment variables.
2. Serve `index.html`, `src/`, and `data/` together with relative paths preserved.
   Any static host supporting JavaScript modules and JSON/CSV works.
3. Open the deployed HTTPS URL, confirm data loads and Play enables audio, and run
   the [manual playback check](#manual-playback-check-ryan), including both symbols
   and Debug.

## Known limits

- IEX-only volume and last observed closes are not consolidated market volume or
  official closing-auction prices. Coverage has gaps, including the control's final
  seven minutes; see [verification](data/README.md#coverage-and-verification).
- Historical normalization uses the entire day, including future bars, for pitch,
  gain, volatility peak, and event threshold. Days normalize independently. VWAP
  is a bar-based approximation; opening gaps are separate from intraday σ, and
  returns across missing minutes are excluded from one-minute events.
- Only bundled recent sessions are supported: no live feed or licensed minute
  data for the 1987, 2008, or 2010 flash-crash examples.
- Automated browser coverage is Chromium only. Audio needs a user gesture;
  delayed/background timers skip expired beats rather than playing a burst later.

## Remaining handoff

Ryan owns [manual listening and deployed checks](TODO.md#m7-browser-tests-and-deploy)
and [credential/bot cleanup](TODO.md#m8-handoff). The static site needs none of
those credentials or bot jobs. Keep `.github/workflows/ci.yml`: it is the normal
test workflow and requires no bot token.

## Data attribution

Data from the HF Data Library (Elkassabgi 2026), https://hfdatalibrary.com, CC BY 4.0.

Data provided for free by IEX. By accessing or using IEX Historical Data, you agree to the [IEX Historical Data Terms of Use](https://www.iex.io/legal/hist-data-terms).
