# Changelog

## 0.2.0

- Registered major social, streaming-video, and music services with explicit site permissions and a shared standard-media adapter.
- Added tab readiness, feed autoplay suppression, playback release, per-frame acknowledgements, and cancellation tied to the original command.
- Added macOS native helper source/build and improved Windows package/window detection, diagnostics, and truthful OS-controlled return results.
- Hardened hook validation, project scope, replay handling, concurrent permission requests, manual return, cancellation, reconnects, and event-size limits.
- Moved pairing state out of the project into per-user local application data with token-preserving migration.
- Added cross-platform CI, a Chromium extension fixture, accessible dashboard checks, deterministic release archives, and privacy documentation.

Interactive macOS behavior and individual signed-in streaming services require the checks recorded in the compatibility matrix. This version does not claim guaranteed background foreground activation on Windows.

## 0.1.0

- Initial local Codex/YouTube prototype with Fun mode, project lessons, passive hooks, and simulated demos.
