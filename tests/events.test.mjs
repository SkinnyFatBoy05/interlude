import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { sanitizeHook, validEvent } from '../src/events.mjs';
import { mergeHooks, hookCommand } from '../scripts/install-hooks.mjs';

const input = { hook_event_name: 'PostToolUse', session_id: 'session-1', turn_id: 'turn-1', cwd: path.resolve('.'), tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Add File: web/new.js\n+super-secret-value\n*** End Patch' }, prompt: 'private prompt', tool_output: 'private output', last_assistant_message: 'private message' };
test('hook events exclude content and include only file evidence', () => { const event = sanitizeHook(input); assert.ok(validEvent(event)); assert.deepEqual(event.files, ['web/new.js']); const payload = JSON.stringify(event); for (const secret of ['private prompt', 'private output', 'private message', 'super-secret-value']) assert.ok(!payload.includes(secret)); });
test('unsupported hooks and malformed identifiers are rejected', () => { assert.equal(sanitizeHook({ ...input, hook_event_name: 'SubagentStop' }), null); assert.equal(sanitizeHook({ ...input, turn_id: undefined }), null); assert.equal(sanitizeHook({ ...input, cwd: 'relative' }), null); });
test('parent traversal file evidence is excluded', () => { const event = sanitizeHook({ ...input, tool_input: { command: '*** Add File: ../../secret.txt' } }); assert.deepEqual(event.files, []); });
test('nested traversal and control characters never become file evidence', () => {
  for (const file of ['src/../../secret.txt', 'src\\..\\..\\secret.txt', 'src/private\u0000.txt', 'src/file:secret', '\\secret.txt']) {
    const event = sanitizeHook({ ...input, tool_input: { command: `*** Add File: ${file}` } });
    assert.deepEqual(event.files, [], file);
    assert.equal(validEvent({ ...sanitizeHook(input), files: [file] }), false, file);
  }
});
test('Windows and POSIX hook paths are sanitized independently of the host OS', () => {
  const windows = sanitizeHook({ ...input, cwd: 'C:\\Projects\\Demo', tool_input: { command: '*** Update File: C:\\Projects\\Demo\\src\\index.js\n*** Update File: C:\\Private\\secret.txt' } });
  assert.deepEqual(windows?.files, ['src/index.js']);
  const posix = sanitizeHook({ ...input, cwd: '/Users/example/Project', tool_input: { command: '*** Update File: /Users/example/Project/src/index.js\n*** Update File: /private/secret.txt' } });
  assert.deepEqual(posix?.files, ['src/index.js']);
  assert.ok(validEvent(windows)); assert.ok(validEvent(posix));
});
test('event schema rejects unexpected content and malformed optional fields', () => {
  const event = sanitizeHook(input);
  assert.equal(validEvent({ ...event, prompt: 'private' }), false);
  assert.equal(validEvent({ ...event, asyncQuestion: 'yes' }), false);
  assert.equal(validEvent({ ...event, cwd: event.cwd + '\u0000' }), false);
  assert.equal(validEvent({ ...event, toolKey: 123 }), false);
});
test('same command fingerprints match pre/post phases without storing commands', () => { const a = sanitizeHook({ ...input, hook_event_name: 'PermissionRequest' }); const b = sanitizeHook(input); assert.equal(a.toolKey, b.toolKey); assert.notEqual(a.id, b.id); });
test('installer preserves unrelated hooks and is idempotent', () => { const existing = { description: 'mine', hooks: { Stop: [{ matcher: 'x', hooks: [{ type: 'command', command: 'my-check' }] }], SessionStart: [{ hooks: [{ command: 'hello' }] }] } }; const merged = mergeHooks(existing, 'interlude-command'); assert.equal(merged.hooks.Stop[0].hooks[0].command, 'my-check'); assert.equal(merged.description, 'mine'); assert.deepEqual(mergeHooks(merged, 'interlude-command'), merged); assert.deepEqual(mergeHooks(merged, 'interlude-command', true), existing); });
test('installer refuses malformed configuration', () => { assert.throws(() => mergeHooks({ hooks: { Stop: 'bad' } }, 'cmd')); assert.throws(() => mergeHooks({ hooks: [] }, 'cmd')); });
test('Windows hook commands quote paths containing spaces and apostrophes', () => { assert.equal(hookCommand('C:\\Program Files\\node.exe', "C:\\O'Brien\\hook.mjs", true), "& 'C:\\Program Files\\node.exe' 'C:\\O''Brien\\hook.mjs'"); });
