import { supportSummary } from '/support.js';
const $ = id => document.getElementById(id);
let state;
let token;
let socket;
let concept = 0;
let revealed = false;
let lessonKey = '';
let reconnect;
let toastTimer;
let connecting = false;
let diagnosticTimer;
let diagnosticRequestedAt = 0;
let bridgeReady = false;
const desktop = window.interludeDesktop;
let desktopState;
const connectedControls = ['fun-mode', 'learn-mode', 'toggle', 'return', 'acknowledge', 'demo-start', 'demo-close', 'autoReturn', 'maximize', 'resume', 'minimize', 'check-setup', 'next', 'previous', 'reveal'];
function connectionReady(ready) {
  bridgeReady = ready;
  $('connection-dot').classList.toggle('online', ready);
  for (const id of connectedControls) $(id).disabled = !ready;
  for (const button of document.querySelectorAll('[data-demo]')) button.disabled = !ready;
}
const platformNames = { youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', x: 'X', reddit: 'Reddit', twitch: 'Twitch', vimeo: 'Vimeo', netflix: 'Netflix', 'prime-video': 'Prime Video', 'disney-plus': 'Disney+', hulu: 'Hulu', max: 'Max', 'apple-tv': 'Apple TV', peacock: 'Peacock', 'paramount-plus': 'Paramount+', spotify: 'Spotify', 'apple-music': 'Apple Music', soundcloud: 'SoundCloud' };

function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4500); }
function send(message) {
  if (!bridgeReady || socket?.readyState !== WebSocket.OPEN) { toast('The local companion is disconnected.'); return; }
  socket.send(JSON.stringify(message));
}

const copy = {
  idle: ['Ready when you are', 'Your next prompt starts the loop.', 'Choose a media tab, then turn on Interlude.'],
  running: ['Codex is working', 'This moment is yours.', 'Enjoy your selected video. We’ll bring you back when your attention is needed.'],
  stopping: ['Wrapping up', 'A moment to make sure.', 'Checking that Codex has finished this response before bringing you back.'],
  permission: ['Your attention is needed', 'A decision is waiting.', 'Codex requested permission. Review the request in Codex before it continues.'],
  input: ['Your attention is needed', 'Codex has a question.', 'Your answer can guide what happens next. Return to the task to respond.'],
  complete: ['Time to come back', 'Your response is ready.', 'Review what Codex changed and decide your next step.'],
  interrupted: ['Turn stopped', 'Take it from here.', 'You interrupted this turn. A new prompt starts the next loop.'],
  disconnected: ['Codex session ended', 'We’ve paused the handoff.', 'Open your task in Codex and send a new prompt when you are ready.'],
};

