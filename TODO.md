# Market as Music — milestones (one PR each)

## Version 1

### M0: Repo scaffold
- [x] The static site, test runner, GitHub Actions tests, and data attribution are available.

### M1: Data
- [x] The selected SPY Clean 1-minute sessions and NVDA 2025-01-27 load from bundled data, preserve missing minutes, match their stories, and pass loader tests with `npm test`.

### M2: Features
- [x] Per-bar return, rolling 5-minute volatility, 3σ events, and VWAP match a fixture day in unit tests.

### M3: Sound engine
- [x] Web Audio plays pentatonic pitches, volume gain, volatility-driven filter/distortion, drone, and event hits.

### M4: Playback
- [x] A day picker, play/pause/seek, and speed control operate on a selected session.

### M5: Visuals
- [x] A price line, volatility background, and event flashes stay synchronized with playback.

### M6: Debug panel
- [x] The live bar, return, σ, note, gain, drive, and fired rule are inspectable.

### M7: Browser tests and deploy
- [x] Browser tests verify playback and the debug panel with `npm test`, including in CI.
- [ ] Ryan imports the site into hosting and verifies playback on the deployed URL.

### M8: Handoff
- [x] The README explains running, testing, static deployment, the mapping, adding a day, attribution, and limitations, with Ryan's remaining checks and cleanup listed (GRO-13).
- [ ] Ryan completes the credential and bot cleanup in the README's handoff checklist.

## Later
