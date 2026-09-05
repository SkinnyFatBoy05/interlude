import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, stateDirectory } from '../src/config.mjs';

async function directory(t) { const folder = await mkdtemp(path.join(os.tmpdir(), 'interlude-config-')); t.after(() => rm(folder, { recursive: true, force: true })); return folder; }
test('simultaneous initial launches share one complete token', async t => {
  const folder = await directory(t); const configs = await Promise.all(Array.from({ length: 12 }, () => loadConfig(folder)));
  assert.match(configs[0].token, /^[a-f0-9]{64}$/); assert.equal(new Set(configs.map(config => config.token)).size, 1);
  assert.equal(JSON.parse(await readFile(path.join(folder, 'connection.json'), 'utf8')).token, configs[0].token);
});
test('config returns only validated connection data', async t => {
  const folder = await directory(t); await writeFile(path.join(folder, 'connection.json'), JSON.stringify({ token: 'c'.repeat(64), private: 'secret' }));
  assert.deepEqual(await loadConfig(folder), { token: 'c'.repeat(64) });
});
test('malformed existing config is not silently replaced', async t => {
  const folder = await directory(t); const file = path.join(folder, 'connection.json'); await writeFile(file, '{broken');
  await assert.rejects(loadConfig(folder)); assert.equal(await readFile(file, 'utf8'), '{broken');
});
test('POSIX token files have owner-only permissions', { skip: process.platform === 'win32' }, async t => {
  const folder = await directory(t); await loadConfig(folder); assert.equal((await stat(path.join(folder, 'connection.json'))).mode & 0o777, 0o600);
});
test('pairing defaults to per-user platform storage with distinct project scopes', () => {
  const windows = { platform: 'win32', env: { LOCALAPPDATA: 'C:\\User\\AppData\\Local' }, home: 'C:\\User' };
  assert.match(stateDirectory('C:\\Projects\\One', windows), /^C:\\User\\AppData\\Local\\Interlude\\[a-f0-9]{24}$/);
  assert.notEqual(stateDirectory('C:\\Projects\\One', windows), stateDirectory('C:\\Projects\\Two', windows));
  assert.equal(stateDirectory('C:\\Projects\\One', windows), stateDirectory('c:/projects/one/', windows));
  assert.match(stateDirectory('/Projects/One', { platform: 'darwin', env: {}, home: '/Users/example' }), /^\/Users\/example\/Library\/Application Support\/Interlude\/[a-f0-9]{24}$/);
  assert.match(stateDirectory('/Projects/One', { platform: 'linux', env: { XDG_STATE_HOME: '/state' }, home: '/home/example' }), /^\/state\/Interlude\/[a-f0-9]{24}$/);
  assert.equal(stateDirectory('/Projects/One', { platform: 'linux', env: { INTERLUDE_STATE_DIR: '/explicit-state' }, home: '/home/example' }), '/explicit-state');
  assert.throws(() => stateDirectory('/Projects/One', { platform: 'linux', env: { INTERLUDE_STATE_DIR: 'relative' }, home: '/home/example' }));
});
test('legacy pairing migrates atomically and removes only the old token file', async t => {
  const folder = await directory(t), legacyDirectory = path.join(folder, 'legacy'), destination = path.join(folder, 'state');
  await mkdir(legacyDirectory); await writeFile(path.join(legacyDirectory, 'connection.json'), JSON.stringify({ token: 'd'.repeat(64) }));
  await writeFile(path.join(legacyDirectory, 'keep.txt'), 'keep');
  const results = await Promise.all(Array.from({ length: 8 }, () => loadConfig(destination, { legacyDirectory })));
  assert.ok(results.every(config => config.token === 'd'.repeat(64)));
  await assert.rejects(readFile(path.join(legacyDirectory, 'connection.json')), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(legacyDirectory, 'keep.txt'), 'utf8'), 'keep');
  assert.equal((await loadConfig(destination, { legacyDirectory })).token, 'd'.repeat(64));
});
test('failed legacy deletion retains a usable destination and an actionable warning', async t => {
  const folder = await directory(t), legacyDirectory = path.join(folder, 'legacy'), destination = path.join(folder, 'state');
  await mkdir(legacyDirectory); await writeFile(path.join(legacyDirectory, 'connection.json'), JSON.stringify({ token: 'e'.repeat(64) }));
  const result = await loadConfig(destination, { legacyDirectory, removeLegacy: async () => { throw Object.assign(new Error('Denied'), { code: 'EPERM' }); } });
  assert.equal(result.token, 'e'.repeat(64)); assert.match(result.migrationWarning, /could not be removed/);
  assert.equal(JSON.parse(await readFile(path.join(destination, 'connection.json'), 'utf8')).token, result.token);
  assert.ok(await stat(path.join(legacyDirectory, 'connection.json')));
});
test('existing destination token is never overwritten by different legacy pairing', async t => {
  const folder = await directory(t), legacyDirectory = path.join(folder, 'legacy'), destination = path.join(folder, 'state');
  await mkdir(legacyDirectory); await writeFile(path.join(legacyDirectory, 'connection.json'), JSON.stringify({ token: 'f'.repeat(64) }));
  const original = await loadConfig(destination);
  const result = await loadConfig(destination, { legacyDirectory }); assert.equal(result.token, original.token); assert.match(result.migrationWarning, /different legacy/);
  assert.ok(await stat(path.join(legacyDirectory, 'connection.json')));
});
