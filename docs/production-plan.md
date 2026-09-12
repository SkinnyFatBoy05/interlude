# Desktop release candidate

This work turns the existing technical beta into an installable desktop release candidate. Public production release still requires signed Windows and notarized macOS builds, browser store review, and interactive OS/player acceptance testing.

## Implementation

- Bundle the runtime, dashboard and compiled native helper into Windows and macOS desktop packages. No end-user Node, terminal or compiler requirement.
- Keep the dashboard sandboxed with a narrow, sender-validated preload bridge. Local HTTP/WS authentication and exact extension origin remain enforced.
- Add a single-instance tray app, explicit quit, login preference, extension-folder shortcut, hook install/removal, and an update-page shortcut.
- Persist only validated preferences; never restore monitoring, tasks, media ownership or tokens from preferences.
- Reject competing browser connections instead of replacing a healthy connection in a reconnect loop.
- Exercise restart/recovery, packaged setup and critical media behavior. Build all native architectures in CI and generate checksummed release artifacts.

## Release acceptance

- Automated: syntax, unit/integration, real Chromium extension/player flows, packaged desktop smoke, Windows/macOS native protocol, dependency audit.
- Manual: two displays, Windows foreground restrictions, macOS Accessibility/Spaces, sleep/wake, signed-in players, install/upgrade/uninstall on clean machines.
- Distribution: trusted signing identities, notarization credentials, store listing and privacy/support details. These require the owner's accounts; unsigned CI artifacts are for controlled testing.
