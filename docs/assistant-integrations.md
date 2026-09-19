# Claude and Codex integrations — 0.5 preview

The same extension targets Chrome, Brave and Edge (Chromium 120 or later) on Windows and macOS. Website mode works without installing or running the desktop companion. Native application mode requires it. These new UI adapters are an integration preview: controlled fixtures are not verification of the current signed-in sites or desktop apps.

| Surface | Setup | Signal and limits |
| --- | --- | --- |
| Codex desktop | Companion → Connect Codex, review /hooks | Official lifecycle hooks; all local projects |
| Claude Code desktop / local CLI | Companion → Claude desktop → Connect Claude Code, review Claude Code /hooks | Official lifecycle hooks; all local projects. Return targets the Claude app; CLI-only users return manually |
| Claude.ai chat | Extension → choose AI website tab → Watch this AI tab | Opt-in observation of English controls; keep task tab open |
| Claude Code web | Watch its task-detail tab | Separate browser surface; local hook settings do not monitor remote tasks |
| Codex web | Watch its task-detail tab under /codex | Opt-in observation of English controls, not ordinary ChatGPT chats |
| Claude desktop Chat/Cowork | Companion → Claude desktop → Observe Claude Chat/Cowork | Experimental accessibility observer; keep one Claude window and the intended task selected. macOS needs Accessibility access. UI changes, minimized/inaccessible content and unsupported controls may prevent detection |

## Websites without the companion

1. Load the `extension` folder unpacked in your browser (store distribution is still pending). No Node runtime or desktop installer is needed for this mode.
2. Open a Claude or Codex task page and a media tab. In the extension select **Your media tab → Use this tab**.
3. Choose **Your AI website tab → Watch this AI tab**. Grant only that site's access. Repeat to watch more task tabs, up to 32.
4. Select Fun or Locked-in mode and **Turn on website monitoring**. Submit a prompt in a watched tab.
5. A running signal starts the break after a grace period. Completion or attention pauses media and activates the originating tab. **Acknowledge website alert** clears a queued alert; it never approves an AI action.

The extension requires a positive working signal and then a stable finish signal. Silence, an absent Stop button, a closed tab or a changed URL never counts as a successful completion. Unsupported pages can remain idle/unknown. Keep the relevant task-detail tab open; this does not track every remote task after you close its page. Only media paused by Interlude is eligible for automatic resume. The selected tab's normal autoplay rules still apply.

Website monitoring owns playback while enabled; the companion turns off desktop handoffs to prevent competing actions. Turn website monitoring off before enabling desktop monitoring. Browser-session state survives extension worker suspension but clears on browser restart. The desktop always starts disarmed.

Unknown website controls persisting for ten seconds pause playback without declaring completion. A watchdog also checks lost heartbeats every thirty seconds; browser throttling can delay that check. A fresh working signal can resume the break. Desktop observation uses the same ten-second unknown-state fallback.

Locked-in website mode opens bundled general programming lessons. It does not read your remote repository or claim to explain the assistant's private reasoning. Project-specific dependency lessons remain available through local Code hooks.

## Local Claude Code

Installed companion users use **Connect Claude Code**. Source users run:

```sh
npm run hooks:claude:preview
npm run hooks:claude:install
```

Review `/hooks` in Claude Code and begin a new session. The installer merges passive handlers into `~/.claude/settings.json` (or `CLAUDE_CONFIG_DIR/settings.json`), backs up existing bytes and preserves unrelated settings/hooks. To disconnect use the companion button or `npm run hooks:claude:remove` before moving the installation. Codex's existing installer remains separate.

The companion uses Claude Code's `prompt_id` when supplied (Claude Code 2.1.196 and later); for older clients it assigns a turn at prompt submission. It ignores subagent events. Permission and tool-result events correlate using a digest of the tool name and input because PermissionRequest omits `tool_use_id`. Identical simultaneous tool inputs share that correlation key; altered inputs can require a subsequent prompt or Stop event to clear a wait. It forwards only sanitized state, tool categories and relative edit filenames; no prompt, transcript or tool output is transmitted. The hook exits successfully and never returns permission decisions, including when the companion is unavailable. See the [Claude Code hook reference](https://code.claude.com/docs/en/hooks).

## Ordinary Claude desktop Chat/Cowork

Turn monitoring off before switching **Observe Claude Chat/Cowork** on. The observer reads bounded accessibility control labels and edit-control availability from a uniquely identified Claude window. It never reads text-field values or transmits conversation text. Keep the intended task selected; this adapter does not identify or follow hidden desktop chats. A changed or inaccessible UI can make task state unknown, so use Code hooks where available.

While this observer is selected, Claude Code hook events are ignored to prevent duplicates. Codex hooks remain available. Changing the Claude observation mode clears old Claude task state. The observer is off after restarting Interlude and polls only while monitoring is enabled. Disarming, screen locking, sleep or quitting stops it.

macOS observation requires the OS Accessibility grant; Interlude never grants that permission itself. Windows discovery requires a Claude executable whose product/company metadata identify Claude/Anthropic. Native focus remains subject to OS restrictions and refuses ambiguous windows. A missing app or permission is reported rather than treated as a successful handoff.

## Verification boundary

Before advertising live support, exercise starts, streaming gaps, tool waits, permission requests, questions, completion, cancellation, SPA navigation, multiple simultaneous tasks, manual pauses, worker restarts, and disconnects on each advertised surface. Repeat on actual Windows and Mac desktops with dual displays. The signed-in pages, current Claude Chat/Cowork accessibility trees, macOS Accessibility/Spaces behavior, and proprietary media players require interactive acceptance. Test fixtures and compiled helpers do not establish those results.
