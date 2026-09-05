import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hookCommand, mergeHooks, updateHooksFile } from '../scripts/install-hooks.mjs';
import { HOOKS } from '../src/events.mjs';

test('POSIX hook commands quote spaces, apostrophes, and shell metacharacters literally', () => {
  assert.equal(hookCommand('/usr/local/node', "/Users/O'Brien/$work;notes/hook.mjs", false), "'/usr/local/node' '/Users/O'\\''Brien/$work;notes/hook.mjs'");
});

test('hook command paths reject control characters and relative paths on each OS', () => {
  for (const windows of [true, false]) {
    const node = windows ? 'C:\\node.exe' : '/usr/bin/node';
    for (const script of ['relative/hook.mjs', '/foo\nbar.mjs', 'C:\\bad\u0000.mjs', '/bad\r.mjs']) assert.throws(() => hookCommand(node, script, windows));
  }
});

test('merge preserves empty user groups, unrelated handlers and matcher metadata', () => {
  const owned = { type: 'command', command: 'ours', statusMessage: 'Interlude: update local companion' };
  const existing = { hooks: { Stop: [{ matcher: 'x', hooks: [] }, { matcher: 'y', hooks: [owned, { type: 'command', command: 'other' }] }], Custom: [{ unusual: true }] }, extra: { data: true } };
  const removed = mergeHooks(existing, 'ours', true);
  assert.deepEqual(removed.hooks.Stop, [{ matcher: 'x', hooks: [] }, { matcher: 'y', hooks: [{ type: 'command', command: 'other' }] }]);
  assert.deepEqual(removed.hooks.Custom, existing.hooks.Custom);
  assert.deepEqual(removed.extra, existing.extra);
  assert.equal(existing.hooks.Stop[1].hooks.length, 2);
  const installed = mergeHooks(existing, 'ours');
  assert.deepEqual(mergeHooks(installed, 'ours'), installed);
});

test('merge rejects malformed targeted data instead of overwriting it', () => {
  for (const config of [{ hooks: null }, { hooks: false }, { hooks: { Stop: null } }, { hooks: { Stop: [{ hooks: [null] }] } }, { hooks: { Stop: [{ hooks: [[]] }] } }]) assert.throws(() => mergeHooks(config, 'ours'));
});

test('installer atomically preserves config, backs up bytes and keeps one handler per event', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'interlude-hooks-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'hooks.json');
  const original = '{ "custom": true, "hooks": { "Stop": [{"hooks":[{"command":"mine"}]}] } }\n';
  await writeFile(file, original);
  const installed = await updateHooksFile({ file, command: 'ours' });
  assert.equal(installed.changed, true);
  assert.equal(await readFile(installed.backup, 'utf8'), original);
  const config = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(config.custom, true);
  assert.equal(config.hooks.Stop[0].hooks[0].command, 'mine');
  for (const event of HOOKS) assert.equal(config.hooks[event].flatMap(group => group.hooks).filter(handler => handler.command === 'ours').length, 1);
  const again = await updateHooksFile({ file, command: 'ours' });
  assert.equal(again.changed, false);
  assert.equal(again.backup, null);
  await updateHooksFile({ file, command: 'ours', remove: true });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), JSON.parse(original));
  assert.ok((await readdir(directory)).every(name => !name.endsWith('.tmp') && !name.endsWith('-lock')));
});

test('installer leaves malformed config and concurrent installation untouched', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'interlude-hooks-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'hooks.json');
  await writeFile(file, '{bad');
  await assert.rejects(updateHooksFile({ file, command: 'ours' }));
  assert.equal(await readFile(file, 'utf8'), '{bad');
  await writeFile(`${file}.interlude-lock`, 'busy');
  await assert.rejects(updateHooksFile({ file, command: 'ours' }), /Another Interlude/);
  assert.equal(await readFile(file, 'utf8'), '{bad');
  assert.deepEqual((await readdir(directory)).sort(), ['hooks.json', 'hooks.json.interlude-lock']);
});

test('removing from an absent file does not create empty global hook configuration', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'interlude-hooks-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.equal((await updateHooksFile({ file: path.join(directory, 'hooks.json'), command: 'ours', remove: true })).changed, false);
  assert.deepEqual(await readdir(directory), []);
});

test('Node upgrades replace and remove v0.1 handlers by exact project script identity', () => {
  for (const windows of [false, true]) {
    const script = windows ? "C:\\O'Brien\\Interlude\\scripts\\hook.mjs" : "/Users/O'Brien/Interlude/scripts/hook.mjs";
    const oldNode = windows ? 'C:\\Program Files\\node22\\node.exe' : '/opt/node22/bin/node';
    const newNode = windows ? 'C:\\Program Files\\node24\\node.exe' : '/opt/node24/bin/node';
    const oldCommand = hookCommand(oldNode, script, windows);
    const command = hookCommand(newNode, script, windows);
    // The exact v0.1 handler shape and marker are accepted without changing installed command text.
    const oldHandler = { type: 'command', command: oldCommand, timeout: 2, statusMessage: 'Interlude: update local companion' };
    const existing = { hooks: { Stop: [{ hooks: [oldHandler] }] } };
    const merged = mergeHooks(existing, command);
    assert.equal(merged.hooks.Stop.flatMap(group => group.hooks).length, 1);
    assert.equal(merged.hooks.Stop[0].hooks[0].command, command);
    assert.deepEqual(mergeHooks(existing, command, true), { hooks: {} });
    assert.equal(existing.hooks.Stop[0].hooks[0].command, oldCommand);
  }
});

test('stable hook ownership preserves other projects and commands outside the literal installer grammar', () => {
  const script = '/Users/me/Interlude/scripts/hook.mjs';
  const command = hookCommand('/opt/new/bin/node', script, false);
  const old = hookCommand('/opt/old/bin/node', script, false);
  const marker = 'Interlude: update local companion';
  const preserved = [
    { type: 'command', command: hookCommand('/opt/old/bin/node', '/Users/me/Interlude-other/scripts/hook.mjs', false), statusMessage: marker },
    { type: 'command', command: `${old} --extra`, statusMessage: marker },
    { type: 'command', command: `${old}; echo something`, statusMessage: marker },
    { type: 'command', command: hookCommand('/bin/sh', script, false), statusMessage: marker },
    { type: 'command', command: old, statusMessage: 'User hook with the same script' },
  ];
  const existing = { hooks: { Stop: [{ matcher: 'keep', hooks: [{ type: 'command', command: old, statusMessage: marker }, ...preserved] }] } };
  const removed = mergeHooks(existing, command, true);
  assert.deepEqual(removed.hooks.Stop, [{ matcher: 'keep', hooks: preserved }]);
});
