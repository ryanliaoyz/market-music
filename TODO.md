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

## Later
