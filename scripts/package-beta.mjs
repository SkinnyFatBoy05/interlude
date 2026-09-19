import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync } from 'fflate';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = text => Buffer.from(text, 'utf8');
const json = value => encode(JSON.stringify(value, null, 2) + '\n');
const fileName = name => typeof name === 'string' && /^[a-zA-Z0-9][\w.-]*$/.test(name) && !name.includes('..');
const safeEntry = name => typeof name === 'string' && name.split('/').every(fileName)
  && !/connection\.json$|\.log$|\.tmp$/i.test(name);

async function safeRead(root, relative) {
  if (!safeEntry(relative)) throw new Error(`Unsafe input path: ${relative}`);
  let current = path.resolve(root);
  if ((await lstat(current)).isSymbolicLink()) throw new Error('Input root must not be a symlink.');
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Input symlinks are not allowed.');
  }
  return readFile(current);
}

export function validateBuild(recipe, record) {
  if (!/^\d+\.\d+\.\d+$/.test(recipe.version) || !/^[a-f0-9]{40}$/.test(recipe.commit)
    || !Number.isSafeInteger(recipe.runId) || !Array.isArray(recipe.requiredJobs) || recipe.requiredJobs.length !== 10
    || new Set(recipe.requiredJobs).size !== 10) throw new Error('Invalid pinned build recipe.');
  const url = `https://github.com/${recipe.repository}/actions/runs/${recipe.runId}`;
  if (record.databaseId !== recipe.runId || record.headSha !== recipe.commit || record.url !== url
    || record.status !== 'completed' || record.conclusion !== 'success') throw new Error('Build record does not match the pinned successful CI run.');
  if (!Array.isArray(record.jobs) || record.jobs.length !== recipe.requiredJobs.length
    || recipe.requiredJobs.some(name => record.jobs.filter(job => job.name === name && job.status === 'completed' && job.conclusion === 'success').length !== 1)) {
    throw new Error('Every required CI job must have passed.');
  }
}

export function parseChecksums(text) {
  const checksums = new Map();
  for (const line of text.trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})  ([a-zA-Z0-9][\w.-]*)$/.exec(line);
    if (!match || !fileName(match[2]) || checksums.has(match[2])) throw new Error('Invalid or duplicate artifact checksum.');
    checksums.set(match[2], match[1]);
  }
  return checksums;
}

export function unpackExtension(bytes, expected, version) {
  if (bytes.length > 2_000_000 || digest(bytes) !== expected.sha256 || expected.bytes !== bytes.length) throw new Error('Extension checksum or size mismatch.');
  let total = 0;
  const files = unzipSync(bytes, { filter: entry => {
    total += entry.originalSize;
    if (!safeEntry(entry.name) || entry.originalSize > 2_000_000 || total > 10_000_000) throw new Error('Unsafe extension archive entry.');
    return true;
  } });
  const names = Object.keys(files).sort();
  if (!Array.isArray(expected.entries) || JSON.stringify(names) !== JSON.stringify([...expected.entries].sort())) throw new Error('Extension inventory mismatch.');
  for (const name of ['manifest.json', 'background.js', 'popup.html', 'popup.js', 'media.js', 'assistants.js', 'assistant-observer.js', 'web-tasks.js', 'task-signals.js', 'learning.html']) {
    if (!files[name]?.length) throw new Error(`Required extension file missing: ${name}`);
  }
  const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString('utf8'));
  if (manifest.version !== version || manifest.manifest_version !== 3) throw new Error('Extension version mismatch.');
  return Object.fromEntries(Object.entries(files).map(([name, value]) => ['extension/' + name, value]));
}

function checksumsFor(files) {
  return encode(Object.keys(files).sort().map(name => `${digest(files[name])}  ${name}`).join('\n') + '\n');
}

