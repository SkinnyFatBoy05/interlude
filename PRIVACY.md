# Privacy

Interlude runs a local service on your computer. It does not use an Interlude cloud account, analytics service, or external language-model API.

The passive Codex hooks discard prompts, shell commands, assistant text, transcripts, and tool output. They send event identifiers, timestamps, project scope, a tool category, a correlation hash, and a bounded list of edited file names to the local companion. Events can originate from any local Codex project. Per-chat activity is held in memory, including while automatic handoffs are disabled; stopping the companion stops collection. Only the current project’s bounded package.json dependency list is read for lessons.

The browser extension enumerates registered media tabs so you can choose one. Only the selected tab's platform, title, readiness, and control results reach the companion. The extension does not collect browsing history. YouTube's main domain is enabled by default; other registered sites require an explicit permission grant in the popup. The extension uses standard media elements and permitted frames; it does not read account credentials or decrypt protected content.

The pairing token is a local bearer credential. The companion stores it in per-user operating-system application data, in a directory specific to this Interlude installation. The local dashboard and pinned extension can retrieve it through restricted bootstrap mechanisms. It is not stored in the project after successful migration. The browser stores its copy in extension-local storage, restricted to trusted extension contexts. Tab selection and temporary playback-pause ownership use session storage and in-memory state.

Mode and playback preferences are saved locally. Monitoring status, task activity, prompts and media ownership are not saved with those preferences. The desktop app can register an operating-system login item when you turn on Launch at login. It does not upload telemetry or automatically download updates; the downloads button opens GitHub in your default browser.

Local state is protected by your OS account and filesystem permissions; it is not an encrypted vault. Someone who can read that state as your OS user can impersonate the paired browser. Never put `INTERLUDE_STATE_DIR` in a shared or synced directory. Do not include pairing codes or local state in bug reports.

To remove access, disconnect the extension, stop the companion, and remove this installation's connection state using the location described in the setup documentation. Restarting creates a new token; the extension pairs automatically unless you explicitly disconnected it. Remove passive hooks using Disconnect Codex in the desktop app, or `npm run hooks:remove` for source installations. Disable Launch at login and remove the browser extension when uninstalling Interlude.

Source bundles use an explicit allowlist and exclude runtime state, credentials, local activation history, dependencies, browser profiles, and test artifacts. Desktop installers additionally include the Electron runtime, its license notices, the production WebSocket dependency, and the compiled native helper; they do not include your local state.
