# Interlude 0.5.0 — private tester guide

Start with one assistant and one YouTube tab. Allow 15 minutes. This is an experimental preview for a small group of invited testers. The purpose is to find compatibility problems on real accounts and computers.

No Interlude account, API key, Node.js or compiler is needed. Your usual Claude/Codex account is still required. Use a current Chrome, Brave or Edge on Windows or macOS (Chromium 120+). Safari, Firefox, phones and native entertainment apps are outside this test.

## Pick your connection

- Claude or Codex WEBSITE: use the browser package. No Interlude desktop app is needed.
- Codex DESKTOP or local Claude Code: use the package for your computer, with the local companion and passive hooks.
- Ordinary Claude desktop Chat/Cowork: use the desktop package's experimental observer. Keep one Claude window open and the intended task selected. Hidden chats cannot be followed.

The Windows app is unsigned; Mac builds are ad-hoc signed and are not notarized. Your computer may block installation. If it does, report the exact message and use website mode for now. Do not disable antivirus, SmartScreen or Gatekeeper, remove quarantine attributes, or change PowerShell execution policy for this test. Clean-machine installation is one of the things being tested.

## A. Connect a website

1. Extract the entire ZIP into a permanent local folder. Keep it there while testing; loading the extension directly from a ZIP will not work. Avoid a shared/cloud-sync folder.
2. Open chrome://extensions, brave://extensions or edge://extensions in your browser's address bar. Enable Developer mode, choose Load unpacked, and select the extracted extension folder (the folder containing manifest.json). The path belongs to YOUR computer.
3. Open a YouTube video, then open Interlude from the browser's Extensions menu. Under Your media tab select the video and click Use this tab.
4. Open a signed-in Claude chat, Claude Code web task, or Codex web task-detail page. Ordinary ChatGPT chats are not included. In Interlude choose Your AI website tab → Watch this AI tab and allow access to that site.
5. Choose Fun mode, click Turn on website monitoring, play the video yourself, and send a prompt in the watched AI tab. Keep that tab open. Very short responses may finish before a break starts.

A “Companion offline” or “Disconnected” message concerns DESKTOP mode; website monitoring can still work. Watch the website status above it. Site controls must be in English for this preview. If the status stays idle/unknown, record the page type and status; do not assume the task completed.

## B. Connect desktop apps

1. Quit any older Interlude app or terminal companion. Only one companion can use port 4318. Keep only one installation's extension loaded in each browser.
2. Windows: run the included Interlude-0.5.0-win-x64.exe installer. Mac: open the included DMG and copy Interlude to Applications before opening it. Use the ARM64 package for an Apple chip and X64 for Intel (Apple menu → About This Mac). Windows ARM is not a tested target.
3. In Interlude choose Connect browser → Open extension folder. Load that folder in your browser as in step A2, then choose your YouTube tab in the extension. It pairs automatically; no connection code is needed. Keep website monitoring OFF while testing desktop mode.
4. For Codex: click Connect Codex, review/trust the Interlude hooks in Codex CLI /hooks, and begin a fresh local task. Hooks cover all local Codex projects.
5. For Claude Code: expand Claude desktop → Connect Claude Code, review Claude Code /hooks, and start a new Code session. Hooks cover local Code sessions, not remote web tasks. CLI-only users return manually; automatic native return targets the Claude desktop window.
6. For ordinary Claude Chat/Cowork: with monitoring OFF, expand Claude desktop and enable Observe Claude Chat/Cowork. Keep the intended task selected. This replaces Claude Code hook monitoring until switched off. macOS observation needs the OS Accessibility grant to the Interlude helper; report permission/setup failures rather than assuming detection works.
7. Turn on Interlude, play your video yourself, then send a harmless prompt. Codex/Claude tasks and approvals remain under your control. Interlude never approves a request or answers a question.