function render() {
  if (!state) return;
  const view = state.demo ?? state;
  const learning = state.mode === 'learn';
  const isDemo = Boolean(state.demo);
  $('fun-mode').classList.toggle('selected', !learning);
  $('learn-mode').classList.toggle('selected', learning);
  $('fun-mode').setAttribute('aria-pressed', String(!learning));
  $('learn-mode').setAttribute('aria-pressed', String(learning));
  $('mode-description').textContent = learning ? 'Stay with your project. Learn the concepts behind the tools and files Codex is working with.' : 'Your video picks up while Codex works. We bring you back when it needs you.';
  const text = [...(copy[view.status] ?? copy.idle)];
  if (learning && view.status === 'running') { text[1] = 'Build your understanding.'; text[2] = 'Explore a concept from your project while Codex keeps working.'; }
  if (learning && state.desktop && view.status === 'idle') text[2] = 'Connect Codex, then turn on Interlude. A media tab is optional in Locked-in mode.';
  if (view.status === 'idle' && state.enabled) { text[0] = 'Interlude is on'; text[2] = 'Send your next prompt in Codex. The handoff begins after a short pause.'; }
  $('status-label').textContent = text[0]; $('status-title').textContent = text[1]; $('status-description').textContent = text[2];
  $('status-panel').dataset.state = view.status;
  document.body.dataset.mode = learning ? 'learn' : 'fun';
  $('status-dot').classList.toggle('running', view.status === 'running');
  $('status-panel').classList.toggle('attention', ['permission', 'input', 'complete'].includes(view.status));
  $('toggle').textContent = state.enabled ? 'Turn off Interlude' : 'Turn on Interlude';
  $('toggle').hidden = isDemo;
  $('return').hidden = isDemo || !state.enabled || view.status === 'idle';
  $('demo-banner').hidden = !isDemo; $('demo-controls').hidden = !isDemo;
  $('demo-start').textContent = isDemo ? 'Restart demo' : 'Try a demo';
  $('codex-status').textContent = state.hookSeenAt ? 'Hooks detected' : 'Waiting for a prompt';
  $('chat-status').textContent = isDemo ? 'Beta · Demo events only' : `Beta · All local Codex projects · ${state.runningCount ?? 0} working · ${state.attentionCount ?? 0} awaiting acknowledgement`;
  $('acknowledge').hidden = isDemo || !state.attentionCount;
  $('task-rail').hidden = isDemo || !state.sessionCount;
  $('chat-list').hidden = isDemo || !state.sessionCount;
  $('chat-list').replaceChildren();
  for (const task of state.tasks ?? []) {
    const row = document.createElement('li');
    row.textContent = `${task.project} · ${task.id.slice(0, 8)} · ${task.status}${task.needsAttention ? ' — needs you' : ''}`;
    $('chat-list').append(row);
  }
  $('media-name').textContent = platformNames[state.browser.platform] || 'Media';
  $('media-status').textContent = state.browser.selected ? state.browser.mediaReady ? 'Ready to play' : 'Player not ready' : state.browser.connected ? 'Choose a tab' : 'Not connected';
  $('media-status').title = state.browser.title || state.browser.message;
  $('media-message').textContent = state.browser.message || '';
  $('media-message').hidden = !state.browser.connected || state.browser.mediaReady || !state.browser.message;
  $('connect-browser').textContent = state.browser.connected ? 'Browser setup' : 'Connect browser';
  for (const key of ['autoReturn', 'maximize', 'resume', 'minimize']) $(key).checked = state[key];
  $('scope').textContent = `Watching all local Codex projects. Current project: ${state.activeProject ?? state.scope}. Returns open the Codex window, not an individual chat.`;
  $('extension-path').textContent = state.scope.replace(/[\\/]$/, '') + (state.platform === 'win32' ? '\\' : '/') + 'extension';
  const npm = state.platform === 'win32' ? 'npm.cmd' : 'npm';
  $('hook-commands').replaceChildren(document.createTextNode(`${npm} run hooks:preview`), document.createElement('br'), document.createTextNode(`${npm} run hooks:install`));
  $('platform-notice').textContent = state.platform === 'darwin'
    ? 'macOS controls app activation; resizing may need Accessibility permission.'
    : state.platform === 'win32' ? 'Windows may keep your current window in front; Interlude then requests attention in the taskbar.'
      : 'Automatic desktop return is available on Windows and macOS.';
  if (state.diagnostics?.checkedAt && state.diagnostics.checkedAt >= diagnosticRequestedAt) {
    clearTimeout(diagnosticTimer);
    $('check-setup').disabled = !bridgeReady;
    $('diagnostic-status').textContent = state.diagnostics.message || 'Setup check finished.';
  }
  $('lesson').hidden = !learning;
  const lessons = state.lessons ?? [];
  concept = Math.max(0, Math.min(concept, lessons.length - 1));
  const item = lessons[concept];
  if (item && learning) {
    if (lessonKey !== item.title) { revealed = false; lessonKey = item.title; }
    $('lesson-kind').textContent = item.kind;
    $('lesson-count').textContent = `${concept + 1} / ${lessons.length}`;
    for (const key of ['title', 'body', 'evidence', 'question', 'answer']) $(`lesson-${key}`).textContent = item[key];
    $('lesson-answer').hidden = !revealed;
    $('reveal').textContent = revealed ? 'Hide answer' : 'Reveal answer';
    $('previous').disabled = !bridgeReady || lessons.length < 2; $('next').disabled = !bridgeReady || lessons.length < 2;
  }
  $('activity-section').hidden = !view.activity.length;
  $('activity').replaceChildren();
  for (const activity of view.activity) {
    const row = document.createElement('li');
    const time = document.createElement('time'); time.dateTime = new Date(activity.at).toISOString(); time.textContent = new Date(activity.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const text = document.createElement('span'); text.textContent = activity.label;
    for (const file of activity.files) { const code = document.createElement('code'); code.textContent = file; text.append(code); }
    row.append(time, text); $('activity').append(row);
  }
  const notice = state.notice || (state.enabled && !state.browser.connected && !(state.desktop && learning) ? 'The browser is disconnected. Connect it before your next prompt.' : '');
  $('notice').textContent = notice; $('notice').hidden = !notice;
  updateElapsed();
}

function updateElapsed() {
  const current = state?.demo ?? state;
  const seconds = current?.startedAt && current.status === 'running' ? Math.floor((Date.now() - current.startedAt) / 1000) : null;
  $('elapsed').textContent = seconds === null ? '' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

async function connect() {
  if (connecting || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  connecting = true;
  clearTimeout(reconnect);
  try {
    const response = await fetch('/api/bootstrap', { headers: { 'X-Interlude-Client': 'dashboard' } });
    if (!response.ok) throw new Error('Connection failed');
    const data = await response.json(); token = data.token; state = data.state; render();
    const current = new WebSocket(`ws://${location.host}/bridge`);
    socket = current;
    current.onopen = () => current.send(JSON.stringify({ type: 'hello', role: 'dashboard', token }));
    current.onmessage = event => {
      if (socket !== current) return;
      let message;
      try { message = JSON.parse(event.data); } catch { toast('Received an invalid companion response.'); return; }
      if (message.type === 'ready') { connectionReady(true); render(); }
      if (message.type === 'state') { state = message.state; render(); }
      if (message.type === 'error') { clearTimeout(diagnosticTimer); $('check-setup').disabled = !bridgeReady; toast(message.message); }
    };
    current.onclose = () => { if (socket !== current) return; socket = null; clearTimeout(diagnosticTimer); connectionReady(false); $('notice').textContent = 'Companion offline. Restart Interlude to reconnect.'; $('notice').hidden = false; clearTimeout(reconnect); reconnect = setTimeout(connect, 3000); };
    current.onerror = () => {};
  } catch { $('notice').textContent = desktop ? 'Could not connect. Quit and reopen Interlude.' : 'Could not connect. Start the companion with npm start.'; $('notice').hidden = false; clearTimeout(reconnect); reconnect = setTimeout(connect, 3000); }
  finally { connecting = false; }
}

$('fun-mode').addEventListener('click', () => send({ type: 'settings', patch: { mode: 'fun' } }));
$('learn-mode').addEventListener('click', () => send({ type: 'settings', patch: { mode: 'learn' } }));
$('toggle').addEventListener('click', () => {
  if (!state || !bridgeReady) return;
  if (!state.enabled && !state.browser.connected && !(state.desktop && state.mode === 'learn')) { $('setup-dialog').showModal(); toast('Connect the browser to enable automatic handoffs.'); return; }
  if (!state.enabled && state.mode === 'fun' && !state.browser.selected) { toast('Choose a media tab in the Interlude extension first.'); return; }
  if (!state.enabled && state.mode === 'fun' && !state.browser.mediaReady) { toast(state.browser.message || 'Open a playable video or audio item in your selected tab first.'); return; }
  send({ type: 'settings', patch: { enabled: !state.enabled } });
});
for (const key of ['autoReturn', 'maximize', 'resume', 'minimize']) $(key).addEventListener('change', () => send({ type: 'settings', patch: { [key]: $(key).checked } }));
for (const id of ['connect-browser', 'hook-setup']) $(id).addEventListener('click', () => $('setup-dialog').showModal());
$('check-setup').addEventListener('click', () => {
  if (socket?.readyState !== WebSocket.OPEN) { toast('Connect the local companion first.'); return; }
  $('check-setup').disabled = true;
  diagnosticRequestedAt = Date.now();
  $('diagnostic-status').textContent = 'Checking the desktop helper…';
  send({ type: 'diagnostics' });
  clearTimeout(diagnosticTimer);
  diagnosticTimer = setTimeout(() => { $('check-setup').disabled = !bridgeReady; $('diagnostic-status').textContent = 'The check did not finish. Try again after restarting the companion.'; }, 15000);
});
$('demo-start').addEventListener('click', () => send({ type: 'demo', action: 'start' }));
$('demo-close').addEventListener('click', () => send({ type: 'demo', action: 'close' }));
for (const button of document.querySelectorAll('[data-demo]')) button.addEventListener('click', () => send({ type: 'demo', action: button.dataset.demo }));
$('return').addEventListener('click', () => send({ type: 'return' }));
$('acknowledge').addEventListener('click', () => send({ type: 'acknowledge' }));
$('copy-support').addEventListener('click', async () => {
  if (!state) return;
  try {
    if (desktop) await desktop.copySupport();
    else await navigator.clipboard.writeText(JSON.stringify(supportSummary(state), null, 2));
    $('support-status').textContent = 'Copied. No pairing code, project paths, tab titles, prompts, or chat IDs are included.';
  }
  catch { $('support-status').textContent = 'Clipboard access was denied. Try opening Interlude in your browser.'; }
});
$('reveal').addEventListener('click', () => { revealed = !revealed; render(); });
$('next').addEventListener('click', () => { if (state.lessons.length) concept = (concept + 1) % state.lessons.length; render(); });
$('previous').addEventListener('click', () => { if (state.lessons.length) concept = (concept + state.lessons.length - 1) % state.lessons.length; render(); });
setInterval(updateElapsed, 1000);
function renderDesktop(value) {
  desktopState = value;
  $('desktop-settings').hidden = false;
  $('desktop-hook-setup').hidden = false;
  $('source-hook-setup').hidden = true;
  $('open-extension-folder').hidden = false;
  $('extension-path').textContent = value.extensionPath;
  $('launch-at-login').checked = value.openAtLogin;
  $('launch-at-login').disabled = !value.packaged;
  $('install-desktop-hooks').textContent = value.hooksInstalled ? 'Reconnect Codex' : 'Connect Codex';
  $('remove-desktop-hooks').hidden = !value.hooksInstalled;
  $('desktop-setup-status').textContent = value.hooksInstalled ? 'Hooks installed. Review and trust them in Codex /hooks.' : 'Connect to install the passive event hooks. Your existing hooks are preserved.';
}
async function desktopAction(method, value) {
  const buttons = ['install-desktop-hooks', 'remove-desktop-hooks', 'open-extension-folder', 'check-updates'];
  buttons.forEach(id => $(id).disabled = true);
  try { renderDesktop(await desktop[method](value)); }
  catch (error) { toast(error.message || 'Desktop setup could not finish.'); if (desktopState) $('launch-at-login').checked = desktopState.openAtLogin; }
  finally { buttons.forEach(id => $(id).disabled = false); }
}
if (desktop) {
  desktop.status().then(renderDesktop).catch(() => toast('Codex setup could not be read. Check your hooks configuration.'));
  $('install-desktop-hooks').addEventListener('click', () => desktopAction('installHooks'));
  $('remove-desktop-hooks').addEventListener('click', () => desktopAction('removeHooks'));
  $('open-extension-folder').addEventListener('click', () => desktopAction('openExtension'));
  $('launch-at-login').addEventListener('change', () => desktopAction('setLogin', $('launch-at-login').checked));
  $('check-updates').addEventListener('click', () => desktopAction('updates'));
}
connectionReady(false);
connect();
