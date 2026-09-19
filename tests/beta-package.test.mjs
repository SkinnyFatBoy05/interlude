import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync, unzipSync } from 'fflate';
import { validateBuild, parseChecksums, unpackExtension, packageBeta } from '../scripts/package-beta.mjs';

const recipe = JSON.parse(await readFile(new URL('../docs/beta-build.json', import.meta.url), 'utf8'));
const record = { databaseId: recipe.runId, headSha: recipe.commit, status: 'completed', conclusion: 'success',
  url: `https://github.com/${recipe.repository}/actions/runs/${recipe.runId}`,
  jobs: recipe.requiredJobs.map(name => ({ name, status: 'completed', conclusion: 'success' })) };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const encoded = text => Buffer.from(text);
const files = Object.fromEntries(['background.js', 'popup.html', 'popup.js', 'media.js', 'assistants.js', 'assistant-observer.js', 'web-tasks.js', 'task-signals.js', 'learning.html'].map(name => [name, encoded('fixture')]));
files['manifest.json'] = encoded(JSON.stringify({ version: recipe.version, manifest_version: 3 }));
const extension = zipSync(files);
const expected = { file: `interlude-extension-${recipe.version}.zip`, bytes: extension.length, sha256: digest(extension), entries: Object.keys(files).sort() };

test('tester packaging rejects wrong revisions, incomplete builds and a single failed/missing job', () => {
  validateBuild(recipe, record);
  for (const invalid of [
    { ...record, headSha: 'a'.repeat(40) }, { ...record, status: 'in_progress' },
    { ...record, jobs: record.jobs.slice(1) },
    { ...record, jobs: record.jobs.map((job, i) => i ? job : { ...job, conclusion: 'failure' }) },
  ]) assert.throws(() => validateBuild(recipe, invalid), /pinned|passed/);
});

test('tester extension archives require checksum, matching inventory/version and safe paths', () => {
  assert.equal(Object.keys(unpackExtension(extension, expected, recipe.version)).length, Object.keys(files).length);
  assert.throws(() => unpackExtension(extension, { ...expected, sha256: 'a'.repeat(64) }, recipe.version), /checksum/);
  assert.throws(() => unpackExtension(extension, { ...expected, entries: [] }, recipe.version), /inventory/);
  assert.throws(() => unpackExtension(extension, expected, '9.9.9'), /version/);
  const unsafe = zipSync({ ...files, '../connection.json': encoded('private') });
  assert.throws(() => unpackExtension(unsafe, { bytes: unsafe.length, sha256: digest(unsafe), entries: Object.keys(files) }, recipe.version), /Unsafe/);
  assert.throws(() => parseChecksums(`${'a'.repeat(64)}  ../installer.exe`), /Invalid/);
  assert.throws(() => parseChecksums(`${'a'.repeat(64)}  installer.exe\n${'b'.repeat(64)}  installer.exe`), /duplicate/);
});

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'interlude-tester-kit-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('interlude-tester-kit-'));
    return rm(root, { recursive: true, force: true });
  });
  const input = path.join(root, 'download');
  const put = async (relative, bytes) => { const target = path.join(root, relative); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes); };
  await put('package.json', JSON.stringify({ version: recipe.version }));
  await put('docs/beta-build.json', JSON.stringify(recipe));
  for (const name of ['tester-start.md', 'tester-feedback.md', 'tester-invite.txt', 'beta-distribution.md', 'assistant-integrations.md']) await put('docs/' + name, 'Tester instructions fixture');
  await put('PRIVACY.md', 'Local privacy fixture');
  await put('download/build-record.json', JSON.stringify(record));
  await put(`download/${recipe.sourceArtifact}/manifest.json`, JSON.stringify({ version: recipe.version, artifacts: [expected] }));
  await put(`download/${recipe.sourceArtifact}/${expected.file}`, extension);
  for (const item of recipe.desktopArtifacts) {
    // Format sentinels for packaging only. These are never launched as programs.
    const bytes = item.target === 'windows-x64' ? encoded('MZfixture') : Buffer.concat([encoded('fixture'), encoded('koly'), Buffer.alloc(508)]);
    await put(`download/${item.artifact}/desktop/${item.file}`, bytes);
    await put(`download/${item.artifact}/desktop/SHA256SUMS.txt`, `${digest(bytes)}  ${item.file}\n`);
  }
  await put('download/private-token.txt', 'MUST-NOT-SHIP');
  return { root, input, put };
}

test('four complete tester kits preserve verified bytes and exclude neighboring private files', async t => {
  const { root, input } = await fixture(t);
  const result = await packageBeta({ root, input });
  assert.equal(result.artifacts.length, 4);
  for (const artifact of result.artifacts) {
    const bytes = await readFile(path.join(result.output, artifact.file));
    assert.equal(digest(bytes), artifact.sha256);
    const contents = unzipSync(bytes);
    assert.ok(contents['START-HERE.txt']); assert.ok(contents['FEEDBACK.txt']); assert.ok(contents['BUILD.json']);
    assert.equal(Object.keys(contents).some(name => name.includes('private-token')), false);
    assert.deepEqual(Buffer.from(contents['extension/background.js']), files['background.js']);
    const lines = Buffer.from(contents['CONTENTS-SHA256.txt']).toString().trim().split('\n');
    for (const line of lines) {
      const [hash, name] = line.split('  '); assert.equal(digest(contents[name]), hash);
    }
    const binaries = Object.keys(contents).filter(name => /\.(exe|dmg)$/.test(name));
    assert.equal(binaries.length, artifact.target === 'browser' ? 0 : 1);
  }
  await assert.rejects(packageBeta({ root, input }), /EEXIST/);
  await assert.rejects(packageBeta({ root, input, output: path.join(root, 'outside') }), /directly under artifacts/);
});

test('tampered installer bytes prevent any tester package from being produced', async t => {
  const { root, input, put } = await fixture(t); const item = recipe.desktopArtifacts[0];
  await put(`download/${item.artifact}/desktop/${item.file}`, 'MZmodified');
  await assert.rejects(packageBeta({ root, input }), /Installer checksum mismatch/);
  await assert.rejects(readFile(path.join(root, 'artifacts', `tester-kit-${recipe.version}`, 'manifest.json')), /ENOENT/);
});
