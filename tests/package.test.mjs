import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { collectReleaseFiles } from '../scripts/package-release.mjs';

test('archive bytes are stable across timezones', async () => {
  const moduleUrl = new URL('../scripts/package-release.mjs', import.meta.url).href;
  const script = `import { archive } from ${JSON.stringify(moduleUrl)}; console.log(Buffer.from(archive({'fixture.txt':new Uint8Array([1,2,3])})).toString('hex'));`;
  const outputs = await Promise.all(['UTC', 'Australia/Sydney', 'America/Los_Angeles'].map(async TZ => {
    const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ }, windowsHide: true });
    return result.stdout;
  }));
  assert.equal(new Set(outputs).size, 1);
});

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'interlude-release-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('interlude-release-'));
    return rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('release collection uses explicit roots and omits nearby runtime secrets', async t => {
  const root = await fixture(t);
  await mkdir(path.join(root, 'src')); await mkdir(path.join(root, '.local'));
  await writeFile(path.join(root, 'src', 'app.mjs'), 'export const ready = true;');
  await writeFile(path.join(root, '.local', 'connection.json'), 'private-fixture-token');
  const files = await collectReleaseFiles(root, ['src']);
  assert.deepEqual(Object.keys(files), ['src/app.mjs']);
  assert.equal(Object.values(files).some(bytes => Buffer.from(bytes).includes('private-fixture-token')), false);
  await assert.rejects(collectReleaseFiles(root, ['.local']), /Private or unsafe/);
  await assert.rejects(collectReleaseFiles(root, ['../other']), /Private or unsafe/);
});

test('release collection rejects environment files inside an allowed directory', async t => {
  const root = await fixture(t); await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src', '.env.production'), 'SECRET=fixture');
  await assert.rejects(collectReleaseFiles(root, ['src']), /Private file/);
});

test('release collection does not follow symlinks', async t => {
  const root = await fixture(t); await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'outside.txt'), 'private');
  try { await symlink(path.join(root, 'outside.txt'), path.join(root, 'src', 'link.txt')); }
  catch (error) { if (error.code === 'EPERM') { t.skip('Symlink creation is not permitted on this Windows account.'); return; } throw error; }
  await assert.rejects(collectReleaseFiles(root, ['src']), /symlinks/);
});
