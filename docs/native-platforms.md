# Native desktop return

Interlude supports best-effort return to the Codex desktop app on Windows and macOS. A native request can be denied by the operating system. `focused: true` means the helper observed the target in front; a successful API call or a notification request alone is insufficient.

## Build and diagnostics

Source requirements: Node.js 22.12 or later; Windows with the .NET Framework 4 compiler, or macOS 13+ with Xcode Command Line Tools and Swift. Desktop packages bundle the runtime and a precompiled helper. No PowerShell script execution policy changes are needed. Install the macOS development tools with `xcode-select --install` if they are missing.

```sh
node scripts/build-native.mjs
node scripts/build-native.mjs --smoke
node scripts/build-native.mjs --force --smoke
node --input-type=module -e "import { platformDiagnostics } from './src/platform.mjs'; console.log(await platformDiagnostics());"
```

`build-windows.mjs` and `build-macos.mjs` also accept `--smoke` and `--force`. The universal build selects the current OS. On other platforms it explains that desktop return is unavailable while allowing the companion to run. `--force` recompiles even when a cached helper looks structurally valid; use it after an execution or protocol failure. Failed focus attempts are not automatically retried, because an OS action could already have occurred before the helper failed.

The helper executable lives in `.local/bin`. Its name contains a hash of its source and build configuration, including macOS architecture. Builds write to a unique temporary file and publish only after compilation succeeds. The next request rereads the source hash, so changing source within a running server does not reuse an outdated executable. Aborted and failed builds do not publish partial files.

Cached helpers must be regular, nonempty files with the expected PE or Mach-O header and, on macOS, executable permissions. Symlinks, directories, empty files, and malformed headers trigger a rebuild. Before replacing a cache entry, the completed new executable is checked. Replaced entries are preserved beside it with a `.replaced-…` suffix, including any unexpected directory contents; the builder never recursively deletes them. A failed forced compile leaves the previous helper intact. Header checks do not establish full runtime correctness, which is why the recovery command includes `--smoke`.

`platformDiagnostics({signal})` builds the helper if needed and invokes its read-only `status` mode. It never activates, resizes, flashes a window, or prompts for permissions. `focusCodex({maximize,signal})` performs an attempted return. Both return:

| Field | Meaning |
| --- | --- |
| `platform`, `supported`, `helperReady` | Host platform, supported adapter, and whether the helper was available |
| `capabilities` | Adapter support for `activate`, `maximize`, and native `attention`; these are capabilities, not permission guarantees |
| `focused`, `focusedWindowMaximized` | Observed foreground and maximized state; maximized is false unless focus was verified |
| `targetFound`, `targetCount` | Discovery result; when an app matches but has no verifiable window, the count is zero and `targetFound` remains true |
| `code`, `message` | Machine-readable outcome and actionable user-facing explanation |
| `attentionRequested` | Windows taskbar attention was requested; this never implies focus |
| `maximizeStatus` | `not_requested`, `maximized`, `accessibility_required`, or `unavailable` |
| `accessibilityTrusted`, `targetBundleId` | Optional macOS permission and discovered bundle identity |

Native execution is limited to six seconds with bounded output. A cancelled, crashed, malformed, or timed-out helper cannot report a successful return. Abort signals also stop compiler subprocesses. Cancellation prevents subsequent native execution, but cannot undo an OS action that already occurred before cancellation.

## Windows

The Store build runs as `ChatGPT.exe`. Interlude verifies its exact package family, `OpenAI.Codex_2p2nqsd0c76g0`, instead of targeting ordinary ChatGPT by its executable name. An unpackaged `Codex.exe` must also identify its product as Codex and its company as OpenAI in executable metadata. Window titles and task content are neither used nor returned.

The helper enumerates top-level windows, including multiple windows in a single process. It refuses ambiguous targets, restores a minimized window when needed, optionally maximizes, requests foreground activation, and checks the actual foreground handle. With maximize disabled, an already maximized window retains its state.

Windows restricts background foreground requests, including some requests that otherwise meet its documented conditions. If the request is denied, Interlude requests three caption/taskbar flashes and explains that the user can click Codex. It does not change focus protections, synthesize input, attach input queues, or claim that the flash established focus. See Microsoft’s [SetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow) and [FlashWindowEx](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-flashwindowex) documentation.

## macOS

