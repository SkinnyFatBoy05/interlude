# Desktop setup and release

## Install and connect

Interlude 0.4 packages a local desktop app for Windows 10/11 x64, macOS Apple Silicon and macOS Intel. macOS 13 or newer is required by [Electron 44](https://www.electronjs.org/blog/electron-44-0); the Swift helper is also compiled with a macOS 13 deployment target. The installer includes Electron's runtime, the dashboard, the compiled native return helper, and the browser extension. Node and compiler requirements apply only to source development.

Quit any older terminal companion first. On Windows run the installer; on macOS copy Interlude from the DMG into Applications before connecting Codex. Keep that install location stable. Open **Connect browser**, use **Open extension folder**, and load that folder in Brave/Chrome/Edge with Developer mode. Choose your media tab in the extension. Click **Connect Codex** in the app, review the handlers in Codex `/hooks`, then start a new task. Browser-store installation is a remaining distribution step.

Only one browser owns media controls. Disconnect the extension in the current browser before connecting another. A second browser cannot steal a healthy connection. The app starts with monitoring off; settings are retained, but tasks and playback ownership are not restored. Sleep or screen lock turns monitoring off. Re-enable it when you return.

Closing the dashboard leaves the tray/menu-bar app running. **Quit Interlude** ends monitoring and releases the playback guard without starting media. Launch at login is an explicit preference. The app links to the repository's release page for manual downloads; no background download or automatic update is implemented.

## Upgrade and uninstall

Locked-in mode opens the desktop learning view. If you have a selected media tab it pauses first; you can also use this mode with no media browser connected.

Quit Interlude before installing an update. Install into the same location to retain preferences and hook identity. Reload the browser extension after upgrading. If moving the app, first use **Disconnect Codex**, move it, then reconnect. If migrating from source, run `npm run hooks:remove` in the old source installation before connecting the desktop app; unrelated/source-installation handlers are deliberately not removed automatically.

Windows uninstall attempts to remove only that installation's passive hooks and preserves other Codex handlers and user data. On macOS, use **Disconnect Codex**, disable **Launch at login**, quit the app, then move it to Trash. Remove the extension from each browser. To reset preferences/pairing, stop the app and remove only this installation's directory under the Interlude OS app-data folder. Do not delete another installation's state or share pairing files.

## Build and verify

```sh
npm ci
npm run check
npm test
npm run test:e2e
npm run desktop:dist
npm run desktop:smoke -- artifacts/desktop/win-unpacked/Interlude.exe
node scripts/desktop-checksums.mjs
```

Build on the target OS/architecture: Swift helper builds match the machine's architecture. macOS package smoke paths are `artifacts/desktop/mac-arm64/Interlude.app/Contents/MacOS/Interlude` and `artifacts/desktop/mac/Interlude.app/Contents/MacOS/Interlude`. Quote paths containing spaces. CI builds and exercises all three desktop targets. The smoke uses temporary state and temporary Codex configuration; it does not install real user hooks or trigger desktop returns. The packaged main-process debugger is disabled, so tests use an explicitly requested ephemeral loopback renderer-debugging port.

`artifacts/desktop` contains installers and SHA-256 sums. Source/extension ZIPs remain available through `npm run package:release`. Do not change a generated installer after calculating checksums. The runtime licenses and Chromium third-party notices ship with Electron; no open-source grant is made for Interlude itself.

## Public release gates

Current CI builds are unsigned release candidates. A production release must additionally complete these checks:

- Configure the owner's Windows signing identity and Apple Developer ID/notarization credentials in the release environment. Run `npm run desktop:release` on each native runner; this requires signing and, on macOS, notarization. Do not commit certificates or passwords. Builder reads `CSC_LINK`/`CSC_KEY_PASSWORD` and Apple's supported notarization credentials. See [v26 signing troubleshooting](https://www.electron.build/v26/docs/troubleshooting/) and [notarization](https://www.electron.build/v26/docs/notarization/).
- Verify Windows Authenticode status, macOS `codesign --verify --deep --strict`, `spctl --assess`, and `xcrun stapler validate`; then repeat install, upgrade, hook execution and uninstall on clean machines. Unsigned CI runs cannot certify these steps.
- Validate real Codex activity, Windows focus/taskbar fallback, macOS Accessibility and Spaces, two displays, sleep/wake, and signed-in playback on each advertised service/browser. Generated-media tests are not proprietary-player certification.
- Submit the browser extension to the intended stores, check its published ID matches the pinned companion origin, and provide public privacy/support and ownership details. Store publication and developer accounts belong to the owner.

The desktop follows [Electron's security guidance](https://www.electronjs.org/docs/latest/tutorial/security): isolated sandboxed renderer, no renderer Node API, denied navigation/popups, sender-checked fixed IPC actions, and no arbitrary shell or path bridge. The RunAsNode fuse remains enabled specifically for passive hook execution with the bundled runtime. Node options/inspector flags are disabled; packaged ASAR integrity is enforced.
