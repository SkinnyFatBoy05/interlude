import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { SITE_MATCHES, DEFAULT_MATCHES, platformFor, permissionFor } from '../extension/platforms.js';

const code = (await readFile(new URL('../extension/background.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
const flush = async () => { for (let count = 0; count < 8; count++) await new Promise(resolve => setImmediate(resolve)); };
function event() { const listeners = []; return { addListener(fn) { listeners.push(fn); }, emit(...args) { let handled = false; for (const fn of listeners) if (fn(...args) === true) handled = true; return handled; } }; }
async function background(t, { selected = 12, url = 'https://www.youtube.com/watch?v=one', mediaReady = false, failure = false, perform } = {}) {
  const local = { token: 'a'.repeat(64) }; const session = { selection: selected ? { tabId: selected } : {} };
  const tabs = new Map([[12, { id: 12, windowId: 8, url, title: 'Chosen media' }]]);
  const messages = []; const sockets = []; const actions = []; const injected = []; const timers = new Set();
  const area = data => ({ get: async key => ({ [key]: structuredClone(data[key]) }), set: async values => Object.assign(data, structuredClone(values)), remove: async key => { delete data[key]; }, setAccessLevel: async () => {} });
  const chrome = {
    storage: { local: area(local), session: area(session) },
    tabs: { get: async id => { if (!tabs.has(id)) throw new Error('Closed.'); return { ...tabs.get(id) }; }, query: async () => [...tabs.values()], onRemoved: event(), onUpdated: event() },
    runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}`, onMessage: event(), onStartup: event() },
    permissions: { getAll: async () => ({ origins: DEFAULT_MATCHES }), contains: async () => true, onAdded: event(), onRemoved: event() },
    scripting: { unregisterContentScripts: async () => {}, registerContentScripts: async () => {}, executeScript: async spec => { injected.push(spec); } },
    webNavigation: { getAllFrames: async ({ tabId }) => [{ frameId: 0, url: tabs.get(tabId)?.url }] },
    alarms: { create: () => {}, onAlarm: event() },
  };
  class Socket {
    static OPEN = 1; static CONNECTING = 0;
    constructor() { this.readyState = 0; sockets.push(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
    send(raw) { const message = JSON.parse(raw); messages.push(message); if (message.type === 'hello') queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'ready' }) })); }
    close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
    receive(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
  }
  const context = { chrome, WebSocket: Socket, AbortController, SITE_MATCHES, DEFAULT_MATCHES, platformFor, permissionFor,
    performAction: async (_chrome, selection, action, options = {}) => { actions.push({ selection: { ...selection }, action, options }); return perform ? perform(action, options) : { ok: !failure, mediaReady, message: failure ? 'Player unreachable.' : 'Player status.' }; },
    setTimeout(fn, ms) { const timer = setTimeout(fn, ms); timer.unref(); timers.add(timer); return timer; }, clearTimeout,
    setInterval(fn, ms) { const timer = setInterval(fn, ms); timer.unref(); timers.add(timer); return timer; }, clearInterval,
  };
  vm.runInNewContext(code, context);
  t.after(() => { for (const timer of timers) { clearTimeout(timer); clearInterval(timer); } });
  await flush();
  return { chrome, tabs, messages, actions, session, local, injected, sockets,
    command(message) { sockets.at(-1).receive(message); },
    request(message, sender = { id: 'test', url: 'chrome-extension://test/popup.html' }) {
      return new Promise(resolve => {
        const handled = chrome.runtime.onMessage.emit(message, sender, resolve);
        if (!handled) resolve(undefined);
      });
    },
  };
}

test('a selected text-only feed remains selected while mediaReady is false', async t => {
  const h = await background(t, { url: 'https://www.instagram.com/', mediaReady: false });
  const result = await h.request({ type: 'status' });
  assert.equal(result.state.selected, true); assert.equal(result.state.mediaReady, false); assert.equal(result.state.platform, 'instagram');
  assert.ok(h.messages.some(message => message.type === 'browser' && message.selected && !message.mediaReady));
});
test('the exact extension popup can pair when opened in an ordinary browser tab', async t => {
  const h = await background(t, { selected: null });
  const sender = { id: 'test', url: 'chrome-extension://test/popup.html', tab: { id: 77, url: 'chrome-extension://test/popup.html' }, frameId: 0 };
  const before = await h.request({ type: 'status' }, sender);
  assert.equal(before?.ok, true);
  const paired = await h.request({ type: 'pair', token: 'b'.repeat(64) }, sender);
  assert.equal(paired?.ok, true); assert.equal(h.local.token, 'b'.repeat(64));
  await flush();
  assert.ok(h.messages.some(message => message.type === 'hello' && message.token === 'b'.repeat(64)));
});
test('content scripts, foreign extensions and deceptive popup URLs cannot pair', async t => {
  const h = await background(t);
  const senders = [
    { id: 'test', url: 'https://www.youtube.com/watch?v=one', tab: { id: 12 } },
    { id: 'other-extension', url: 'chrome-extension://test/popup.html', tab: { id: 77 } },
    { id: 'test', url: 'chrome-extension://test/popup.html.evil', tab: { id: 77 } },
    { id: 'test', url: 'chrome-extension://test/popup.html?spoof', tab: { id: 77 } },
    { id: 'test', url: 'chrome-extension://other-extension/popup.html', tab: { id: 77 } },
    { id: 'test', tab: { id: 77 } },
  ];
  for (const sender of senders) assert.equal(await h.request({ type: 'pair', token: 'b'.repeat(64) }, sender), undefined);
  assert.equal(h.local.token, 'a'.repeat(64));
});
test('an inaccessible player does not silently clear the selected tab', async t => {
  const h = await background(t, { failure: true }); const result = await h.request({ type: 'status' });
  assert.equal(result.state.selected, true); assert.equal(result.state.mediaReady, false); assert.equal(h.session.selection.tabId, 12);
});
test('leaving the allowlist clears selection and reports that transition', async t => {
  const h = await background(t); h.tabs.get(12).url = 'https://example.com/'; h.chrome.tabs.onUpdated.emit(12, { url: 'https://example.com/' }); await flush();
  assert.equal(h.session.selection.tabId, undefined);
  assert.ok(h.messages.some(message => message.type === 'browser' && message.selected === false));
});
test('selection injects the media adapter into an already-open permitted tab', async t => {
  const h = await background(t, { selected: null }); const result = await h.request({ type: 'select', tabId: 12 });
  assert.equal(result.ok, true); assert.equal(h.session.selection.tabId, 12); assert.equal(h.injected[0].target.tabId, 12); assert.deepEqual(Array.from(h.injected[0].target.frameIds), [0]);
});
test('pause persists the gate; release clears it without issuing resume', async t => {
  const h = await background(t); h.command({ type: 'command', id: 'p1', action: 'pause' }); await flush(); assert.equal(h.session.selection.gate, true);
  h.command({ type: 'command', id: 'r1', action: 'release' }); await flush(); assert.equal(h.session.selection.gate, false);
  assert.equal(h.actions.filter(item => item.action === 'break' || item.action === 'resume').length, 0);
});
test('reload bootstrap only grants a gate to the selected tab', async t => {
  const h = await background(t); h.command({ type: 'command', id: 'p1', action: 'pause' }); await flush();
  const selected = await h.request({ type: 'media-bootstrap' }, { id: 'test', url: h.tabs.get(12).url, tab: { id: 12 } });
  const other = await h.request({ type: 'media-bootstrap' }, { id: 'test', url: h.tabs.get(12).url, tab: { id: 77 } });
  assert.equal(selected.gate, true); assert.equal(other.gate, false);
});
test('the in-page release button clears persistent selection gate', async t => {
  const h = await background(t); h.command({ type: 'command', id: 'p1', action: 'pause' }); await flush();
  const result = await h.request({ type: 'media-release' }, { id: 'test', url: h.tabs.get(12).url, tab: { id: 12 } });
  assert.equal(result.ok, true); assert.equal(h.session.selection.gate, false);
});
test('completed command retries replay their acknowledgment without repeating the action', async t => {
  const h = await background(t); const command = { type: 'command', id: 'p1', action: 'pause' };
  h.command(command); await flush(); h.command(command); await flush();
  assert.equal(h.actions.filter(item => item.action === 'pause').length, 1); assert.equal(h.messages.filter(message => message.type === 'ack' && message.id === 'p1').length, 2);
});
test('cancellation aborts an in-flight break and restores the gate', async t => {
  const h = await background(t, { perform: (action, options) => action === 'break' ? new Promise(resolve => options.signal.addEventListener('abort', () => resolve({ ok: false }), { once: true })) : { ok: true, mediaReady: true } });
  h.command({ type: 'command', id: 'b1', action: 'break', resume: true }); await flush(); h.command({ type: 'cancel', id: 'b1' }); await flush();
  assert.equal(h.session.selection.gate, true); assert.ok(h.actions.some(item => item.action === 'cancel'));
  assert.equal(h.messages.filter(message => message.type === 'ack' && message.id === 'b1').length, 0);
});
test('cancelling a pending pause passes its original action and keeps the gate active', async t => {
  const h = await background(t, { perform: (action, options) => action === 'pause' ? new Promise(resolve => options.signal.addEventListener('abort', () => resolve({ ok: false }), { once: true })) : { ok: true, mediaReady: true } });
  h.command({ type: 'command', id: 'p1', action: 'pause' }); await flush(); h.command({ type: 'cancel', id: 'p1' }); await flush();
  const cancellation = h.actions.find(item => item.action === 'cancel');
  assert.equal(cancellation.options.cancelledAction, 'pause'); assert.equal(cancellation.selection.tabId, 12);
  assert.equal(h.session.selection.gate, true);
  assert.equal(h.actions.filter(item => item.action === 'break' || item.action === 'release').length, 0);
});
test('disconnect releases playback and removes the pairing token', async t => {
  const h = await background(t); h.command({ type: 'command', id: 'p1', action: 'pause' }); await flush();
  const result = await h.request({ type: 'disconnect' }); assert.equal(result.ok, true); assert.equal(h.local.token, undefined); assert.equal(h.session.selection.gate, false); assert.equal(result.state.connected, false);
});
test('cancelling a running break targets its original tab after a queued selection', async t => {
  const h = await background(t, { perform: (action, options) => action === 'break' ? new Promise(resolve => options.signal.addEventListener('abort', () => resolve({ ok: false }), { once: true })) : { ok: true, mediaReady: true } });
  h.tabs.set(13, { id: 13, windowId: 8, url: 'https://www.youtube.com/watch?v=two', title: 'New selection' });
  h.command({ type: 'command', id: 'old-break', action: 'break', resume: true }); await flush();
  const selecting = h.request({ type: 'select', tabId: 13 });
  h.command({ type: 'cancel', id: 'old-break' });
  assert.equal((await selecting).ok, true); await flush();
  assert.equal(h.session.selection.tabId, 13); assert.equal(h.session.selection.gate, false);
  assert.ok(h.actions.some(item => item.action === 'cancel' && item.selection.tabId === 12));
  assert.equal(h.actions.filter(item => item.action === 'cancel' && item.selection.tabId === 13).length, 0);
  assert.ok(h.actions.some(item => item.action === 'release' && item.selection.tabId === 12));
});
test('a queued in-page release never clears the newly selected tab gate', async t => {
  let finish;
  const h = await background(t, { perform: action => action === 'break' ? new Promise(resolve => { finish = resolve; }) : { ok: true, mediaReady: true } });
  h.tabs.set(13, { id: 13, windowId: 8, url: 'https://www.youtube.com/watch?v=two', title: 'New selection' });
  h.command({ type: 'command', id: 'wait', action: 'break' }); await flush();
  const selecting = h.request({ type: 'select', tabId: 13 });
  const releasing = h.request({ type: 'media-release' }, { id: 'test', url: h.tabs.get(12).url, tab: { id: 12 } });
  await flush(); finish({ ok: true }); await selecting; await releasing; await flush();
  assert.equal(h.actions.filter(item => item.action === 'release' && item.selection.tabId === 13).length, 0);
  assert.ok(h.actions.some(item => item.action === 'release' && item.selection.tabId === 12));
});
test('cancelled queued commands do not pause a tab they never controlled', async t => {
  let finish;
  const h = await background(t, { perform: action => action === 'break' ? new Promise(resolve => { finish = resolve; }) : { ok: true, mediaReady: true } });
  h.command({ type: 'command', id: 'first', action: 'break' }); await flush();
  h.command({ type: 'command', id: 'queued', action: 'break' });
  h.command({ type: 'cancel', id: 'queued' }); finish({ ok: true }); await flush();
  assert.equal(h.actions.filter(item => item.action === 'break').length, 1);
  assert.equal(h.actions.filter(item => item.action === 'cancel').length, 0);
});
test('a slow post-ack status does not block the next pause command', async t => {
  let statusCalls = 0;
  const h = await background(t, { perform: action => {
    if (action === 'status' && ++statusCalls > 1) return new Promise(() => {});
    return { ok: true, mediaReady: true };
  } });
  h.command({ type: 'command', id: 'b1', action: 'break' }); await flush();
  assert.ok(h.messages.some(message => message.type === 'ack' && message.id === 'b1'));
  h.command({ type: 'command', id: 'p1', action: 'pause' }); await flush();
  assert.ok(h.actions.some(item => item.action === 'pause'));
  assert.ok(h.messages.some(message => message.type === 'ack' && message.id === 'p1'));
});
