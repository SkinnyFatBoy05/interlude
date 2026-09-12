# Release verification

This record distinguishes implementation and automated tests from tests on real accounts and desktops. A registered host is a compatibility target, not a certification that every player on that service is supported.

## 0.4.0 desktop release candidate — 2026-09-12

Implementation commit `defa702` passed [all ten CI jobs](https://github.com/SkinnyFatBoy05/interlude/actions/runs/34679059681): Node 22/24 on Windows/macOS/Linux, Chromium dashboard/extension and demo recording, and desktop packaging plus UI/runtime smoke on Windows x64, macOS ARM64 and macOS Intel.

The unit/integration suite has 184 cases. Local Windows passed 182 with two filesystem/platform skips. Packaged desktop checks exercised the sandboxed renderer, guided setup, execution of the exact installed bundled-runtime hook command, preservation/removal of temporary hooks, preferences, and debug-summary copying. Native helpers compiled and passed their no-focus protocol checks on Windows and both Mac architectures. A subsequent smoke assertion also exercises the packaged helper through Check setup; it passed locally on Windows. See the latest CI run for that assertion on Mac.

Visual QA used the real Electron dashboard and Chromium at desktop and 390px widths. A hidden task column that squeezed the status text was removed, headings were reduced, and running/demo surfaces remain black. Generated video uses simulated Codex events and HTML media, with native foreground activation mocked.

Mac startup testing caught a packaging exclusion: modules shared with the separate hook runtime were omitted from app.asar. Hook resources now stage independently, and every build asserts required archive modules and separate runtime files exist. Startup import errors are caught and surfaced. Windows upgrades preserve installed hooks; explicit uninstall removes only the matching installation's handlers.

Artifacts are release candidates: Windows unsigned, Mac ad-hoc signed with no notarization. No public release or store publication occurred. Trusted signing, clean-machine installer/upgrade/uninstall acceptance, real Codex foreground behavior across displays/Spaces, and signed-in service-player coverage remain release gates.

## 0.3.1 private beta 2 — 2026-09-09

This update pins the unpacked extension identity and uses its exact browser origin to pair automatically over the local WebSocket bridge. The setup screen now generates the extension folder path from the companion's install location on each computer, so testers no longer copy a connection code. Explicit Disconnect still disables automatic reconnection until the tester chooses Connect companion.

The permission reducer now treats a matching tool start as proof that a permission request was resolved. This cancels the pending attention return before it can pause media, while unrelated and parallel permission waits remain tracked. The extension popup and in-page playback panel now match the black and acid-green dashboard; both Release playback controls are verified at `rgb(202, 255, 61)` in Chromium. The recorded media fixture uses a low-motion monochrome gradient on a true black export canvas.

Local Windows verification passed 174 of 176 Node tests with two platform skips, all four required Playwright browser tests, JavaScript and manifest checks, the native compilation/protocol smoke, source and extension packaging, and an npm audit with zero known vulnerabilities. The internal browser also verified the live automatic-pairing instructions and computer-specific extension path. Live macOS activation, signed-in service playback, and browser-store distribution still require beta validation.

## 0.3.0 private beta — 2026-09-07

The beta adds all-local-project monitoring with independent chat state, an attention queue, acknowledgement, project-specific lessons, sanitized debug summaries, and tester onboarding. See [beta-testing.md](beta-testing.md) for installation, acceptance checks, recovery and known limitations.

Implementation run: [beta workflow](https://github.com/SkinnyFatBoy05/interlude/actions/runs/34111905919), commit b83af2e. All six OS/Node matrix jobs passed tests, native compile/protocol smoke where supported, dependency audit, and source packaging. The suite now contains 171 cases, with platform-specific permission/symlink skips.

The [recording workflow](https://github.com/SkinnyFatBoy05/interlude/actions/runs/34112326444) passed the four Chromium integration checks and the separate multi-project recording test. The exported H.264 video is 1920 × 1200, 56.72 seconds. Pause and learning frames were visually inspected, and recorded state evidence confirms all seven chapters. That run exposed an existing macOS heartbeat test ordering assumption; the test now awaits both independent socket events before asserting closure. Consult the latest workflow for the final matrix result.

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

