# Changelog

## 0.3.0 — private beta

- Monitor all local Codex chats and projects with independent task state and a bounded attention queue.
- Acknowledge alerts individually; playback resumes only when another task is working and no alert blocks it.
- Learn mode follows the selected project's stack. Added sanitized debug export, beta onboarding and bug-report template.
- Added a reproducible integration video using the real extension, hook emitter and generated media, with simulated Codex events and mocked native focus clearly disclosed.
- Technical source distribution; interactive macOS and individual signed-in service checks remain required. See docs/beta-testing.md.

## 0.2.0

- Registered major social, streaming-video, and music services with explicit site permissions and a shared standard-media adapter.
- Added tab readiness, feed autoplay suppression, playback release, per-frame acknowledgements, and cancellation tied to the original command.
- Fixed popup pairing when opened in an extension tab and preserved valid pause ownership when a new prompt arrives before acknowledgment.
- Added macOS native helper source/build and improved Windows package/window detection, diagnostics, and truthful OS-controlled return results.
- Hardened hook validation, project scope, replay handling, concurrent permission requests, manual return, cancellation, reconnects, and event-size limits.
- Moved pairing state out of the project into per-user local application data with token-preserving migration.
- Added cross-platform CI, a Chromium extension fixture, accessible dashboard checks, deterministic release archives, and privacy documentation.

Automated verification: all six OS/Node configurations passed the 159-case suite with platform-specific skips; Windows and macOS native builds/smoke passed; all four Chromium integration checks passed. See the [verification record](docs/release-verification.md).

Interactive macOS behavior and individual signed-in streaming services require the checks recorded in the compatibility matrix. This version does not claim guaranteed background foreground activation on Windows.

## 0.1.0

- Initial local Codex/YouTube prototype with Fun mode, project lessons, passive hooks, and simulated demos.

