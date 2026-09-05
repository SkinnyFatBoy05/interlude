# Interlude release implementation plan

**Goal:** Harden the existing companion, add cross-platform native helpers and registered media services, verify reproducible builds, and push the reviewed source to SkinnyFatBoy05/interlude.

**Architecture:** See [release-design.md](release-design.md). Existing Node.js service and MV3 extension remain separate local components. User authorization covers implementation and GitHub publication.

## Work streams

- [x] Browser: `extension/**`, `tests/browser.test.mjs`, extension tests, and `docs/platforms.md`. Implement exact-host registry, optional permissions, readiness, owned playback, autoplay pause/release, and reconnect failures. Run regression tests against multiple mounted media elements, user overrides, navigation, and undefined responses.
- [x] Native: `src/platform.mjs`, native build scripts/sources, installer portability, native tests, and `docs/native-platforms.md`. Build Windows/macOS helpers and side-effect-free protocol smoke checks. Verify package/bundle discovery, cancellation, denied permissions, and no-window/ambiguous-window outcomes.
- [x] Backend: `src/server.mjs`, `session.mjs`, `events.mjs`, `config.mjs`, `scripts/hook.mjs`, backend tests, and `docs/backend-review.md`. Reproduce and fix stale effects, acknowledgement handling, malformed/oversized events, heartbeat/reconnect, atomic secret writes, and path-scope errors.
- [x] Dashboard: `web/**` and rendered tests. Generalize media labels, show platform/readiness errors, surface native diagnostics, retain accessible demo and learning flows, and clarify pairing confirmation.
- [x] Delivery: package metadata/lockfile, `.github/workflows/**`, build artifacts, privacy/security documentation, and compatibility matrix. Run dependency audit, all tests, native builds, browser fixtures, and artifact exclusion checks.
- [x] Integration review: inspect every work stream, run the combined suite, validate the internal-browser UI, fix any cross-component failures, and record exact verification limits.
- [x] GitHub: confirm destination visibility, create a clean initial commit, create or use the authorized repository without overwriting existing work, push, wait for Windows/macOS/Linux CI, fix failures, and report the repository plus actual readiness.

## Local constraints

The repository is initially uncommitted and has no remote. Its exact directory is referenced by installed passive hooks, so work stays in this checkout. No global Codex settings or trust records are rewritten during the release audit. Browser extension-manager automation is blocked; local rendered debugging uses Codex's internal browser as requested.

