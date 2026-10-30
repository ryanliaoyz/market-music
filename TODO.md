# Market as Music — milestones (one PR each)

- [x] M0: Repo scaffold: static site (no framework), test runner, GitHub Actions (test + Pages deploy), README with data attribution
- [ ] M1: Data: download SPY Clean 1-min CSVs for the days in SPEC.md (+ NVDA 2025-01-27), verify each day's moves match its story, bundle under data/, loader + tests
- [ ] M2: Features: per-bar return, rolling 5-min volatility, 3σ events, VWAP; unit tests on a fixture day
- [ ] M3: Sound engine: Web Audio synth, pentatonic pitch map, volume gain, volatility-driven filter/distortion, drone, event hits
- [ ] M4: Playback: play/pause/seek, speed control, day picker
- [ ] M5: Visuals: synced price line, volatility background, event flashes
- [ ] M6: Debug panel: live bar, return, σ, note, gain, drive, rule fired
- [ ] M7: Browser tests for playback + debug panel; Pages deploy check
- [ ] M8: Handoff: README (how it works, add a day, attribution), remove bot tokens/jobs
