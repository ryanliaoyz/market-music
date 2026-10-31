# Changelog

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
