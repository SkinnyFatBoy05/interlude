# Interlude beta testing

For 0.4 desktop packages, start with [desktop setup](desktop-release.md); no terminal or compiler is needed on the tester's computer. The source workflow below remains supported. Public release still requires signing and interactive acceptance.

This beta is for a small group of technical testers using local Codex desktop tasks with Chrome, Brave, or Edge. Windows and macOS are target platforms. macOS native code compiles in CI; interactive Mac behavior is still a beta test item. Safari, Firefox, remote/cloud sessions, phone apps, and native streaming apps are outside this beta.

## Install and first run

1. Use Node 22 or 24. Windows needs the .NET Framework 4 compiler; macOS needs Xcode Command Line Tools with Swift. Extract the source ZIP to a permanent local folder outside cloud-sync storage. Keep that folder after installing hooks.
2. In that folder, run `npm ci`, then `npm start`. In Windows PowerShell use `npm.cmd ci` and `npm.cmd start`. Keep the terminal open. The source is unsigned and requires these developer tools; it is not a double-click installer.
3. Open http://127.0.0.1:4318/. Try the labelled demo first.
4. In your browser's extension manager, enable Developer mode and load the `extension` folder unpacked. Open Interlude from the browser toolbar; it pairs with the running companion automatically. Choose a YouTube video tab, grant access if asked, and select **Use this tab**. The dashboard must report ready media.
5. Run `npm run hooks:preview`, then `npm run hooks:install` (use `npm.cmd` on Windows). Review and trust the seven hooks in Codex CLI `/hooks`. Start a fresh Codex desktop task if an existing task does not load them.
6. In Connection details, select **Check setup**. Resolve helper errors before testing automatic return. Keep one Codex window open to avoid ambiguity.
7. Turn on Interlude. Submit prompts in two different local projects. You do not need to install Interlude separately in each project.

Hooks report sanitized events from all local projects to this one companion. They do not approve commands or send prompt text. Turning off Interlude disables automatic handoffs. Stop the companion or remove the hooks to stop receiving events entirely. Task information is held in memory and cleared on restart.

## Expected multi-chat behavior

Each session has independent task state. Up to 32 sessions are retained; completed, acknowledged sessions can be evicted to make room. Running or unacknowledged sessions are never silently replaced when that limit is reached.

The newest working chat supplies the current break. Any chat requesting permission, asking a supported question, or completing pauses media and enters the attention queue. The list identifies its project and shortened session ID. Another chat cannot steal an outstanding alert.

**Acknowledge this alert** clears that alert. If another chat is still working and no other alert remains, its break resumes. Acknowledgement never approves a Codex action or supplies an answer. A matching tool start or result resolves its permission wait; a fresh prompt also clears the previous turn's wait. Media stays paused when no work remains. **Return to Codex now** holds automatic handoffs until a new prompt, mode change, or re-enabling.

Interlude activates the Codex window, not the specific chat. Use the displayed project/session to find it. Windows can deny foreground activation; taskbar attention is the fallback. On macOS, resizing/restoring may need Accessibility permission. Multiple monitors do not change media selection, but native positioning and focus must be checked on actual hardware.

## First tester session: 10 minutes

- Play YouTube, start a Codex task, and confirm the selected tab becomes active after the grace period.
- Complete that task. Verify real silence and stopped playback; note whether Codex actually comes forward or shows the documented fallback.
- Start two tasks in different projects. Finish the background task. Confirm its project appears and playback pauses even while the other continues. Acknowledge and confirm only the owned player resumes.
- Trigger a permission request and a supported question. Confirm media pauses and Interlude never answers or approves them.
- Switch to Locked-in mode. Confirm the lesson evidence belongs to the displayed project's declared dependencies.
- Pause media yourself before a task. Confirm Interlude never starts it automatically. Test a rapid new prompt during a return.
- Turn off Interlude, then press Play manually. Confirm the autoplay hold has been released.
- Disconnect/reconnect, reload the selected page, close it, and restart the companion. Confirm clear recovery guidance and disabled monitoring on startup.
- Repeat with maximize off/on, minimized Codex, denied OS focus/Accessibility permissions, and a second monitor if available.

Other registered services are experimental targets. Test one at a time and record the browser, OS, page type, login state, whether playback actually stops, and whether resumption respects manual pauses. Do not describe a service as verified based only on its registration.

## Report a problem

Use **Connection details → Check setup → Copy debug summary**. The summary excludes pairing codes, project paths, chat IDs, prompts, and tab titles. Review any screenshot before sharing it. Report through the private repository's bug form if you have access, or send the owner the summary and these details:

1. OS/browser version and media service.
2. Exact steps and expected/actual result.
3. Whether the problem repeats and whether media actually stopped.
4. Single/dual monitor, Codex window count, and relevant permission state.

Stop testing and turn off Interlude for unexpected playback, wrong-window actions, or persistent autoplay holds. Use **Release playback** in the extension/page to recover. Report these before inviting more testers.

## Update, rollback, uninstall

Stop the companion before replacing its files. Run `npm ci` again, start it, reload the unpacked extension and media page, select the tab again, and run Check setup. Pairing remains in local user app data. Moving the installation requires removing the old hooks before installing from the new folder.

To roll back, stop the companion and restore the previous source/extension together. To uninstall, turn off Interlude, run `npm run hooks:remove`, remove the extension, and stop the terminal process. The README explains how to remove the private pairing file. Other Codex hooks are preserved.

## Release boundary

This is a technical private beta, not a general public launch. Broad paid-service validation, actual Mac Accessibility/Spaces/multi-monitor tests, exact-chat navigation, signed installers, notarization, and store distribution remain outside the verified release. The demonstration video uses the real app, extension, hook emitter, and generated media; Codex events are synthetic and native activation is mocked, as labelled in the video.
