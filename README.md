# Interlude

Enjoy the wait. Come back knowing what happened.

Interlude connects Codex desktop with one media tab in Chrome, Brave, or Edge. It runs locally on Windows and macOS, with no cloud account or language-model API key.

- **Fun mode:** switches to your chosen media tab while Codex works. On completion, a permission request, or a supported question, it pauses playback and attempts to return to Codex.
- **Locked-in mode:** shows short lessons based on dependencies declared in your project's `package.json`, with evidence and questions. Observed tool events explain what changed.

Version 0.2 adds Windows and macOS native adapters, 19 registered media platforms, cancellation, autoplay protection, diagnostics, and automated release checks. **This is a source distribution under validation.** A registered service is an adapter target, not a promise that every proprietary player works. OS focus restrictions can require clicking Codex yourself. See the [verification record](docs/release-verification.md) for measured results and remaining release gates.

## Requirements and startup

- Node.js 22 or 24; Node 24 recommended.
- Codex desktop with lifecycle hooks, plus its CLI for reviewing hook trust.
- Chrome, Brave, or Edge with Chromium 116 or later. Safari, Firefox, phone apps, and native entertainment apps are outside this version's scope.
- Windows: .NET Framework 4 compiler. PowerShell execution policy does not need changing.
- macOS: Xcode Command Line Tools with Swift. Install them with `xcode-select --install` if needed.

```sh
npm ci
npm start
```

Open **http://127.0.0.1:4318/** and keep the companion running. It listens only on IPv4 loopback. Codex's internal browser can show the dashboard; the media extension runs in your Chromium browser.

Startup builds a source-hashed helper in `.local/bin`. `npm run smoke:native` compiles and checks its read-only protocol. For damaged cache recovery, use `node scripts/build-native.mjs --force --smoke`. See [native setup](docs/native-platforms.md).

Start with **Try a demo** to explore both modes, permission and question states, completion, and answer reveal. Demo events do not control your other apps. Live monitoring starts disabled on every launch.

## Pair a media tab

1. Open `chrome://extensions`, `brave://extensions`, or `edge://extensions`.
2. Enable Developer mode, choose **Load unpacked**, and select this repository's `extension` folder.
3. In the dashboard, choose **Connect browser → Copy connection code**.
4. Open **Extensions → Interlude** from the browser toolbar. Paste the code and click **Connect**.
5. Open media, choose its tab in the popup, and click **Use this tab**. Grant access when prompted. Check that the dashboard reports ready media.

After an extension update, reload it in the extension manager, reload your media tab, and select the tab again. Selection is session-only. **Release playback** in the page or popup clears an autoplay hold without starting media.

Registered platforms: YouTube (including Shorts and Music), Instagram, Facebook, TikTok, X, Reddit, Twitch, Vimeo, Netflix, Prime Video, Disney+, Hulu, Max/HBO Max, Apple TV, Peacock, Paramount+, Spotify Web, Apple Music Web, and SoundCloud. Only `www.youtube.com` is enabled by default; other exact hosts require permission. See [host coverage and limitations](docs/platforms.md).

## Connect Codex

Run from this project directory:

```sh
npm run hooks:preview
npm run hooks:install
```

The installer merges seven passive handlers into `~/.codex/hooks.json`, preserves unrelated handlers, and backs up existing configuration. Each handler filters to **this repository's exact directory**. Other project events are ignored. This version monitors one project and one active session.

Open the Codex CLI here, enter `/hooks`, and review and trust the Interlude definitions. The installer never bypasses trust review. If your next desktop prompt is not detected, try a fresh task here or restart Codex after current work finishes. Existing-task reload behavior depends on the Codex version.

Choose **Connection details → Check setup** to inspect native readiness without changing focus. Keep one Codex desktop window open: ambiguous targets are refused. Interlude returns to the app window; it does not select a task within that window.

