import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sanitizeClaudeHook, validEvent } from '../src/events.mjs';
import { Sessions } from '../src/sessions.mjs';
import { DesktopObserver } from '../src/desktop-observer.mjs';
import { advanceSignal } from '../extension/task-signals.js';
import { assistantFor } from '../extension/assistants.js';
import { mergeClaudeHooks, claudeHookCommand } from '../scripts/install-claude-hooks.mjs';
import { updateHooksFile } from '../scripts/install-hooks.mjs';
import { createPlatformController } from '../src/platform.mjs';
const cwd = path.resolve('.');
const signal = changes => ({ working: false, attention: false, completed: false, failed: false, copies: 0, composer: true, ...changes });

test('Claude events are private, validated, provider-separated and correlated without turn_id', () => {
  let now = 10000;
  const sessions = new Sessions({ cwd, now: () => now }); sessions.update({ enabled: true });
  const event = name => sanitizeClaudeHook({ session_id: 'one', hook_event_name: name, cwd, prompt: 'SECRET', tool_name: 'AskUserQuestion', tool_use_id: 'id', tool_input: { question: 'SECRET' } }, now);
  const start = event('UserPromptSubmit'); assert.equal(validEvent(start), true); assert.ok(!JSON.stringify(start).includes('SECRET'));
  sessions.receive(start); const turn = sessions.state.turn; assert.equal(sessions.state.provider, 'claude');
  sessions.receive(event('PreToolUse')); assert.equal(sessions.state.status, 'input');
  sessions.receive(event('PostToolUse')); assert.equal(sessions.state.status, 'running');
  sessions.receive(event('Stop')); now += 1300; sessions.tick(); assert.equal(sessions.state.status, 'complete');
  now++; sessions.receive(event('UserPromptSubmit')); assert.notEqual(sessions.state.turn, turn); assert.equal(sessions.state.status, 'running');
  sessions.receive(event('StopFailure')); assert.equal(sessions.state.status, 'interrupted');
  assert.equal(sanitizeClaudeHook({ session_id: 'one', hook_event_name: 'Stop', cwd, agent_id: 'child' }), null);
});

test('Claude installer preserves unrelated settings and removes only its own handlers', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'interlude-claude-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'settings.json'), command = claudeHookCommand();
  const original = { permissions: { deny: ['Bash(rm *)'] }, model: 'existing-model', hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'unrelated' }] }] } };
  await writeFile(file, JSON.stringify(original));
  await updateHooksFile({ file, command, merge: mergeClaudeHooks });
  const once = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(mergeClaudeHooks(once, command), once);
  assert.deepEqual(mergeClaudeHooks(once, command, true), original);
  assert.throws(() => mergeClaudeHooks({ hooks: { Stop: 'bad' } }, command));
});

test('Claude prompt IDs isolate turns and permission requests resolve without tool_use_id', () => {
  let now = 10000;
  const sessions = new Sessions({ cwd, now: () => now }); sessions.update({ enabled: true });
  const event = (name, extra = {}) => sanitizeClaudeHook({ session_id: 'modern', prompt_id: 'prompt-one', hook_event_name: name, cwd, ...extra }, now++);
  sessions.receive(event('UserPromptSubmit'));
  const tool = { tool_name: 'Bash', tool_input: { command: 'echo private' } };
  sessions.receive(event('PreToolUse', { ...tool, tool_use_id: 'tool-one' }));
  const permission = event('PermissionRequest', tool);
  const result = event('PostToolUse', { ...tool, tool_use_id: 'tool-one' });
  assert.equal(permission.toolKey, result.toolKey);
  sessions.receive(permission); assert.equal(sessions.state.status, 'permission');
  sessions.receive(result); assert.equal(sessions.state.status, 'running');
  sessions.receive(event('UserPromptSubmit', { prompt_id: 'prompt-two' }));
  sessions.receive(event('Stop')); // Late result from the previous prompt cannot finish this one.
  assert.equal(sessions.state.turn, 'prompt-two'); assert.equal(sessions.state.status, 'running');
  const plan = event('PreToolUse', { prompt_id: 'prompt-two', tool_name: 'ExitPlanMode', tool_input: {} });
  sessions.receive(plan); assert.equal(sessions.state.status, 'input');
  sessions.receive(event('PostToolUse', { prompt_id: 'prompt-two', tool_name: 'ExitPlanMode', tool_input: {}, tool_use_id: 'plan' }));
  assert.equal(sessions.state.status, 'running');
  sessions.receive(event('PostToolUseFailure', { prompt_id: 'prompt-two', is_interrupt: true, ...tool }));
  assert.equal(sessions.state.status, 'interrupted');
  assert.equal(event('Stop', { prompt_id: 'invalid id' }), null);
});

