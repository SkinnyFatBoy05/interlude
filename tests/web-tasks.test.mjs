import test from 'node:test';
import assert from 'node:assert/strict';
import { WebTasks } from '../extension/web-tasks.js';
const base = { working: false, attention: false, completed: false, failed: false, copies: 0, composer: true };
async function harness(t) {
  let now = 10000; const actions = [], focused = [], storage = {};
  const tabs = new Map([[1, { id: 1, windowId: 10, url: 'https://claude.ai/chat/one' }], [2, { id: 2, windowId: 20, url: 'https://chatgpt.com/codex/cloud/tasks/two' }]]);
  const chrome = { storage: { session: { get: async () => storage, set: async data => Object.assign(storage, structuredClone(data)) } },
    tabs: { get: async id => { if (!tabs.has(id)) throw Error('gone'); return tabs.get(id); }, update: async id => focused.push(id) },
    windows: { get: async () => ({ state: 'normal' }), update: async () => {} },
    permissions: { contains: async () => true, getAll: async () => ({ origins: [] }) },
    scripting: { unregisterContentScripts: async () => {}, registerContentScripts: async () => {}, executeScript: async () => {} } };
  const tasks = new WebTasks({ chrome, now: () => now, media: async action => { actions.push(action); return { ok: true }; } });
  await tasks.initialized; t.after(() => tasks.invalidate());
  await tasks.watch(1); await tasks.watch(2); await tasks.configure({ enabled: true });
  const sequences = new Map();
  const send = async (id, changes, sender = {}) => {
    sequences.set(id, (sequences.get(id) || 0) + 1);
    await tasks.accept({ documentId: `document-${id}`, sequence: sequences.get(id), url: tabs.get(id)?.url, signal: { ...base, ...changes } }, { tab: { id }, frameId: 0, url: tabs.get(id)?.url, ...sender });
    clearTimeout(tasks.pending);
  };
  return { tasks, tabs, actions, focused, send, advance: ms => now += ms, act: () => tasks.act(tasks.epoch) };
}
test('standalone website monitoring switches to media and returns to the exact completed tab', async t => {
  const h = await harness(t);
  await h.send(1, { working: true }); h.advance(1300); await h.act(); assert.equal(h.actions.at(-1), 'break');
  await h.send(1, { copies: 1 }); h.advance(1600); await h.send(1, { copies: 1 }); await h.act();
  assert.equal(h.actions.at(-1), 'pause'); assert.deepEqual(h.focused, [1]);
  await h.send(1, { working: true, copies: 1 }); h.advance(1300); await h.act();
  await h.send(1, { completed: true, copies: 2 }); h.advance(1600); await h.send(1, { completed: true, copies: 2 }); await h.act();
  assert.deepEqual(h.focused, [1, 1]);
});
test('a completed background task holds media until acknowledged while another task works', async t => {
  const h = await harness(t); await h.send(1, { working: true }); await h.send(2, { working: true }); h.advance(1300); await h.act();
  await h.send(1, { completed: true }); h.advance(1600); await h.send(1, { completed: true }); await h.act();
  assert.equal(h.actions.at(-1), 'pause'); assert.equal(h.focused.at(-1), 1);
  await h.send(2, { working: true }); await h.act(); assert.equal(h.actions.at(-1), 'pause');
  await h.tasks.acknowledge(); await h.act(); assert.equal(h.actions.at(-1), 'break');
});
test('frames, stale sequences and navigation cannot forge a task completion', async t => {
  const h = await harness(t);
  await h.send(1, { working: true }, { frameId: 7 }); assert.equal(h.tasks.state.tasks[1].started, false);
  await h.send(1, { working: true }); h.advance(1300); await h.act();
  h.tabs.get(1).url = 'https://claude.ai/chat/other';
  await h.send(1, { completed: true, copies: 5 }); h.advance(2000); await h.act();
  assert.equal(h.focused.length, 0); assert.equal(h.tasks.state.tasks[1].started, false);
});
test('closing an idle tab with website monitoring off never pauses desktop-owned media', async t => {
  const h = await harness(t); await h.tasks.configure({ enabled: false }); const before = h.actions.length;
  await h.tasks.remove(1); assert.equal(h.actions.length, before);
});
test('navigation to an unsupported page pauses an active break and removes its watcher', async t => {
  const h = await harness(t); await h.send(1, { working: true }); h.advance(1300); await h.act();
  await h.tasks.navigation(1, 'https://claude.ai/login');
  assert.equal(h.actions.at(-1), 'pause'); assert.equal(h.tasks.state.tasks[1], undefined);
});

test('missing website heartbeats pause once without a false completion and fresh work can resume', async t => {
  const h = await harness(t); await h.send(1, { working: true }); h.advance(1300); await h.act();
  h.advance(15000); await h.tasks.watchdog(); assert.equal(h.actions.at(-1), 'pause');
  assert.equal(h.tasks.state.tasks[1].status, 'running'); assert.deepEqual(h.focused, []);
  const count = h.actions.length; await h.tasks.watchdog(); assert.equal(h.actions.length, count);
  await h.send(1, { working: true }); await h.act(); assert.equal(h.actions.at(-1), 'break');
});
