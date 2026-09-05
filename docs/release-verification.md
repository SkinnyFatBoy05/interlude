# Release verification

This record distinguishes implementation and automated tests from tests on real accounts and desktops. A registered host is a compatibility target, not a certification that every player on that service is supported.

| Area | Verification required | Current evidence |
| --- | --- | --- |
| State and transport | Regression tests on Windows, macOS, Linux and Node 22/24 | First CI run passed all six OS/Node jobs; updated popup regression suite awaiting final CI |
| Windows native helper | Compile, protocol smoke, unique package/window detection | Local compilation and read-only protocol passed; direct background foreground activation was declined by Windows |
| macOS native helper | Compile/protocol, then interactive activation and resize with granted/denied permissions | Actual Swift compilation and read-only smoke passed on macOS CI with Node 22/24; interactive desktop checks pending |
| Browser integration | Real MV3 worker, popup, content script, local backend, media ownership and autoplay fixture | First Chromium run found a popup sender-routing defect; fixed with reproduced regression; final run pending |
| Dashboard | Both modes, permission/question/completion states, learning, setup, diagnostics, narrow viewport | Three Chromium dashboard checks passed, including delayed bootstrap and 390px layout; internal browser checked setup, both modes, attention states, lessons, and actual read-only Windows diagnostics without errors |
| Individual services | Signed-in playback and feed navigation on each supported browser | See [platforms.md](platforms.md); broad live-service checks pending |
| Release privacy | Explicit file allowlist, archive contents and dependency audit | Source/extension archives built successfully; exclusion and timezone-stability tests passed; npm audit: 0 known vulnerabilities |

The historical YouTube-only prototype paused a real visible video and exited fullscreen using simulated task events. Its CLI hooks also delivered a real SessionEnd event. Those observations do not establish the full updated desktop-to-media loop.

Before declaring a production release, validate an actual Codex desktop prompt, permission request, question, completion, user cancellation, manual override, disconnect/reconnect, and resumption on both Windows and macOS. Check multiple monitors and deny accessibility/foreground permissions to verify useful fallback behavior. Confirm that no media resumes unless Interlude owned its pause.

Source publication and green CI are necessary engineering checks. They do not replace interactive OS or paid-service validation, signed installer distribution, or browser-store review.