test('Windows Claude hook command safely nests a literal bundled runtime command', () => {
  const command = claudeHookCommand("C:\\App's folder\\Interlude.exe", "C:\\App's folder\\claude-hook.mjs", true, { runAsNode: true });
  const decoded = Buffer.from(command.split(' ').at(-1), 'base64').toString('utf16le');
  assert.match(decoded, /App''s folder/); assert.ok(decoded.startsWith("$env:ELECTRON_RUN_AS_NODE='1'; & '"));
});

test('browser allowlist accepts task surfaces and rejects ordinary ChatGPT, login and lookalikes', () => {
  for (const url of ['https://claude.ai/chat/one', 'https://claude.ai/code/session_1', 'https://chatgpt.com/codex/cloud/tasks/one', 'https://codex.chatgpt.com/']) assert.ok(assistantFor(url));
  for (const url of ['https://claude.ai/login', 'https://chatgpt.com/c/one', 'https://claude.ai.evil/chat/one', 'http://claude.ai/chat/one', 'https://a@claude.ai/chat/one', 'https://claude.ai:444/chat/one']) assert.equal(assistantFor(url), null);
});

test('observation requires observed work then positive stable finish, never silence', () => {
  let state = advanceSignal({}, signal({ copies: 3, completed: true }), 0); assert.equal(state.status, 'idle');
  state = advanceSignal(state, signal({ working: true, copies: 3 }), 100);
  state = advanceSignal(state, signal({ copies: 3 }), 500); assert.equal(state.status, 'unknown');
  state = advanceSignal(state, signal({ copies: 3 }), 99999); assert.equal(state.status, 'unknown');
  state = advanceSignal(state, signal({ copies: 4 }), 100000); assert.equal(state.status, 'settling');
  state = advanceSignal(state, signal({ working: true, copies: 4 }), 100500); assert.equal(state.status, 'running');
  state = advanceSignal(state, signal({ copies: 4 }), 101000); assert.equal(state.status, 'settling');
  state = advanceSignal(state, signal({ copies: 4 }), 102500); assert.equal(state.status, 'complete');
  state = advanceSignal({}, signal({ working: true, completed: true }), 0);
  state = advanceSignal(state, signal({ completed: true }), 3000); assert.equal(state.status, 'unknown');
  state = advanceSignal(state, signal({ completed: true }), 6000); assert.equal(state.status, 'unknown');
  state = advanceSignal(state, signal({ working: true, completed: false }), 7000);
  state = advanceSignal(state, signal({ completed: true }), 8000);
  state = advanceSignal(state, signal({ completed: true }), 9500); assert.equal(state.status, 'complete');
});

test('desktop observer handles permission resolution, completion, new turns and unavailable UI', () => {
  let now = 1000; const events = [];
  const observer = new DesktopObserver({ cwd, receive: e => events.push(e), now: () => now });
  const sample = changes => observer.sample({ observation: { available: true, window: '100', ...signal(changes) } });
  sample({ working: true }); sample({ attention: true }); sample({}); sample({ working: true });
  assert.deepEqual(events.map(e => e.event), ['UserPromptSubmit', 'PermissionRequest', 'PostToolUse']);
  sample({ copies: 1 }); now += 1600; sample({ copies: 1 }); assert.equal(events.at(-1).event, 'Stop');
  const turn = events.at(-1).turn; sample({ working: true, copies: 1 }); assert.notEqual(events.at(-1).turn, turn);
  observer.sample({}); now += 10001; observer.sample({}); assert.equal(events.at(-1).event, 'Interrupt');
  assert.ok(events.every(validEvent));
});
test('unknown desktop controls eventually pause without declaring a successful completion', () => {
  let now = 1000; const events = [];
  const observer = new DesktopObserver({ cwd, receive: e => events.push(e), now: () => now });
  observer.sample({ observation: { available: true, window: '100', ...signal({ working: true }) } });
  observer.sample({ observation: { available: true, window: '100', ...signal({}) } }); now += 10001;
  observer.sample({ observation: { available: true, window: '100', ...signal({}) } });
  assert.deepEqual(events.map(e => e.event), ['UserPromptSubmit', 'Interrupt']);
});

test('native return dispatch targets Claude explicitly without changing Codex protocol', async () => {
  const calls = [];
  for (const platform of ['win32', 'darwin']) {
    const native = createPlatformController({ platform, environment: {}, prepareWindows: async () => 'helper', prepareMacOS: async () => 'helper', execute: (_file, args, _options, callback) => {
      calls.push(args); callback(null, JSON.stringify({ focused: false, focusedWindowMaximized: false, targetFound: false, targetCount: 0, attentionRequested: false, maximizeStatus: 'not_requested', code: 'no_target', message: 'Open Claude.' }));
    } });
    await native.focusCodex({ provider: 'claude', maximize: false });
    await native.observeClaude();
    assert.equal((await native.focusCodex({ provider: 'untrusted' })).code, 'invalid_configuration');
  }
  assert.deepEqual(calls, [['no', 'claude'], ['observe', 'claude'], ['no', '-', 'claude'], ['observe', '-', 'claude']]);
});
