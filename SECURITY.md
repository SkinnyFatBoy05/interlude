# Security

Desktop 0.4 uses a sandboxed renderer with context isolation and no Node integration. Its preload exposes fixed setup actions only; the main process validates the exact dashboard window, main frame, local URL and action type before handling IPC. External navigation, popups, embedded webviews and renderer permissions are denied. Packaged ASAR integrity is enforced, and Node environment options and inspector arguments are disabled. RunAsNode remains enabled for the bundled passive hook runtime. See [desktop release gates](docs/desktop-release.md) for signing, notarization and verification.

Interlude's trust boundary is the local OS account. The service binds to loopback, checks HTTP hosts and browser origins, authenticates hook and WebSocket traffic, separates extension and dashboard privileges, and bounds input sizes. These measures do not defend against malicious software already running as the same user.

The extension has explicit registered hosts and requests additional site access when you select a tab. It does not request arbitrary web access. Hooks never return approval decisions, and failure of the companion must not block Codex.

Use current Node.js and browser security updates. Install dependencies with `npm ci`; run `npm audit` and the documented verification commands before distributing a modified build. GitHub Actions are pinned to commit hashes and run with read-only repository permissions.

Do not post pairing codes, private project content, or exploit details in public issues. Report ordinary bugs through the repository's issues. For a suspected vulnerability, request a private reporting channel from the maintainer before sharing sensitive details.

Distribution archives are source and unpacked-extension bundles. They are not signed or notarized desktop installers. Native foreground activation and accessibility behavior depend on operating-system policy and must be checked on the target desktop.