The app starts disarmed. Closing its window leaves it in the tray/menu bar; use Quit Interlude to stop it. Sleep or screen lock disarms desktop monitoring. Website monitoring is separate: turn it off in the extension when you finish.

## First session: record PASS / FAIL / NOT TESTED

Use a disposable task without confidential content or destructive actions. A sample prompt is: “Explain how a browser request reaches a server and database, with a small example.” Normal AI usage limits still apply.

1. Setup: extension loads, the chosen media tab is visible, and the correct assistant shows working after a prompt. Record time/setup errors.
2. Completion: let a response finish. Confirm playback and sound actually stop. Website mode should select the originating AI tab; desktop mode should bring the assistant window forward or report an OS focus limitation.
3. Another prompt: start a second response. Only the media Interlude paused should resume. A manually paused video must stay paused.
4. Permission/question: if a legitimate approval or supported question occurs, confirm playback pauses. Resolve it YOURSELF. Confirm the break can resume when work continues. Do not create a dangerous command just to trigger this test; mark NOT TESTED if unavailable.
5. Locked-in mode: change mode and start a task. A lesson should appear and its answer should expand. Website/Chat observation shows general lessons; local Code hooks can show declared project dependencies, not private AI reasoning.
6. Recovery: turn monitoring OFF and use Release playback if shown. Press Play manually and confirm it stays playing. Close/reopen the selected media tab and select it again.
7. Desktop only: quit/reopen Interlude and confirm monitoring is OFF. If you use two displays, repeat completion there and record which window came forward.

After these pass, try a second simultaneous task, task navigation/cancellation and one other media service. Record each assistant/surface/browser/service combination separately. Registered media services are compatibility targets, not verified support promises.

## Stop and recover

If media starts unexpectedly, the wrong window activates, or playback stays held: turn website monitoring OFF in the extension and desktop monitoring OFF in Interlude. Click Release playback in the extension or media page. If the hold persists, disable Interlude in the browser's extension manager and reload the media tab. Stop the test and report it before resuming automatic monitoring.

Never interpret silence or an absent Stop button as success. Missing task controls/heartbeats can pause media and display an unknown-state notice. Claude desktop observation cannot reliably identify a switch between hidden chats; keep the intended task selected.

## Feedback and privacy

Fill in FEEDBACK.txt and return it to the person who sent this package. No GitHub account is needed for that. Desktop users can add Connection details → Check setup → Copy debug summary. Website-only users can copy the website status text and list their PASS/FAIL results. Review screenshots before sharing; exclude prompts, conversation text, credentials, pairing files and private paths. Collection is local; details are in PRIVACY.md.

## Update or remove

Website: turn monitoring off, click Release playback, replace the extension files in the same folder, reload Interlude in the extension manager, reload the AI/media tabs and select/watch them again. Removing the extension and reloading those tabs ends website observation.

Desktop: turn monitoring off and quit the app before upgrading in the SAME location. Reload its extension afterward. Before moving/uninstalling, use Disconnect Codex and/or Disconnect Claude Code for whichever you connected, disable Launch at login, and quit from the tray/menu bar. Remove the browser extension. Windows uninstall also attempts to remove this installation's hooks. On Mac then move the app to Trash. Other apps' hooks/settings should remain intact. Keep the previous package if you need to roll back; disconnect hooks before changing installation locations.

## What is verified

Build 4da4458323308d8f073ffaa96d4bb49e1fde5f9e passed all ten CI jobs: Node tests across Windows/macOS/Linux; Chromium fixture flows; and packaged Windows, Apple Silicon and Intel Mac runtime checks. Fixtures verified work → approval pause → resume → completion → exact website-tab return. They do not establish actual signed-in website compatibility.

Still to be established by testing: live Claude/Codex website control detection, actual Claude Chat/Cowork accessibility trees, clean-machine install/upgrade/uninstall, Mac Accessibility/Spaces/multiple displays, and each proprietary player. This package is ready for guided compatibility testing, not a public launch.
