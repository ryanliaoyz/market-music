# Changelog

## v3 — Unreleased

- UI refresh: **Replay a day** / **Live BTC** tabs replace the mode dropdown; day cards
  with one line of context (no outcome spoilers) replace the day dropdown. Past days can
  be shared as a link or saved as WAV for a chosen clip range, and links open with that
  range. Debug is hidden unless the URL has `?debug`. Live errors show a single **Retry**
  button, copied links confirm with "Link copied ✓" (share sheet on phones), WAV files
  are named by session or time, and all text is at least 12 px, including chart labels.

- GRO-54: public Live-to-v3 rendering and a three-minute, memory-only event rewind.
  Pause to select, preview, export WAV or share; Resume live reconnects without a
  backlog. V3 accepts 180-second clips while retaining the 64 KiB hash cap; dense
  selections report a shortening prompt. New Live scores retain no market data.
- GRO-42: composer-free event-score replay and WAV, two-minute v3 captures with a
  64 KiB share-link cap, all-part public synthesis and percent-only replay charts.
  The next-beat boundary excludes pre-capture tails. V1/v2 links and deployed Live
  capture remain supported; resolved event-source integration is explicit and does
  not ship the private composer.

## v2.1 — Unreleased

- M0: enforced CSP and deployment security headers, unverified shared-clip labeling,
  encoder-bounded v1/v2 notes, fixed Live error wording with provider details in Debug,
  and a shared lowpass/−1 dBFS peak ceiling with session-only listening volume.
- GRO-33: full-screen reactive dark visual, one large Start/Stop control,
  keyboard-accessible preset cards, and a mobile-first layout. Debug and credits
  open on demand; recording, share links and WAV remain directly accessible.
- GRO-34: musical Live mode with price-change scale degrees, in-key trend-driven
  chords, actual Coinbase trade-rate rhythms and size accents, and four versioned
  presets with distinct rhythmic textures. The five-second delay is preserved.
- Recording v2 captures resolved chords, patterns and accents for shared replay
  and WAV, retaining v1 playback, 30-second clips and the 4 KiB link cap.

## v2 — Unreleased

- Delayed live BTC-USD music from Coinbase's public feed, with five-second
  buffering, reconnect handling, and feed/mapping diagnostics.
- Classic, Ambient, Plucky, and Bass-heavy presets for historical and live playback.
- Up to 30 seconds of in-memory live recording, self-contained share-link replay,
  and locally rendered WAV downloads. Captured timing, rests, and presets survive replay.
- Mobile-friendly controls and an installable app shell with offline shared replay.
  Playback is foreground-only and requires a fresh tap after backgrounding.

Historical data and live feeds require connectivity; Coinbase availability depends
on network/region. Recordings are not uploaded or persisted: save a link or WAV
before reloading. Production acceptance remains open in the
[v2 release milestone](TODO.md#m5-v2-release-gro-30).
