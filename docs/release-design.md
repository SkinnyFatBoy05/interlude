# Interlude cross-platform release design

Interlude remains a local companion for Codex desktop. The user requested Windows and macOS support, major social and entertainment websites, reliability fixes, and publication to the SkinnyFatBoy05 GitHub account.

## Architecture

- A Node.js service bound to `127.0.0.1:4318` owns project-scoped task state, authenticated event delivery, cancellation, and browser acknowledgements.
- A Chromium Manifest V3 extension controls one explicitly selected media tab. A central platform registry defines exact hosts; additional site access requires the user's permission in the popup.
- Standard HTML media controls cover registered sites without reading private page internals or bypassing DRM. Pausing includes a temporary autoplay guard, and disarming releases that guard without starting media.
- Native Windows and macOS helpers discover a unique Codex application, request foreground activation, and report what the OS actually allowed. A declined request produces an actionable fallback. No simulated keyboard input or OS-policy changes.
- The dashboard keeps Fun and Locked-in modes, shows media readiness separately from tab selection, and provides an explicit setup diagnostic.

## Contracts

Browser status: `connected`, `selected` (valid chosen tab), `mediaReady`, `platform` (stable registry ID), `title`, `message`. Browser commands: `break`, `learn`, `pause`, `minimize`, `release`; `release` does not play anything.

Native interface: `focusCodex({maximize, signal})` returns confirmed focus and diagnostics. `platformDiagnostics({signal})` is read-only. Universal build command: `node scripts/build-native.mjs`; `--smoke` tests protocol without operating desktop windows.

Task actions are serialized and invalidated when their turn, mode, or monitoring ownership changes. A failed or absent media acknowledgement cannot be represented as a successful pause. Secrets and local user history stay outside release artifacts.

## Verification and release gates

- Regression tests cover task/permission timing, cancellation, transport authentication, input limits, project scope, browser reconnection, playback ownership, feed autoplay, and missing players.
- Windows, macOS, and Linux CI run JavaScript tests; native build/protocol checks run on Windows and macOS. Chromium fixture tests verify rendered dashboard behavior and actual HTML media playback control.
- Real website and interactive OS checks are reported separately from fixtures and compilation. Registration in the platform list does not mean an authenticated streaming session has been verified.
- Source and extension artifacts exclude `.local`, `.tmp`, credentials, machine-specific activation logs, dependencies, and browser profiles. GitHub publication uses the user's authenticated SkinnyFatBoy05 CLI account.
- A release cannot honestly be described as fully production-verified while interactive macOS activation, Windows foreground restrictions, and paid streaming sessions remain untested. Those limitations must remain visible in the release notes and compatibility matrix.
