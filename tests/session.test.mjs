import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Session } from '../src/session.mjs';

function setup() {
  let now = 10000, id = 0;
  const cwd = path.resolve('test-project');
  const session = new Session({ cwd, now: () => now });
  session.update({ enabled: true });
  const event = (name, fields = {}) => session.receive({ id: String(++id), at: now, cwd, session: 'a', turn: 't1', event: name, toolKey: 'tool-1', tool: 'command', files: [], ...fields });
  const advance = ms => { now += ms; return session.tick(); };
  return { session, event, advance, cwd };
}
test('prompt hands off once after grace period', () => { const h = setup(); h.event('UserPromptSubmit'); assert.deepEqual(h.advance(1100), []); assert.equal(h.advance(101)[0].type, 'handoff'); assert.deepEqual(h.advance(1000), []); });
test('a short response does not open a video', () => { const h = setup(); h.event('UserPromptSubmit'); h.advance(200); h.event('Stop'); const effects = h.advance(1400); assert.deepEqual(effects.map(e => e.type), ['attention']); assert.equal(h.session.state.status, 'complete'); });
test('permission immediately resolved cancels attention', () => { const h = setup(); h.event('UserPromptSubmit'); h.event('PermissionRequest'); h.advance(500); h.event('PostToolUse'); assert.equal(h.session.state.status, 'running'); assert.equal(h.advance(1500)[0].type, 'handoff'); });
test('unrelated tool completion does not clear a permission request', () => { const h = setup(); h.event('UserPromptSubmit'); h.event('PermissionRequest'); h.event('PostToolUse', { toolKey: 'unrelated' }); assert.equal(h.advance(1500)[0].reason, 'permission'); });
test('input requests return and matching answer resumes', () => { const h = setup(); h.event('UserPromptSubmit'); h.event('PreToolUse', { tool: 'question' }); assert.equal(h.advance(400)[0].reason, 'input'); h.event('PostToolUse', { tool: 'question' }); assert.equal(h.advance(1000)[0].type, 'handoff'); });
test('async question tool returning does not mean the user answered', () => { const h = setup(); h.event('UserPromptSubmit'); h.event('PreToolUse', { tool: 'question', asyncQuestion: true }); h.event('PostToolUse', { tool: 'question', asyncQuestion: true }); assert.equal(h.session.state.status, 'input'); });
test('activity during stop grace cancels completion', () => { const h = setup(); h.event('UserPromptSubmit'); h.event('Stop'); h.event('PreToolUse'); assert.equal(h.advance(1500)[0].type, 'handoff'); assert.equal(h.session.state.status, 'running'); });
test('disarming cancels pending returns', () => { const h = setup(); h.event('UserPromptSubmit'); h.event('PermissionRequest'); assert.equal(h.session.update({ enabled: false })[0].type, 'pause'); assert.deepEqual(h.advance(2000), []); });
test('stop still updates status when disabled', () => { const h = setup(); h.session.update({ enabled: false }); h.event('UserPromptSubmit'); h.event('Stop'); assert.deepEqual(h.advance(2000), []); assert.equal(h.session.state.status, 'complete'); });
test('disarming during stop grace still completes the internal state', () => { const h = setup(); h.event('UserPromptSubmit'); h.event('Stop'); h.session.update({ enabled: false }); assert.deepEqual(h.advance(2000), []); assert.equal(h.session.state.status, 'complete'); h.event('UserPromptSubmit', { session: 'new-session', turn: 'new-turn' }); assert.equal(h.session.state.session, 'new-session'); });
test('new turn rejects old stop events', () => { const h = setup(); h.event('UserPromptSubmit'); h.event('UserPromptSubmit', { turn: 't2' }); h.event('Stop', { turn: 't1' }); assert.equal(h.advance(2000)[0].type, 'handoff'); assert.equal(h.session.state.turn, 't2'); });
test('background sessions do not steal the active handoff', () => { const h = setup(); h.event('UserPromptSubmit'); h.event('UserPromptSubmit', { session: 'b', turn: 'other' }); h.event('Stop', { session: 'b', turn: 'other' }); assert.equal(h.session.state.session, 'a'); assert.equal(h.advance(2000)[0].type, 'handoff'); });
test('another session can be monitored after completion', () => { const h = setup(); h.event('UserPromptSubmit'); h.event('Stop'); h.advance(2000); h.event('UserPromptSubmit', { session: 'b', turn: 'other' }); assert.equal(h.session.state.session, 'b'); });
test('duplicate events and expired events are ignored', () => { const h = setup(); h.event('UserPromptSubmit', { id: 'duplicate' }); h.event('Stop', { id: 'duplicate' }); h.event('Stop', { at: -10000 }); assert.equal(h.session.state.status, 'running'); });
test('events from another project are ignored', () => { const h = setup(); h.event('UserPromptSubmit', { cwd: path.resolve('other-project') }); assert.equal(h.session.state.status, 'idle'); });
test('late tool results cannot reopen a completed turn', () => { const h = setup(); h.event('UserPromptSubmit'); h.event('Stop'); h.advance(2000); h.event('PostToolUse'); assert.equal(h.session.state.status, 'complete'); });
test('user interruption pauses media without bringing windows forward', () => { const h = setup(); h.event('UserPromptSubmit'); assert.deepEqual(h.event('Interrupt'), [{ type: 'pause' }]); assert.deepEqual(h.advance(2000), []); assert.equal(h.session.state.status, 'interrupted'); });
test('mode is evaluated when the handoff fires', () => { const h = setup(); h.event('UserPromptSubmit'); h.session.update({ mode: 'learn' }); assert.equal(h.advance(2000)[0].mode, 'learn'); });
test('invalid settings are rejected before mutation', () => { const h = setup(); assert.throws(() => h.session.update({ enabled: false, dangerous: true })); assert.equal(h.session.state.enabled, true); });
test('settings reject non-object values', () => { const h = setup(); for (const patch of [null, [], 'fun', 0]) assert.throws(() => h.session.update(patch)); });
test('replayed prompts cannot reopen finished turns or replace newer turns', () => {
  const h = setup(); h.event('UserPromptSubmit'); h.event('UserPromptSubmit', { turn: 't2' });
  h.event('UserPromptSubmit', { turn: 't1' }); assert.equal(h.session.state.turn, 't2');
  h.event('Stop', { turn: 't2' }); h.advance(1500);
  h.event('UserPromptSubmit', { turn: 't2' }); assert.equal(h.session.state.status, 'complete');
});
test('late permission hook cannot reopen a tool whose result was already seen', () => {
  const h = setup(); h.event('UserPromptSubmit'); h.event('PostToolUse'); h.event('PermissionRequest');
  assert.equal(h.session.state.status, 'running');
});
test('parallel permission waits remain until every matching tool has finished', () => {
  const h = setup(); h.event('UserPromptSubmit'); h.event('PermissionRequest', { toolKey: 'first' });
  h.event('PermissionRequest', { toolKey: 'second' }); h.event('PostToolUse', { toolKey: 'second' });
  assert.equal(h.session.state.status, 'permission'); h.event('PostToolUse', { toolKey: 'first' });
  assert.equal(h.session.state.status, 'running');
});
test('a later repeated question remains observable after its earlier answer', () => {
  const h = setup(); h.event('UserPromptSubmit'); h.event('PreToolUse', { tool: 'question' }); h.event('PostToolUse', { tool: 'question' });
  h.advance(1); h.event('PreToolUse', { tool: 'question' }); assert.equal(h.session.state.status, 'input');
});
test('manual return cancels a pending handoff for the rest of this turn', () => {
  const h = setup(); h.event('UserPromptSubmit'); h.session.manualReturn(); assert.deepEqual(h.advance(2000), []);
  h.event('PermissionRequest'); h.event('PostToolUse'); assert.deepEqual(h.advance(2000), []);
  h.event('UserPromptSubmit', { turn: 't2' }); assert.equal(h.advance(2000)[0].type, 'handoff');
});
test('long quiet tools never become successful completions without a Stop hook', () => {
  const h = setup(); h.event('UserPromptSubmit'); h.advance(1200); h.advance(24 * 60 * 60 * 1000);
  assert.equal(h.session.state.status, 'running'); assert.equal(h.session.state.hookSeenAt, 10000);
});
test('POSIX scope matching preserves case on every host', () => {
  const h = setup(); h.session.cwd = '/Users/example/Project';
  h.event('UserPromptSubmit', { cwd: '/Users/example/project' }); assert.equal(h.session.state.status, 'idle');
  h.event('UserPromptSubmit', { cwd: '/Users/example/Project' }); assert.equal(h.session.state.status, 'running');
});
test('Windows scope matching handles drive-letter case and separators on every host', () => {
  const h = setup(); h.session.cwd = 'C:\\Projects\\Demo'; h.event('UserPromptSubmit', { cwd: 'c:/projects/demo/' });
  assert.equal(h.session.state.status, 'running');
});