No Codex bundle identifier is guessed or hardcoded. The helper discovers a unique running regular app named Codex, checks its `.app` bundle, compares bundle identifiers and executable URLs against the running application, and requires matching Codex bundle metadata. Discovery uses [NSRunningApplication](https://developer.apple.com/documentation/appkit/nsrunningapplication) and [NSWorkspace](https://developer.apple.com/documentation/appkit/nsworkspace).

If discovery does not match your installation, set `INTERLUDE_CODEX_BUNDLE_ID` to the exact installed bundle identifier before starting the companion. Read it from your actual Codex bundle rather than copying an example identifier:

```sh
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' '/Applications/Codex.app/Contents/Info.plist'
export INTERLUDE_CODEX_BUNDLE_ID='the.identifier.printed.above'
npm start
```

Adjust the application path to the installed location. Explicit configuration still requires a running app whose actual bundle identity and executable match. It can select a renamed installation. Diagnostics expose the discovered identifier for review, without exposing window titles.

Activation uses AppKit’s public `activate(options:)` and verifies `NSWorkspace.frontmostApplication` together with an on-screen application window. It runs the main run loop while checking the asynchronous result. It refuses multiple app or window matches. Without Accessibility access, Core Graphics supplies conservative window metadata for discovery; if macOS cannot expose a usable window, Interlude asks the user to open Codex manually. A minimized/hidden window may therefore require manual restoration before Accessibility access is granted. See Apple’s [activation API](https://developer.apple.com/documentation/appkit/nsrunningapplication/activate(options:)) and [window information API](https://developer.apple.com/documentation/coregraphics/cgwindowlistcopywindowinfo(_:_:)).

Maximize means resize the normal window to its current display’s usable area, leaving the menu bar and Dock available. It does not toggle macOS fullscreen. Public Accessibility APIs restore and resize the unique standard window only when the helper already has permission and the attributes are writable. Multi-display coordinates are converted from AppKit’s bottom-left origin to Accessibility’s top-left origin, then the resulting geometry is verified. See [NSScreen.visibleFrame](https://developer.apple.com/documentation/appkit/nsscreen/visibleframe), [AXIsProcessTrusted](https://developer.apple.com/documentation/applicationservices/1460720-axisprocesstrusted), and [Accessibility element APIs](https://developer.apple.com/documentation/applicationservices/axuielement_h).

If resizing is desired, grant the helper in `.local/bin` Accessibility access through System Settings → Privacy & Security → Accessibility. macOS may attribute permission to the launching terminal or app, and recompiling to a new hashed helper can require granting access again. Interlude checks existing trust without displaying a permission prompt or changing settings. AX calls have a short messaging timeout, backed by the parent process deadline. See [AXUIElementSetMessagingTimeout](https://developer.apple.com/documentation/applicationservices/1459345-axuielementsetmessagingtimeout).

The helper does not claim a native notification capability on macOS: the temporary command-line executable is not packaged as a notification application, and it does not attempt to request another app’s Dock attention. When activation fails, the dashboard reports the result and directs the user to Codex in the Dock or Command-Tab. Desktop notifications are not implemented in this version.

## Hook installation portability

The installer quotes both absolute paths for the platform shell: PowerShell single-quoted literals on Windows, POSIX single-quoted literals on macOS. Spaces, apostrophes, dollar signs and command punctuation are treated literally; control characters and relative paths are rejected. Existing hook command text remains unchanged. In 0.3 the hook script accepts all local projects; the beta setup explicitly discloses this expanded scope. Codex still controls when trusted hook definitions reload.

Installation validates the existing JSON, preserves unrelated handlers and metadata, and removes only matching Interlude command handlers. Ownership requires the Interlude marker and either an exact command match or the same normalized project script in the installer's strict two-literal Node command format. This recognizes v0.1 definitions and replaces an old Node executable path during an upgrade without duplicating hooks. Other project scripts, additional shell arguments, shell pipelines, and differently marked handlers are preserved. It takes an exclusive installer lock, creates a unique backup, writes and syncs a temporary file, detects intervening content changes, then renames the completed file into place. It rejects a non-regular or symlinked target. The lock coordinates Interlude installers; external editors do not participate, so avoid editing the same file during installation. A crashed installer can leave a lock file; remove that file only after confirming no installer is still running. Trust still uses Codex’s supported review flow. Native build, diagnostics, tests, and preview do not install hooks or change trust.

## Verification and release checklist

Automated checks run with:

```sh
node --test --test-isolation=none tests/platform.test.mjs tests/install-hooks.test.mjs tests/events.test.mjs
node scripts/build-native.mjs --smoke
```

The JavaScript tests exercise both dispatch paths, bundle configuration, cancelled builds and requests, protocol errors, source invalidation, partial build cleanup, hook preservation, backups, malformed configuration, and lock contention. Run native `--smoke` on both Windows and macOS CI runners to compile and execute the actual helper. The macOS smoke mode also checks pure bundle-identifier and geometry comparisons without needing Codex, Accessibility permission, or an interactive desktop.

**Verified locally on Windows, 2026-09-05:** the native Windows helper compiles and its read-only smoke passes; platform and installer tests pass. A live read-only diagnostic identified exactly one Codex window and correctly reported `not_foreground`, with no attention request. Earlier live testing observed Windows denying background focus. No OS focus restrictions were modified.

**Verified on macOS CI, 2026-09-05:** Swift compilation and native protocol smoke passed on GitHub's macOS runner with Node 22 and 24. This establishes compiler/runtime correctness, not an interactive desktop result. **Interactive activation, AX permission attribution, and multi-display resizing remain unverified.** Before declaring a platform release validated, perform these checks on each OS with the real Codex app:

1. Observe diagnostics with Codex closed, one window open, and multiple windows open; status must not move focus.
2. Return from a selected YouTube tab with maximize enabled and disabled, including minimized Codex and an already maximized window.
3. Confirm actual foreground state and video pause, then exercise permission/question attention and completion through real Codex hooks.
4. On macOS, test with Accessibility denied and granted, a secondary display, Dock placement, and Codex in another Space. Verify resize success is measured and denial is explained.
5. Cancel a pending return and confirm no delayed helper starts. Observe a denied activation: the UI must report denial and retain an actionable manual return path.
