# Release verification

This record distinguishes implementation and automated tests from tests on real accounts and desktops. A registered host is a compatibility target, not a certification that every player on that service is supported.

| Area | Verification required | Current evidence |
| --- | --- | --- |
| State and transport | Regression tests on Windows, macOS, Linux and Node 22/24 | Local focused suites pass; combined CI is the release gate |
| Windows native helper | Compile, protocol smoke, unique package/window detection | Local compilation and read-only protocol passed; direct background foreground activation was declined by Windows |
| macOS native helper | Compile/protocol, then interactive activation and resize with granted/denied permissions | Source and mocked contract tests implemented; Mac CI and real desktop checks pending |
| Browser integration | Real MV3 worker, popup, content script, local backend, media ownership and autoplay fixture | Chromium CI fixture implemented; first CI run pending |
| Dashboard | Both modes, permission/question/completion states, learning, setup, diagnostics, narrow viewport | Earlier internal-browser prototype checks passed; updated dashboard validation pending |
| Individual services | Signed-in playback and feed navigation on each supported browser | See [platforms.md](platforms.md); broad live-service checks pending |
| Release privacy | Explicit file allowlist, archive contents and dependency audit | Packaging checks implemented; final archive/audit pending |

The historical YouTube-only prototype paused a real visible video and exited fullscreen using simulated task events. Its CLI hooks also delivered a real SessionEnd event. Those observations do not establish the full updated desktop-to-media loop.

Before declaring a production release, validate an actual Codex desktop prompt, permission request, question, completion, user cancellation, manual override, disconnect/reconnect, and resumption on both Windows and macOS. Check multiple monitors and deny accessibility/foreground permissions to verify useful fallback behavior. Confirm that no media resumes unless Interlude owned its pause.

Source publication and green CI are necessary engineering checks. They do not replace interactive OS or paid-service validation, signed installer distribution, or browser-store review.
