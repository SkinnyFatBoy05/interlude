import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Preferences } from '../src/preferences.mjs';
import { createCompanion } from '../src/server.mjs';

async function directory(t) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'interlude-preferences-'));
  t.after(() => rm(folder, { recursive: true, force: true })); return folder;
}
test('preferences persist in order and never persist monitoring, tokens or project data', async t => {
  const folder = await directory(t); const store = new Preferences(folder);
  const first = store.save({ mode: 'learn', resume: true, enabled: true, token: 'secret', activeProject: '/private' });
  const second = store.save({ mode: 'fun', resume: false });
  await Promise.all([first, second]);
  assert.deepEqual((await store.load()).settings, { mode: 'fun', resume: false });
  const bytes = await readFile(path.join(folder, 'preferences.json'), 'utf8');
  assert.doesNotMatch(bytes, /enabled|secret|private|token/);
});
test('malformed preferences recover to defaults with a useful warning', async t => {
  const folder = await directory(t); const store = new Preferences(folder);
  for (const bytes of ['{', '{"mode":"execute"}', '[]', 'x'.repeat(5000)]) {
    await writeFile(path.join(folder, 'preferences.json'), bytes);
    const result = await store.load(); assert.deepEqual(result.settings, {}); assert.match(result.warning, /preferences/i);
  }
});
test('a fresh companion restores preferences but monitoring always starts off', async t => {
  const folder = await directory(t);
  await writeFile(path.join(folder, 'preferences.json'), JSON.stringify({ mode: 'learn', resume: false, enabled: true }));
  const app = await createCompanion({ port: 0, token: 'a'.repeat(64), preferencesDirectory: folder });
  try { assert.equal(app.session.state.mode, 'learn'); assert.equal(app.session.state.resume, false); assert.equal(app.session.state.enabled, false); }
  finally { await app.close(); }
});