export async function packageBeta({ root = ROOT, input, output } = {}) {
  if (!input) throw new Error('Provide the downloaded CI artifact directory.');
  root = path.resolve(root); input = path.resolve(input);
  const recipe = JSON.parse(await safeRead(root, 'docs/beta-build.json'));
  const record = JSON.parse(await safeRead(input, 'build-record.json'));
  validateBuild(recipe, record);
  const pkg = JSON.parse(await safeRead(root, 'package.json'));
  if (pkg.version !== recipe.version) throw new Error('Current package version differs from the pinned build.');
  const source = JSON.parse(await safeRead(input, recipe.sourceArtifact + '/manifest.json'));
  const expected = source.artifacts?.find(item => item.file === `interlude-extension-${recipe.version}.zip`);
  if (source.version !== recipe.version || !expected) throw new Error('Missing matching extension artifact record.');
  const extension = unpackExtension(await safeRead(input, recipe.sourceArtifact + '/' + expected.file), expected, recipe.version);

  // Verify all binaries before creating any output. Only these three named files ship.
  const installers = [];
  if (!Array.isArray(recipe.desktopArtifacts) || recipe.desktopArtifacts.length !== 3
    || new Set(recipe.desktopArtifacts.map(item => item.target)).size !== 3) throw new Error('Expected three desktop targets.');
  for (const item of recipe.desktopArtifacts) {
    if (!['windows-x64', 'mac-arm64', 'mac-x64'].includes(item.target) || !fileName(item.file)) throw new Error('Invalid desktop target.');
    const sums = parseChecksums((await safeRead(input, item.artifact + '/desktop/SHA256SUMS.txt')).toString('utf8'));
    const bytes = await safeRead(input, item.artifact + '/desktop/' + item.file);
    if (!sums.has(item.file) || digest(bytes) !== sums.get(item.file)) throw new Error(`Installer checksum mismatch: ${item.file}`);
    if (item.target === 'windows-x64' ? bytes.subarray(0, 2).toString() !== 'MZ' : bytes.subarray(-512, -508).toString() !== 'koly') throw new Error('Unexpected installer format.');
    installers.push({ ...item, bytes });
  }

  const common = {
    ...extension,
    'START-HERE.txt': await safeRead(root, 'docs/tester-start.md'),
    'FEEDBACK.txt': await safeRead(root, 'docs/tester-feedback.md'),
    'PRIVACY.md': await safeRead(root, 'PRIVACY.md'),
    'KNOWN-LIMITS.md': await safeRead(root, 'docs/assistant-integrations.md'),
    'BUILD.json': json({ version: recipe.version, runtimeCommit: recipe.commit, ci: record,
      stage: 'private compatibility preview', liveAcceptance: 'Not yet verified. See START-HERE.txt.' }),
  };
  const parent = path.join(root, 'artifacts');
  output = path.resolve(output ?? path.join(parent, `tester-kit-${recipe.version}`));
  // New immediate child only; never overwrite a kit or traverse an output symlink.
  if (path.dirname(output) !== parent || !fileName(path.basename(output))) throw new Error('Output must be a new named directory directly under artifacts.');
  await mkdir(parent, { recursive: true });
  if ((await lstat(parent)).isSymbolicLink()) throw new Error('Output parent must not be a symlink.');
  await mkdir(output);
  const records = [];
  for (const item of [{ target: 'browser' }, ...installers]) {
    const files = { ...common };
    if (item.bytes) files[item.file] = item.bytes;
    files['YOUR-PACKAGE.txt'] = encode(`Interlude ${recipe.version} — ${item.target}\n\n${item.bytes ? 'Desktop installer: ' + item.file : 'Website mode only. No desktop installer is needed.'}\nExtract this entire ZIP, then read START-HERE.txt.\nRuntime build: ${recipe.commit}\nPrivate preview. Live compatibility is still being tested.\n`);
    files['CONTENTS-SHA256.txt'] = checksumsFor(files);
    const name = `Interlude-${recipe.version}-beta-${item.target}.zip`;
    const bytes = zipSync(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, [bytes, {
      mtime: new Date(2000, 0, 1), level: /\.(exe|dmg)$/.test(name) ? 0 : 9,
    }]])));
    await writeFile(path.join(output, name), bytes);
    records.push({ file: name, target: item.target, bytes: bytes.length, sha256: digest(bytes), entries: Object.keys(files).sort() });
  }
  await writeFile(path.join(output, 'SHA256SUMS.txt'), records.map(item => `${item.sha256}  ${item.file}`).join('\n') + '\n');
  await writeFile(path.join(output, 'INVITE.txt'), await safeRead(root, 'docs/tester-invite.txt'));
  await writeFile(path.join(output, 'START-HERE.txt'), common['START-HERE.txt']);
  await writeFile(path.join(output, 'SEND-TO-TESTERS.md'), await safeRead(root, 'docs/beta-distribution.md'));
  const manifest = { version: recipe.version, runtimeCommit: recipe.commit, ci: record.url, artifacts: records };
  await writeFile(path.join(output, 'manifest.json'), json(manifest));
  return { output, ...manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length < 3 || process.argv.length > 4) { console.error('Use package-beta.mjs <downloaded-artifacts> [new-output-directory].'); process.exitCode = 1; }
  else packageBeta({ input: process.argv[2], output: process.argv[3] })
    .then(result => console.log(`Prepared ${result.artifacts.length} checksum-verified tester ZIPs in ${result.output}. Nothing published or sent.`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
