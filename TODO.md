# Planned work

## Version 1

### M7: Browser tests and deploy

- [ ] Ryan verifies audible quality on speakers/headphones with the [manual playback check](README.md#manual-playback-check-ryan).
- [ ] Ryan verifies playback on the production HTTPS URL using the [deployment guide](README.md#deploy).

### M8: Handoff

- [ ] Ryan revokes the HF Data Library API key used to download source histories.
- [ ] Ryan revokes the bot's GitHub token, which covers **market-music and dotfiles**, and removes stored copies from both projects' automation/settings.
- [ ] Ryan deletes bot deploy keys from affected repositories' **Settings → Deploy keys** and removes private-key copies from the bot environment.
- [ ] Ryan removes bot jobs, including scheduled jobs and external runners for market-music and dotfiles, while keeping the normal `.github/workflows/ci.yml` test workflow.

## Version 2

### M1: Delayed live crypto (GRO-25)

- [x] Live BTC-USD connects only on Start, buffers five seconds, and plays a rolling delayed price timeline with fixed gain.
- [x] Stop unsubscribes and silences playback; network drops reconnect and refill without replaying stale data.
- [x] Debug exposes feed/buffer/mapping state, and tick/frame callbacks support future capture.
- [x] Historical playback and mocked live tests pass without exchange access, credentials, or a backend.
- [ ] Ryan verifies Coinbase reachability, audible quality, and reconnect behavior on deployed HTTPS using the [manual playback check](README.md#manual-playback-check-ryan).

### M2: Tone.js presets (GRO-26)

- [x] Listeners can select Tone.js sound presets before or during historical/live playback; live switches use the next audible frame without changing the delayed timeline, and schedule-time capture retains its preset ID.

### M3: Recording and replay (GRO-27)

- [x] Listeners can record a live session and download its audio as WAV.
- [x] A share link replays the recorded prices with their captured timing.

### M4: Mobile and light PWA (GRO-28)

- [x] Touch controls fit narrow and landscape screens with safe-area spacing and first-tap audio.
- [x] Backgrounding silences playback and disconnects Live; returning requires a tap without stale playback.
- [x] The installable app opens its shell and shared recordings offline without caching market data.
- [ ] Ryan verifies first-tap audio, background/lock recovery and installed/offline use on iOS Safari and Android Chrome using the [manual playback check](README.md#manual-playback-check-ryan).

### M5: v2 release (GRO-30)

- [x] The production URL and automatic `main` → Vercel deployment path are confirmed in the [deployment guide](README.md#deploy).
- [x] README usage covers live mode, presets, recording, share replay, WAV download, and home-screen installation; SPEC clarifies the runtime boundary and [v2 release notes](CHANGELOG.md) describe the shipped features and limits.
- [ ] Production passes the [post-deploy checklist](README.md#post-deploy-checklist), including the outstanding M1 live and M4 mobile checks; v2 release notes are dated when acceptance is complete.

## Version 2.1

### M1: Musical live mode (GRO-34)

- [x] Live BTC price changes play scale-degree melodies and in-key trend-driven chords, with actual trade-rate/size rhythms and four distinct versioned presets on the five-second delayed timeline.
- [x] New recordings preserve musical patterns in shared replay and WAV, while v1 links, 30-second clips and the 4 KiB limit remain supported.
- [ ] Ryan auditions quiet/busy Live periods across all four presets on deployed HTTPS and compares the sound with shared replay and WAV.

### M2: Immersive UI (GRO-33)

- [x] Listeners can use the full-screen reactive visual, one Start/Stop control and keyboard-accessible preset cards on desktop and mobile, with Debug collapsed by default.
- [x] Desktop and mobile screenshots demonstrate the layout, and the existing playback, recording and offline checks pass.

## Version 3

### M1: Signal layer (GRO-39)

- [x] Live emits continuous mid/spread beats and exchange-timed sixteenth trade aggregates with maker-side inversion, finalized at scheduling time on the unchanged five-second delayed grid.
- [x] Debug exposes bounded energy, contour, tension, mood, flow, hits and events, their smoothing/hysteresis state, quote age and late-trade counts.
- [x] Offline fixture tapes produce no data rests, seeded fuzz keeps controls in range, and unit/browser regressions pass without exchange access.

### M2: Sound rack (GRO-40)

- [x] Start prepares a fixed, capped pad/lead/arp/bass and synthesized drum rack; Stop disposes it and restart remains playable.
- [x] Controls ramp smoothly, dotted-eighth delay follows tempo, generated reverb needs no samples, and kicks duck the pad at energy 2 and above on the existing master bus and scheduler.
- [x] Unit and real-Tone browser checks prove frames, preset changes and idle/retrigger allocate no new Tone nodes; playback/replay/WAV regressions pass.
- [ ] Ryan measures CPU and listens for glitches on an older phone before adding another layer.

### M4: Event-score replay v3 (GRO-42)

- [x] Versioned public event scores round-trip in v3 links up to two minutes and 64 KiB without prices, controls or private composer state.
- [x] The public rack plays every event part, five-note pads and resolved drums/ducking with fixed voice bounds and inspectable diagnostics.
- [x] Next-beat event-source capture preserves queued replacements, cancellations, silent beats and partial endpoints without pre-capture tails.
- [x] Shared v3 replay and WAV schedule the same score offline without a composer; v1/v2 links and deployed Live remain compatible.
- [x] Golden, malformed-input, scheduling and real-browser offline/audio checks pass with the documented public/private boundary.

## Later
