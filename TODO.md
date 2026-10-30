# Market as Music — milestones (one PR each)

## Version 1

### M0: Repo scaffold
- [x] The static site, test runner, GitHub Actions tests, and data attribution are available.

### M1: Data
- [x] The selected SPY Clean 1-minute sessions and NVDA 2025-01-27 load from bundled data, preserve missing minutes, match their stories, and pass loader tests with `npm test`.

### M2: Features
- [ ] Per-bar return, rolling 5-minute volatility, 3σ events, and VWAP match a fixture day in unit tests.

### M3: Sound engine
- [ ] Web Audio plays pentatonic pitches, volume gain, volatility-driven filter/distortion, drone, and event hits.

### M4: Playback
- [ ] A day picker, play/pause/seek, and speed control operate on a selected session.

### M5: Visuals
- [ ] A price line, volatility background, and event flashes stay synchronized with playback.

### M6: Debug panel
- [ ] The live bar, return, σ, note, gain, drive, and fired rule are inspectable.

### M7: Browser tests and deploy
- [ ] Browser tests verify playback and the debug panel, and the hosting deployment is checked.

### M8: Handoff
- [ ] The README explains how it works and how to add a day, attribution is present, and bot tokens/jobs are removed.

## Later
