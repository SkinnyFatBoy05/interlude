import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { createCompanion, sameToken } from '../src/server.mjs';
import { ROOT } from '../src/config.mjs';
import { sanitizeHook } from '../src/events.mjs';

const token = 'a'.repeat(64);
async function appFor(t, options = {}) { const app = await createCompanion({ port: 0, token, nativeFocus: async () => ({ focused: true }), ...options }); t.after(() => app.close()); return app; }
function waitMessage(ws, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { ws.off('message', listener); reject(new Error('Message timeout')); }, 3500);
    const listener = raw => { const message = JSON.parse(raw.toString()); if (predicate(message)) { clearTimeout(timeout); ws.off('message', listener); resolve(message); } };
    ws.on('message', listener);
  });
}
async function client(app, role, options = {}) {
  const ws = new WebSocket(app.origin.replace('http:', 'ws:') + '/bridge', { origin: role === 'dashboard' ? app.origin : 'chrome-extension://' + 'a'.repeat(32), ...options });
  await once(ws, 'open'); const ready = waitMessage(ws, m => m.type === 'ready'); ws.send(JSON.stringify({ type: 'hello', role, token })); await ready; return ws;
}
async function post(app, event, auth = token, headers = {}) {
  return fetch(app.origin + '/api/hook', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}`, ...headers }, body: JSON.stringify(event) });
}
function event(name, fields = {}) { return sanitizeHook({ hook_event_name: name, session_id: 'integration', turn_id: 'turn-1', cwd: ROOT, tool_name: 'Bash', tool_input: {}, ...fields }); }

test('token comparisons safely reject different byte lengths', () => { assert.equal(sameToken('é'.repeat(64), token), false); assert.equal(sameToken(undefined, token), false); assert.equal(sameToken(token, token), true); });
test('bootstrap requires a local same-origin custom request', async t => { const app = await appFor(t); assert.equal((await fetch(app.origin + '/api/bootstrap')).status, 403); assert.equal((await fetch(app.origin + '/api/bootstrap', { headers: { 'X-Interlude-Client': 'dashboard', Origin: 'https://evil.test' } })).status, 403); const response = await fetch(app.origin + '/api/bootstrap', { headers: { 'X-Interlude-Client': 'dashboard' } }); assert.equal(response.status, 200); assert.equal((await response.json()).token, token); });
test('hook receiver requires authentication and valid events', async t => { const app = await appFor(t); assert.equal((await post(app, event('UserPromptSubmit'), 'wrong')).status, 401); assert.equal((await post(app, { bad: 'event' })).status, 400); assert.equal((await post(app, event('UserPromptSubmit'))).status, 200); assert.equal(app.session.state.status, 'running'); });
test('cross-origin hook submissions are denied even with a token', async t => { const app = await appFor(t); assert.equal((await post(app, event('UserPromptSubmit'), token, { Origin: 'https://evil.test' })).status, 403); });
test('oversized request is rejected', async t => { const app = await appFor(t); assert.equal((await post(app, { text: 'x'.repeat(20000) })).status, 413); });
test('request size is bounded in UTF-8 bytes', async t => { const app = await appFor(t); assert.equal((await post(app, { text: 'é'.repeat(9000) })).status, 413); });
test('unpaired WebSockets cannot read task state', async t => { const app = await appFor(t); const ws = new WebSocket(app.origin.replace('http:', 'ws:') + '/bridge', { origin: app.origin }); await once(ws, 'open'); const closed = once(ws, 'close'); ws.send(JSON.stringify({ type: 'hello', role: 'dashboard', token: 'wrong' })); assert.equal((await closed)[0], 1008); });
test('extension clients cannot change settings', async t => { const app = await appFor(t); const extension = await client(app, 'extension'); extension.send(JSON.stringify({ type: 'settings', patch: { enabled: true } })); await delay(30); assert.equal(app.session.state.enabled, false); });
test('demo events never dispatch desktop actions', async t => { let focus = 0; const app = await appFor(t, { nativeFocus: async () => { focus++; return { focused: true }; } }); const dashboard = await client(app, 'dashboard'); const started = waitMessage(dashboard, m => m.state?.demo?.status === 'running'); dashboard.send(JSON.stringify({ type: 'demo', action: 'start' })); await started; const finished = waitMessage(dashboard, m => m.state?.demo?.status === 'complete'); dashboard.send(JSON.stringify({ type: 'demo', action: 'complete' })); await finished; assert.equal(focus, 0); assert.equal(app.session.state.status, 'idle'); });
test('return waits for video pause acknowledgement before native focus', async t => {
  let focused = false;
  const app = await appFor(t, { nativeFocus: async () => { focused = true; return { focused: true }; } });
  const extension = await client(app, 'extension');
  app.session.update({ enabled: true });
  await post(app, event('UserPromptSubmit'));
  const pause = waitMessage(extension, m => m.type === 'command' && m.action === 'pause');
  await post(app, event('Stop'));
  const command = await pause;
  assert.equal(focused, false);
  extension.send(JSON.stringify({ type: 'ack', id: command.id, ok: true }));
  await delay(80); assert.equal(focused, true);
});
test('disarming while waiting for pause acknowledgement cancels the return', async t => {
  let focused = false;
  const app = await appFor(t, { nativeFocus: async () => { focused = true; return { focused: true }; } });
  const extension = await client(app, 'extension');
  app.session.update({ enabled: true }); await post(app, event('UserPromptSubmit'));
  const pause = waitMessage(extension, m => m.type === 'command' && m.action === 'pause');
  await post(app, event('Stop')); const command = await pause;
  app.session.update({ enabled: false });
  extension.send(JSON.stringify({ type: 'ack', id: command.id, ok: true }));
  await delay(80); assert.equal(focused, false);
});
test('Learn mode never invents a successful pause when a tab is not selected', async t => {
  let focused = false;
  const app = await appFor(t, { nativeFocus: async () => { focused = true; return { focused: true }; } });
  const extension = await client(app, 'extension'); app.session.update({ enabled: true, mode: 'learn', minimize: true });
  await post(app, event('UserPromptSubmit')); const paused = waitMessage(extension, m => m.type === 'command' && m.action === 'pause');
  await post(app, event('Stop')); const command = await paused;
  extension.send(JSON.stringify({ type: 'ack', id: command.id, ok: false, message: 'No tab is selected.' }));
  await delay(70); assert.equal(focused, true); assert.match(app.session.state.notice, /No tab is selected/);
});
test('changing mode cancels an in-flight browser command before its acknowledgement', async t => {
  const app = await appFor(t); const extension = await client(app, 'extension'); const dashboard = await client(app, 'dashboard');
  app.session.update({ enabled: true }); const handoff = waitMessage(extension, m => m.type === 'command' && m.action === 'break');
  await post(app, event('UserPromptSubmit')); const first = await handoff;
  const cancelled = waitMessage(extension, m => m.type === 'cancel' && m.id === first.id);
  dashboard.send(JSON.stringify({ type: 'settings', patch: { mode: 'learn' } })); await cancelled;
  const learn = await waitMessage(extension, m => m.type === 'command' && m.action === 'learn');
  extension.send(JSON.stringify({ type: 'ack', id: learn.id, ok: true }));
  extension.send(JSON.stringify({ type: 'ack', id: first.id, ok: false, message: 'Stale error' }));
  await delay(30); assert.doesNotMatch(app.session.state.notice, /Stale error/);
});
test('manual return cancels the pending handoff and aborts older native focus', async t => {
  let focusSignal;
  const app = await appFor(t, { nativeFocus: async ({ signal }) => { focusSignal = signal; return new Promise(resolve => signal.addEventListener('abort', () => resolve({ focused: false }), { once: true })); } });
  const extension = await client(app, 'extension'); const dashboard = await client(app, 'dashboard');
  app.session.update({ enabled: true }); await post(app, event('UserPromptSubmit'));
  const paused = waitMessage(extension, m => m.type === 'command' && m.action === 'pause'); dashboard.send(JSON.stringify({ type: 'return' }));
  const pause = await paused; extension.send(JSON.stringify({ type: 'ack', id: pause.id, ok: true })); await delay(50);
  assert.ok(focusSignal); assert.equal(app.session.state.manualHold, true);
  await post(app, event('UserPromptSubmit', { turn_id: 'turn-2' })); assert.equal(focusSignal.aborted, true);
});
test('browser snapshots preserve readiness separately from selection', async t => {
  const app = await appFor(t); const dashboard = await client(app, 'dashboard'); const extension = await client(app, 'extension');
  const updated = waitMessage(dashboard, m => m.state?.browser?.platform === 'twitch');
  extension.send(JSON.stringify({ type: 'browser', selected: true, mediaReady: false, platform: 'twitch', title: 'Stream', message: 'Loading' }));
  const { state } = await updated; assert.equal(state.browser.selected, true); assert.equal(state.browser.mediaReady, false);
});
test('dashboard diagnostics are read-only and never focus the desktop', async t => {
  let focus = 0, checks = 0;
  const app = await appFor(t, { nativeFocus: async () => { focus++; return { focused: true }; }, nativeDiagnostics: async () => { checks++; return { platform: process.platform, supported: true, helperReady: true, code: 'ready', message: 'Ready', capabilities: { activate: true } }; } });
  const dashboard = await client(app, 'dashboard'); const updated = waitMessage(dashboard, m => m.state?.diagnostics?.code === 'ready');
  dashboard.send(JSON.stringify({ type: 'diagnostics' })); const { state } = await updated;
  assert.ok(state.diagnostics.checkedAt); assert.equal(checks, 1); assert.equal(focus, 0); assert.equal(app.session.state.enabled, false);
});
test('heartbeat removes an unresponsive browser connection', async t => {
  const app = await appFor(t, { heartbeatMs: 60 }); const dashboard = await client(app, 'dashboard');
  const extension = await client(app, 'extension', { autoPong: false });
  const disconnected = waitMessage(dashboard, m => m.state?.browser?.connected === false && /disconnected/i.test(m.state.browser.message));
  await disconnected; assert.equal(extension.readyState, WebSocket.CLOSED);
});
test('selecting media after reconnection recovers a running handoff', async t => {
  const app = await appFor(t); const dashboard = await client(app, 'dashboard'); app.session.update({ enabled: true });
  await post(app, event('UserPromptSubmit')); app.session.pending.due = 0;
  await waitMessage(dashboard, m => /Connect the browser extension/.test(m.state?.notice ?? ''));
  const extension = await client(app, 'extension'); const handoff = waitMessage(extension, m => m.type === 'command' && m.action === 'break');
  extension.send(JSON.stringify({ type: 'browser', selected: true, mediaReady: true, platform: 'youtube' }));
  const command = await handoff; extension.send(JSON.stringify({ type: 'ack', id: command.id, ok: true }));
});
test('disarming pauses then releases the browser playback guard', async t => {
  const app = await appFor(t); const extension = await client(app, 'extension'); const dashboard = await client(app, 'dashboard');
  app.session.update({ enabled: true }); const paused = waitMessage(extension, m => m.type === 'command' && m.action === 'pause');
  dashboard.send(JSON.stringify({ type: 'settings', patch: { enabled: false } })); const pause = await paused;
  const released = waitMessage(extension, m => m.type === 'command' && m.action === 'release');
  extension.send(JSON.stringify({ type: 'ack', id: pause.id, ok: true })); const release = await released;
  extension.send(JSON.stringify({ type: 'ack', id: release.id, ok: true }));
});
test('extension origins cannot impersonate the dashboard even with its token', async t => {
  const app = await appFor(t); const ws = new WebSocket(app.origin.replace('http:', 'ws:') + '/bridge', { origin: 'chrome-extension://' + 'b'.repeat(32) });
  await once(ws, 'open'); const closed = once(ws, 'close'); ws.send(JSON.stringify({ type: 'hello', role: 'dashboard', token }));
  assert.equal((await closed)[0], 1008);
});
test('extensions receive commands but never project snapshots or diagnostics', async t => {
  let checks = 0;
  const app = await appFor(t, { nativeDiagnostics: async () => { checks++; return {}; } }); const extension = await client(app, 'extension');
  const received = []; extension.on('message', raw => received.push(JSON.parse(raw)));
  extension.send(JSON.stringify({ type: 'diagnostics' })); await post(app, event('UserPromptSubmit')); await delay(50);
  assert.equal(checks, 0); assert.equal(received.some(message => message.type === 'state' || message.state), false);
});
test('invalid JSON settings cannot mutate the session', async t => {
  const app = await appFor(t); const dashboard = await client(app, 'dashboard');
  for (const patch of [null, [], 4]) {
    const rejected = waitMessage(dashboard, m => m.type === 'error'); dashboard.send(JSON.stringify({ type: 'settings', patch })); await rejected;
    assert.equal(app.session.state.enabled, false);
  }
});
test('hook receiver requires JSON content type', async t => {
  const app = await appFor(t); assert.equal((await post(app, event('UserPromptSubmit'), token, { 'Content-Type': 'text/plain' })).status, 415);
});