Once media is ready, turn on Interlude and submit a prompt in this project's Codex task. A 1.2-second start grace period avoids switching during short responses. A 1.4-second permission grace period avoids some automatically resolved requests. Completion requires a Stop hook and grace period; silence never means success.

## Playback and desktop behavior

- Pause confirmation precedes optional browser minimization. Missing acknowledgements remain visible as failures. Interlude still attempts to return to Codex when attention is required.
- Windows verifies actual foreground focus. When activation is denied, the helper flashes Codex in the taskbar and reports the limitation.
- macOS verifies the frontmost app and window. Resizing or restoring requires existing Accessibility permission. The helper never changes permissions or prompts automatically. Maximizing uses the display's usable area, not macOS fullscreen.
- **Minimize browser after returning** affects the selected tab's entire browser window, only after confirmed pause and verified Codex focus.
- Only a player Interlude actually paused can resume automatically. Manually paused media, muted previews, changed sources, replacement players, and new pages do not resume automatically. Cross-origin embedded players require manual resume.
- A pause hold prevents feed autoplay until the next break or explicit release. **Return to Codex now** holds automatic handoffs for the rest of the turn. Disarming releases the guard without starting playback.
- New turns, settings changes, manual return, and disarming cancel old actions. Cancellation cannot undo an OS operation that already happened.
- Permission hooks can precede automatic approval; slow reviews can still cause an unnecessary alert. Supported question-tool events are detected; arbitrary question text is not. Async question-tool return is not proof the user answered.
- Learning uses locally authored material and declared dependencies. It does not describe private model reasoning or prove a declared package is deployed.

DRM, closed players, inaccessible embeds, autoplay policy, OS focus rules, and regional availability can limit control. Interlude reports unavailable readiness or failed confirmation. See [browser compatibility](docs/platforms.md), [native behavior](docs/native-platforms.md), and [backend reliability](docs/backend-review.md).

## Local state and uninstall

Pairing codes are private bearer credentials. Their project-specific directory lives under `%LOCALAPPDATA%/Interlude` on Windows, `~/Library/Application Support/Interlude` on macOS, or the user state directory on Linux. Print **only the directory** with:

```sh
node --input-type=module -e "import { stateDirectory } from './src/config.mjs'; console.log(stateDirectory());"
```

An existing prototype `.local/connection.json` migrates without changing its code. `INTERLUDE_STATE_DIR` can override the directory with an absolute private local path. Keep it outside shared or synced folders.

To revoke pairing, disconnect the extension, stop the companion, and delete only `connection.json` in the printed directory. Restart and pair with the new code. To uninstall:

```sh
npm run hooks:remove
```

Remove the extension and stop the companion. Remove hooks before moving or deleting the project. No startup service, scheduled task, registry change, or cloud resource is installed. See [Privacy](PRIVACY.md) and [Security](SECURITY.md).

## Development and verification

```sh
npm run check
npm test
npm run smoke:native
npm audit --audit-level=high
npm run package:release
```

GitHub Actions runs the suite on Windows, macOS, and Linux with Node 22 and 24. Native smoke compiles and executes the real helper. A separate Chromium job loads the real MV3 extension against synthetic media and checks pairing, pause, resume ownership, autoplay holding, and the dashboard.

For local browser fixtures, first stop any companion using port 4318. Tests start an isolated server and stub native focus:

```sh
npx playwright install chromium
npm run test:e2e
```

Packaging produces deterministic source and unpacked-extension ZIPs with SHA-256 manifests in `artifacts/release`. An explicit allowlist excludes secrets, runtime state, dependencies, browser profiles, and activation history. These are not signed installers or browser-store packages. No open-source license grant is included.

Source map: `src/session.mjs` owns turn state; `src/server.mjs` owns authenticated transport and actions; `scripts/hook.mjs` sanitizes events; `extension/` controls media; `src/lessons.mjs` provides lessons; `src/platform.mjs` dispatches C# and Swift helpers; `web/` contains the dashboard.
