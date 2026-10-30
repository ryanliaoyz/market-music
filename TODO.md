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

## Later
