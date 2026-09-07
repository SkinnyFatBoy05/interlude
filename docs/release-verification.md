# Release verification

This record distinguishes implementation and automated tests from tests on real accounts and desktops. A registered host is a compatibility target, not a certification that every player on that service is supported.

## 0.3.0 private beta — 2026-09-07

The beta adds all-local-project monitoring with independent chat state, an attention queue, acknowledgement, project-specific lessons, sanitized debug summaries, and tester onboarding. See [beta-testing.md](beta-testing.md) for installation, acceptance checks, recovery and known limitations.

Implementation run: [beta workflow](https://github.com/SkinnyFatBoy05/interlude/actions/runs/34111905919), commit b83af2e. All six OS/Node matrix jobs passed tests, native compile/protocol smoke where supported, dependency audit, and source packaging. The suite now contains 171 cases, with platform-specific permission/symlink skips. Browser/video results are recorded below once their artifact checks finish.

Local internal-browser checks confirmed the all-project scope, debug-summary copy feedback, labelled demo, both modes, and project learning fallback. The live companion received a real event from a different local project while handoffs were disabled. This validates broader hook ingestion, not automatic foreground activation.

The reproducible video uses the real dashboard, extension, hook-emitter process, local transport and HTML media. Two synthetic Codex sessions use separate temporary projects. The recording asserts completion pause, acknowledgement resume, React lessons, permission pause, continued-work resume, final pause and release. Native focus is mocked and the media clip is generated; this does not certify a live YouTube/Netflix or full native desktop loop.

## Historical 0.2 verification
**Verified 2026-09-05:** [all seven GitHub Actions jobs passed](https://github.com/SkinnyFatBoy05/interlude/actions/runs/33955420075) for implementation commit `93e05b9`. The matrix uses Node 22 and 24 on Windows x64, macOS ARM64, and Linux x64. Subsequent documentation-only commits retain that implementation; consult the repository's latest workflow for their verification status.

| Area | Verification required | Current evidence |
| --- | --- | --- |
| State and transport | Regression tests on Windows, macOS, Linux and Node 22/24 | 159 cases: all passed on macOS/Linux; Windows passed 158 with its POSIX-permission test skipped. Local Windows passed 157 with a second skip for unavailable symlink creation. No failures |
| Windows native helper | Compile, protocol smoke, unique package/window detection | Local compilation and read-only protocol passed; direct background foreground activation was declined by Windows |
| macOS native helper | Compile/protocol, then interactive activation and resize with granted/denied permissions | Actual Swift compilation and read-only smoke passed on macOS CI with Node 22/24; interactive desktop checks pending |
| Browser integration | Real MV3 worker, popup, content script, local backend, media ownership and autoplay fixture | Passed in actual headless Chromium: extension pairing, selection/readiness, Stop pause confirmation, next-turn owned resume, preview autoplay suppression, permission pause, disarm release, and manual play. Popup routing and rapid-turn ownership defects have reproduced regression coverage |
| Dashboard | Both modes, permission/question/completion states, learning, setup, diagnostics, narrow viewport | Three Chromium dashboard checks passed, including delayed bootstrap and 390px layout; internal browser checked setup, copy confirmation, both modes, completion, attention states, lessons, and actual read-only Windows diagnostics without errors. Browser job total: 4 passed |
| Individual services | Signed-in playback and feed navigation on each supported browser | See [platforms.md](platforms.md); broad live-service checks pending |
| Release privacy | Explicit file allowlist, archive contents and dependency audit | Source/extension archives built on every OS; exclusion and timezone-stability tests passed; npm audit: 0 known vulnerabilities. Downloaded archives from the preceding packaging run had matching hashes across all three OSes; actual ZIP contents and manifest checksums were verified |

The historical YouTube-only prototype paused a real visible video and exited fullscreen using simulated task events. Its CLI hooks also delivered a real SessionEnd event. Those observations do not establish the full updated desktop-to-media loop.

Before declaring a production release, validate an actual Codex desktop prompt, permission request, question, completion, user cancellation, manual override, disconnect/reconnect, and resumption on both Windows and macOS. Check multiple monitors and deny accessibility/foreground permissions to verify useful fallback behavior. Confirm that no media resumes unless Interlude owned its pause.

Source publication and green CI are necessary engineering checks. They do not replace interactive OS or paid-service validation, signed installer distribution, or browser-store review.

The source is published privately at [SkinnyFatBoy05/interlude](https://github.com/SkinnyFatBoy05/interlude). The local companion was restarted successfully; the existing pairing code migrated into per-user app data and its old project file was removed. Monitoring is disabled until the user connects the updated extension and turns it on. Existing unpacked installations must reload the extension and their selected media tab after updating.

