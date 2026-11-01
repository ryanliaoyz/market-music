# Market as Music

A static page that turns historical trading days and live crypto prices into music.
Price sets pitch and volatility adds distortion; historical volume sets loudness.

## Overview

Live playback uses the small open stand-in in `src/composer.js`. It preserves the public musical mapping and exposes composer state in Debug. The real M3 composer runs only locally and in tests in the private `market-music-core` repo; no private code or build artifact is deployed here. Server execution is planned for v4. See [the composer boundary](SPEC.md#composer-boundary).

Eight bundled HF Clean sessions (seven SPY days and NVDA's DeepSeek day) play in
the browser without a backend or credentials. A full-screen dark visual follows
price and volatility, with one large Start/Stop button and four selectable sound
cards. Historical playback also offers a day picker, minute seek and speed controls.
Missing minutes remain silent rests, never fabricated bars. Controls stack on phones,
with large touch targets and visible keyboard focus. **Debug panel** opens diagnostics;
**Sources & credits** opens data attribution.

**Live crypto** streams BTC-USD directly from Coinbase's keyless public WebSocket.
Start subscribes and buffers five seconds, then plays 500 ms musical frames on a
timeline five seconds behind browser receipt time. A rolling 60-second chart follows
that delayed timeline. Stop unsubscribes and silences audio; network drops reconnect
and refill the buffer. The site remains entirely static on Vercel.
Live intervals can be recorded in memory, downloaded as synthesized WAV, or shared
as a self-contained replay link; recordings are never uploaded or persisted by the app.
The [installable mobile shell](#mobile-and-offline-use) supports offline shared
replay and foreground-only playback with explicit tap-to-resume behavior.

Tone sounds use a fixed instrument rack, built on Start and disposed on Stop,
with capped voices, dotted-eighth delay and generated reverb. Live kicks gently
duck the pad at energy 2 and above. Rack readiness, voice usage and the last
ducking decision appear in the **Debug panel** audio JSON.

| Historical market feature | Mapping |
| --- | --- |
| Close within the day's range | 16 C-minor-pentatonic notes, C3–C6; price line |
| Volume relative to the day's median | Log-scaled lead gain, capped at 0.22 |
| Rolling 5-minute volatility relative to the day's peak | Triangle-to-saw blend, brighter filter, distortion; teal-to-warm ambient glow |
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

Choose a day and press **Start** to enable audio. One exchange minute is one beat
at base 120 BPM (1×); the default 1.625× plays 09:30–16:00 New York time in two
minutes. Historical **Stop** pauses at the displayed minute; **Start** resumes it.
Resume, seek, and speed changes restart the displayed minute.
Changing days stops audio and loads paused; Start after the end replays the day.
The opening gong repeats only when replaying the opening bar.

The **Choose your sound** cards are available before and during playback in both modes.
Tap a card or use the arrow keys within the radio group. In historical mode, Classic
keeps the original sound; Ambient uses a soft sine voice, Plucky a short triangle
voice and major-pentatonic scale, and Bass-heavy a saw voice one octave lower.
The others use minor pentatonic. Historical harmony retains the signed major-third/tritone
mapping. Live uses the musical presets described below. Historical changes restart the displayed minute; live changes affect
the next audible frame, including audio already queued ahead, without refilling
the five-second buffer. The current frame and its release tail finish unchanged.
Selection persists across days and modes for the page session.

Tone.js 15.1.22 is served locally, with no build or runtime CDN dependency:
345,500 bytes raw, about 80 KB gzip. See [vendor provenance and license](vendor/README.md).
All sounds are synthesized; no sample assets are used.

**Volume** controls listening in every mode, from mute to unity gain, and stays selected
until the page reloads. It does not change recording data or WAV export volume.
All audio passes through a shared compressor, approximately 14 kHz lowpass and
−1 dBFS sample-peak ceiling before the volume control.

### Live crypto

Select **Live crypto · BTC-USD**, then **Start**. The connection opens only on Start;
audio starts after the first price and a five-second **Buffering** period. The
stream remains connected throughout playback, including quiet intervals. **Stop**
is the only unsubscribe control and clears buffered audio/data. Stop before changing
modes or restarting after an error; live mode has no pause, seek, or speed control.

Price changes move the melody by scale degrees in C natural minor. Changes are
normalized against the recent 20-second return range, so small BTC moves are audible;
flat prices hold the note. Smoothed trend selects in-key chord progressions, changing
chords every four seconds. Actual Coinbase `market_trades` activity controls note
density and size-relative accents; ticker's 24-hour volume is never treated as size.

The four versioned live presets differ musically: **Classic** pulses with chord stabs,
**Ambient** uses sparse sustained chords, **Plucky** plays short arpeggios, and
**Bass-heavy** combines a low ostinato with offbeat chords. Base gain is 0.11 with
bounded trade accents; there is no VWAP drone or opening gong. Live uses the ticker's
bid/ask mid and carries the last mid through quiet beats. Every received quote
contributes to beat statistics; trades retain exchange-time sixteenth placement.
Frames finalize as they enter the scheduler, accepting delayed trade batches until
then without changing the five-second deadline. Debug exposes bounded signal
controls, their smoothing/latches, quote age and late-trade counts alongside the
current musical mapping. See the [live contracts](SPEC.md#live-crypto-contracts).

Kraken's public v2 ticker is a documented contingency if Coinbase is inaccessible
in a target browser/region; no Kraken adapter or automatic provider switch ships.

### Recording and sharing

During delayed live playback, press **Record**. Capture starts with the next
scheduled audible frame, then retains timing, silent gaps, prices, and each frame's
audible preset. **Stop recording** seals the clip while live playback continues.
Clips stop automatically after 30 seconds; live Stop, a connection interruption,
or audio suspension also seals the clip. An empty capture produces no download.

**Download WAV** renders the clip locally with OfflineAudioContext as mono 44.1 kHz
16-bit PCM, cut at the clip endpoint. **Copy link** displays a selectable URL and
copies it when clipboard access is available. Its versioned hash contains the
recording. Opening a link loads a paused replay; press **Start** to
hear it. Deployed Live clips use `#recording=v2.` (30 seconds, 4 KiB) to retain resolved chords, rhythm and accents;
existing `#recording=v1.` links keep their original sound. Captured presets are fixed
during replay. Replay needs no exchange access. Shared links show **shared clip · unverified**:
their prices are supplied by the link, not verified Coinbase history. Valid v1/v2
encoder output remains supported; crafted notes outside those mappings are rejected.
Reloading loses an unshared live recording; save the WAV or link first.

`#recording=v3.` links carry resolved musical events, including drums, rather than
re-running a composer. They support up to two minutes and 64 KiB, using the public
versioned sound rack for both replay and WAV. Their chart shows unverified percent
change from clip start, with no dollar prices. Capture begins at the next scheduled
beat and excludes earlier notes/reverb already sounding; event equivalence preserves
the score rather than promising identical noise/reverb samples. The deployed Live
mode remains v2 until a resolved event source is connected; no private composer is
loaded into the browser. See the [event-score contract](SPEC.md#event-score-replay-v3-gro-42).

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

In live mode Debug separates the newest received price from the delayed mapping.
Recording diagnostics show state, frame/pending counts, duration, encoded size,
export activity, and replay progress through the panel and `window.marketMusic.inspect()`.
Audio diagnostics include master volume, lowpass and peak-ceiling configuration.
Live errors use fixed retry instructions; provider error text is retained only in Debug
and the console inspection surface.
It also distinguishes the selected preset from the audible frame's captured preset,
with scale, register, oscillator, filter cutoff and distortion diagnostics.
It exposes connection/error/retry state, tick/heartbeat ages, buffer duration, queue
size, segment ID, delayed cursor, and normalization references. The same values are
available through `window.marketMusic.inspect()`; buffering never previews future
prices on the main chart.

### Manual playback check (Ryan)

- On iOS Safari and Android Chrome, check portrait/landscape controls, first-tap
  sound, lock/unlock, and switching apps during playback and recording. Returning
  must stay silent until Start; Live must refill its five-second buffer.
- Install from the browser's home-screen/install menu on HTTPS. After one online
  visit and closing/reopening the app, try an offline launch and shared recording
  link. Verify safe-area spacing and first-tap sound in standalone mode too.
- Try SPY and NVDA: pause mid-day, seek paused and playing, change speeds, and
  switch days during playback. Old audio must stop immediately, Start must resume
  the displayed minute, and the end must stay silent until replayed.
- Listen on speakers/headphones for calm-to-distorted timbre, harmony, drone, and
  event hits; automated checks cannot assess audible quality.
- Adjust Volume during historical, Live and shared replay, including mute, and listen
  for clicks or harsh limiting. Download a WAV while muted: it should still contain
  the clip at the fixed export level. Reload to restore full listening volume.
- Select each sound preset before Start and during playback. Check historical
  minute restart, live next-frame switching without new buffering, and Debug's
  selected versus audible preset. Stop must silence all voices and tails.
- Watch the chart: missing minutes break the line and hide the price marker,
  backward seeks hide later prices, and day changes clear the old chart. At 0.5×,
  compare event flashes with sounds. Stop must stop flashes; enabling the
  system's reduced-motion setting must hide them.
- With Debug open, seek paused, inspect a rest, replay the opening gong, and switch
  days. Previews must be labeled, rest values cleared, and old values hidden while
  loading.
- Try Live on the deployed HTTPS URL: Start, observe five seconds of buffering,
  then listen and compare the delayed chart with Debug. Stop during buffering and
  playback; verify immediate silence, mode switching, and a fresh buffer on Start.
- Audition quiet and busy Live periods across all four presets: small price changes
  should move the melody in-key, chords should follow a slower progression, and
  busy/larger trades should increase rhythmic activity/accents. Compare the distinct
  pulse, pad, arpeggio and bass textures rather than just oscillator tone.
- Temporarily interrupt the network: audio must stop, reconnect visibly, and refill
   five seconds from the first fresh price. Backgrounding stops Live; return and
   tap Start to reconnect without a catch-up burst. Check Coinbase reachability and audible quality on
  speakers/headphones; these require a real feed/browser check.
- Record while switching presets, stop capture, download WAV, and open the copied
  link in a fresh tab. Compare replay/WAV sound and timing, including rests and the
  endpoint. Check the 30-second automatic cap and recording interruption on Stop.

## Test

With Node 22+ and Python 3, install test dependencies once:

```sh
npm ci
npx playwright install --with-deps chromium
```

Run `npm test` for Node unit tests followed by Playwright in headless Chromium
with real Web Audio, bundled data, and a mocked live WebSocket. Tests never require
the exchange or credentials. Run either suite with `npm run test:unit`
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
  engine.stop();
  await engine.resume(); // Requires a user gesture; prepares the Tone rack.
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

Production is [market-music.vercel.app](https://market-music.vercel.app).
Vercel's Git integration creates previews and automatically deploys `main` to
production; there is no manual deploy step. GitHub CI runs both test suites on
pull requests and pushes to `main`. Check CI and Vercel separately; a successful
deployment alone does not establish that tests passed.

The site is static: **Other** framework preset, empty build command, output
directory `.`, no install step or environment variables required. Preserve relative
paths for `index.html`, `src/`, `data/`, `vendor/`, `manifest.webmanifest`, `icons/`,
and root `sw.js`. Serve `sw.js` with revalidation rather than immutable caching.
Live traffic goes directly to `wss://advanced-trade-ws.coinbase.com`; no Vercel
functions, API keys, or proxy are needed.

The early meta CSP in `index.html` permits only the local shell, Tone's blob workers
and Coinbase's WebSocket. `vercel.json` adds framing protection, MIME sniffing and
referrer restrictions, permissions policy, same-origin opener isolation and entry/worker
revalidation. The local Python server enforces the meta CSP but does not apply Vercel headers.

### Post-deploy checklist

On the production HTTPS URL, after confirming Vercel deployed the intended `main`
commit and its CI passed:

- Verify modules, historical data, `manifest.webmanifest`, and its icons load.
  Confirm the manifest's start URL/scope cover the app and display is standalone.
- Inspect HTTPS response headers against `vercel.json`, and confirm embedding the
  page in another site's iframe is blocked. Check the browser console for CSP errors
  while using Tone presets, Live, replay and WAV download.
- In browser developer tools, confirm the root service worker registers without
  errors and caches only the shell. Check `sw.js` revalidation and, when an update
  is waiting, close all app tabs/windows and reopen to use the new version.
- Run the [manual playback check](#manual-playback-check-ryan): historical SPY/NVDA,
  presets, real Coinbase Start/Stop and reconnect, and audible quality.
- Record while changing presets, download and listen to the WAV, and open the copied
  link in a fresh tab. Start must replay the captured clip without a live connection.
- On iOS Safari and Android Chrome, check installation, first-tap audio,
  background/lock recovery, and offline shell/shared replay after an online visit.
  Historical data and Live still require connectivity.

Keep the [release acceptance items](TODO.md#m5-v2-release-gro-30) open until checked
on production; Chromium tests with a mocked feed do not replace these checks.

## Mobile and offline use

To install from [production](https://market-music.vercel.app):

- **iOS Safari:** open **Share → Add to Home Screen → Add**.
- **Android Chrome:** open the browser menu, choose **Install app** or
  **Add to Home screen** (wording varies), and confirm.

Open the home-screen icon once online to cache the shell before trying offline use.

Playback is foreground-only. Hiding the page pauses historical playback at its
current minute and stops live/shared replay, finishing any active recording.
Returning requires Start; shared replay restarts from the beginning. Browser
audio interruptions also require a fresh tap. No background audio or feed is promised.

On HTTPS or localhost, a service worker caches only the static application shell.
Historical data and Live require a connection; self-contained shared recording
links can replay offline after the shell is installed. Audio/recordings/exports
are never cached. See [runtime contracts](SPEC.md#mobile-and-shell-cache-contracts).
Updates wait until existing tabs close; close all app tabs/windows and reopen to
use a waiting version. Debug and `window.marketMusic.inspect().lifecycle` show
visibility, interruption reason, and worker registration/update errors.

Icon artwork is generated with `python3 scripts/generate-icons.py`. When changing
shell assets, bump the cache version in `sw.js` and keep its explicit list complete.

## Known limits

- IEX-only volume and last observed closes are not consolidated market volume or
  official closing-auction prices. Coverage has gaps, including the control's final
  seven minutes; see [verification](data/README.md#coverage-and-verification).
- Historical normalization uses the entire day, including future bars, for pitch,
  gain, volatility peak, and event threshold. Days normalize independently. VWAP
  is a bar-based approximation; opening gaps are separate from intraday σ, and
  returns across missing minutes are excluded from one-minute events.
- Historical playback supports bundled recent sessions, not licensed minute data
  for the 1987, 2008, or 2010 flash-crash examples.
- Live prices are sampled ticker updates, not a complete trade history. They use
  browser receipt timing with a fixed five-second delay on a 500 ms frame grid;
  network/exchange latency is additional. No historical backfill is requested.
  Empty live intervals carry the last mid; geographic/network restrictions can make
  Coinbase unavailable. Trades arriving after frame finalization are counted and
  excluded. Recordings retain audible frames, not a raw trade history.
- Automated browser coverage is Chromium only. Audio needs a user gesture;
  delayed/background timers skip expired beats rather than playing a burst later.

## Remaining handoff

Ryan owns [manual listening and deployed checks](TODO.md#m7-browser-tests-and-deploy)
and [v2 release acceptance](TODO.md#m5-v2-release-gro-30), plus
[credential/bot cleanup](TODO.md#m8-handoff). The static site needs none of
those credentials or bot jobs. Keep `.github/workflows/ci.yml`: it is the normal
test workflow and requires no bot token.

## Data attribution

Data from the HF Data Library (Elkassabgi 2026), https://hfdatalibrary.com, CC BY 4.0.

Data provided for free by IEX. By accessing or using IEX Historical Data, you agree to the [IEX Historical Data Terms of Use](https://www.iex.io/legal/hist-data-terms).
