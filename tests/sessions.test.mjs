import test from 'node:test';
import assert from 'node:assert/strict';
import { Sessions } from '../src/sessions.mjs';
let sequence = 0;
function fixture(limit = 32) {
  let now = 10000;
  const app = new Sessions({ cwd: '/install', now: () => now, limit });
  app.update({ enabled: true });
  return { app, advance(ms) { now += ms; return app.tick(); },
    event(session, event, extra = {}) { return app.receive({ id: `e-${++sequence}`, at: now, cwd: `/projects/${session}`, session, turn: 't1', event, files: [], toolKey: 'tool1', ...extra }); } };
}
test('all projects are tracked independently and the latest prompt owns the break', () => {
  const h = fixture(); h.event('a', 'UserPromptSubmit'); h.event('b', 'UserPromptSubmit');
  assert.equal(h.app.state.sessionCount, 2); assert.equal(h.app.state.runningCount, 2);
  assert.equal(h.app.activeCwd, '/projects/b'); assert.equal(h.advance(1300).length, 1);
});
test('background completion pauses and identifies that project while another chat works', () => {
  const h = fixture(); h.event('a', 'UserPromptSubmit'); h.event('b', 'UserPromptSubmit');
  h.event('a', 'Stop'); const actions = h.advance(1300);
  assert.equal(actions.length, 1); assert.equal(actions[0].type, 'attention');
  assert.equal(h.app.state.session, 'a'); assert.equal(h.app.state.runningCount, 1);
  assert.equal(h.app.state.attentionCount, 1);
  assert.deepEqual(h.advance(5000), []);
  h.app.acknowledge(); assert.equal(h.app.state.session, 'b');
  assert.equal(h.advance(600)[0].type, 'handoff');
});
test('multiple completed chats require separate acknowledgements before resuming', () => {
  const h = fixture(); for (const id of ['a', 'b', 'c']) h.event(id, 'UserPromptSubmit');
  h.event('a', 'Stop'); h.event('b', 'Stop'); h.advance(1300);
  assert.equal(h.app.state.attentionCount, 2); h.app.acknowledge();
  assert.equal(h.advance(1)[0].type, 'attention');
  assert.equal(h.app.state.session, 'b'); h.app.acknowledge();
  assert.equal(h.advance(600)[0].type, 'handoff'); assert.equal(h.app.state.session, 'c');
});
test('new prompt cannot steal an outstanding alert from another chat', () => {
  const h = fixture(); h.event('a', 'UserPromptSubmit'); h.event('a', 'Stop'); h.advance(1300);
  h.event('b', 'UserPromptSubmit'); assert.deepEqual(h.advance(1300), []);
  assert.equal(h.app.state.session, 'a'); assert.equal(h.app.state.attentionCount, 1);
});
test('matching tool result resolves background permission and allows another break', () => {
  const h = fixture(); h.event('a', 'UserPromptSubmit'); h.event('b', 'UserPromptSubmit');
  h.event('a', 'PermissionRequest'); assert.equal(h.advance(1500)[0].type, 'attention');
  h.event('a', 'PostToolUse'); assert.equal(h.app.state.attentionCount, 0);
  assert.equal(h.advance(1000)[0].type, 'handoff');
});
test('same session cannot change its project and late events cannot reopen completed work', () => {
  const h = fixture(); h.event('a', 'UserPromptSubmit'); h.event('a', 'Stop'); h.advance(1300);
  h.event('a', 'UserPromptSubmit', { cwd: '/different', turn: 't2' });
  h.event('a', 'PostToolUse'); assert.equal(h.app.state.status, 'complete');
  assert.equal(h.app.activeCwd, '/projects/a');
});
test('disarming cancels handoffs and retained alerts do not perform actions', () => {
  const h = fixture(); h.event('a', 'UserPromptSubmit'); h.event('a', 'Stop'); h.advance(1300);
  assert.equal(h.app.update({ enabled: false })[0].type, 'pause');
  assert.deepEqual(h.advance(5000), []); assert.equal(h.app.state.enabled, false);
});
test('chat capacity does not silently evict running sessions', () => {
  const h = fixture(2); h.event('a', 'UserPromptSubmit'); h.event('b', 'UserPromptSubmit'); h.event('c', 'UserPromptSubmit');
  assert.equal(h.app.state.sessionCount, 2); assert.match(h.app.state.notice, /Tracking 2 chats/);
});
test('acknowledging one permission never hides another request in the same turn', () => {
  const h = fixture(); h.event('a', 'UserPromptSubmit'); h.event('a', 'PermissionRequest'); h.advance(1500);
  h.app.acknowledge(); h.event('a', 'PostToolUse'); h.event('a', 'PermissionRequest', { toolKey: 'tool2' });
  assert.equal(h.advance(1500)[0].type, 'attention'); assert.equal(h.app.state.attentionCount, 1);
});

test('background cancellation does not stop the active break', () => {
  const h = fixture(); h.event('a', 'UserPromptSubmit'); h.event('b', 'UserPromptSubmit'); h.advance(1300);
  assert.deepEqual(h.event('a', 'Interrupt'), []);
  assert.equal(h.app.state.session, 'b'); assert.equal(h.app.state.status, 'running');
});
test('evicted completed turns cannot be replayed into a new break', () => {
  const h = fixture(1); h.event('a', 'UserPromptSubmit'); h.event('a', 'Stop'); h.advance(1300); h.app.acknowledge();
  h.event('b', 'UserPromptSubmit'); h.event('b', 'Stop'); h.advance(1300); h.app.acknowledge();
  h.event('a', 'UserPromptSubmit'); assert.equal(h.app.state.session, 'b');
  assert.deepEqual(h.advance(1300), []);
});
