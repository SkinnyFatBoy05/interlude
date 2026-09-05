# Backend reliability review

The local companion accepts sanitized Codex hooks for one explicitly configured project. It tracks one active Codex session at a time. A background session cannot take control during a running turn, permission wait, question, or completion grace period. A new prompt in another session becomes eligible after the active turn finishes, is interrupted, or ends. There is no silent machine-wide monitoring.

## Action lifecycle

Browser and native actions belong to the current automation generation. New turns, interruption, changed settings, disarming, and manual return invalidate older actions. The bridge sends `{"type":"cancel","id":"…"}` for an in-flight browser command; late acknowledgements cannot update the current notice or trigger window minimization. Native actions receive an abort signal and have a bounded execution window.

Manual return pauses the selected media and returns to Codex. It holds automatic handoffs for the rest of the turn. A new prompt, a mode change, or re-enabling monitoring releases that hold. Disarming pauses media then sends `release` so the extension can clear its autoplay guard without starting playback. Graceful shutdown sends a bounded, best-effort release. Abrupt process or browser termination cannot guarantee that final command is delivered.

The server always requests a real pause acknowledgement, including in Learn mode with no media selected. An unavailable or unconfirmed pause remains visible as a failure; it never counts as permission to minimize the browser. Failure to pause does not prevent returning the user to Codex when attention is required.

Completed and superseded turns have bounded replay protection. Parallel permission requests remain pending until their matching tool results arrive. A late permission event for an already completed tool does not reopen the wait. Content-derived tool fingerprints are a fallback correlation mechanism, so identical concurrent invocations cannot be distinguished perfectly. Async question-tool return is not treated as proof that the user answered. Long quiet tools never become successful completions on a timer; completion requires an actual Stop hook and grace period.

## Bridge contract

- The local dashboard connects to `/bridge` with the local HTTP origin and authenticates as `dashboard`.
- The browser extension connects with its Chromium extension origin and authenticates as `extension`. A token does not permit swapping those roles. The extension never receives project snapshots or diagnostics.
- Browser updates contain `selected`, `mediaReady`, `platform`, `title`, and `message`. Selection means a valid chosen tab; readiness independently reports whether its player is available.
- Commands remain `break`, `learn`, `pause`, and `minimize`, with `release` and command cancellation added for lifecycle cleanup. Every command has an ID; acknowledgements belong to the extension connection that received it.
- Protocol ping/pong removes an unresponsive socket within two heartbeat periods (normally about 30 seconds). A restored selected player can reschedule a handoff during the active running turn.
- Dashboard `diagnostics` requests call the injected read-only native diagnostic function. Duplicate in-flight requests share one result. State includes `diagnostics.checkedAt`, platform, and package version.

## Pairing and privacy

Pairing state defaults to per-user application storage, with a directory derived from the normalized project scope:

- Windows: `%LOCALAPPDATA%/Interlude/<scope hash>`
- macOS: `~/Library/Application Support/Interlude/<scope hash>`
- Linux: `$XDG_STATE_HOME/Interlude/<scope hash>`, falling back to `~/.local/state/Interlude/<scope hash>`

`INTERLUDE_STATE_DIR` explicitly overrides the full state directory and must be absolute. Choose a private local directory. Using one override for multiple projects intentionally points them at the same connection state.

An existing validated `.local/connection.json` is migrated without changing its token. The destination is published atomically without overwriting another process's pairing state; only then is that known old token file removed. An existing different destination token is preserved and the legacy file is retained with an actionable warning. A failed legacy-file removal also produces a warning. Native build artifacts in `.local/bin` are unaffected. Migration cannot retract earlier cloud-sync copies or backups of an old token.

Token files are plaintext, generated from 32 cryptographically random bytes. On POSIX, files use owner-only permissions; new state directories use owner-only access. Windows storage relies on the per-user application directory's inherited ACL. Files are size-limited and validated before use. This protects against ordinary web origins and accidental exposure; it is not a boundary against software already running as the same OS user, a compromised paired extension, or a compromised machine.

Hook input and HTTP request limits count UTF-8 bytes. Only explicitly allowed event fields are accepted. Hook payloads discard prompts, output, assistant text, and command bodies. File evidence contains up to eight relative paths; traversal, control characters, rooted foreign paths, and alternate-stream syntax are excluded. POSIX and Windows path parsing is selected from the input path, with Windows case folding and case-sensitive POSIX scope comparison. Canonical filesystem aliases and case-insensitive macOS volumes can still require matching the exact installed project path.

The hook remains a bounded, fail-open observer: unavailable companion, malformed input, or unavailable pairing state produce only an empty JSON result. It cannot approve a Codex tool or modify the assistant's answer. The HTTP service listens only on IPv4 loopback and validates Host, Origin, pairing token, content type, payload size, and event schema. No events or task content are persisted by the server.

## Verification and remaining release checks

Regression tests cover stale actions, Learn pause failure, manual return cancellation, settings and event validation, token-creation races, token migration, scope separation, heartbeat disconnects, reconnect recovery, permission ordering, parallel waits, role separation, and byte limits. The Windows run exercises Windows filesystem behavior and both path-parser variants. The POSIX permission test is intentionally skipped there.

Real Windows and macOS runners must still verify native focus, OS permissions, live hook delivery, browser autoplay restrictions, and full end-to-end cancellation on supported media sites. Passing these backend tests does not establish live desktop or third-party-site compatibility.
