# Planned work

## Version 1

### M7: Browser tests and deploy

- [ ] Ryan verifies audible quality on speakers/headphones with the [manual playback check](README.md#manual-playback-check-ryan).
- [ ] Ryan imports the site into hosting and verifies playback on the deployed HTTPS URL using the [deployment guide](README.md#deploy).

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

- [ ] Listeners can record a live session and download its audio as WAV.
- [ ] A share link replays the recorded prices with their captured timing.

## Later
