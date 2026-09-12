import { readFile, readdir, lstat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const SOURCE_ENTRIES = Object.freeze([
  'src', 'web', 'extension', 'scripts', 'tests', 'desktop', '.github', '.gitignore', '.gitattributes',
  'package.json', 'package-lock.json', 'playwright.config.mjs',
  'README.md', 'SECURITY.md', 'PRIVACY.md', 'CHANGELOG.md',
  'docs/platforms.md', 'docs/native-platforms.md', 'docs/backend-review.md', 'docs/release-verification.md',
  'docs/beta-testing.md',
  'docs/production-plan.md',
  'docs/desktop-release.md',
]);
// ZIP's DOS timestamp stores local calendar components without a timezone.
const fixedTime = new Date(2000, 0, 1, 0, 0, 0);

export async function collectReleaseFiles(root, entries = SOURCE_ENTRIES) {
  const files = {};
  const base = path.resolve(root);
  async function collect(relative) {
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part === '..' || ['.local', '.tmp', 'node_modules', '.git', '.env'].includes(part))) throw new Error('Private or unsafe release path.');
    const target = path.resolve(base, relative);
    if (!target.startsWith(base + path.sep)) throw new Error('Release path escapes its root.');
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw new Error(`Release symlinks are not allowed: ${relative}`);
    if (info.isDirectory()) {
      for (const name of (await readdir(target)).sort()) await collect(path.join(relative, name));
    } else if (info.isFile()) {
      const key = relative.replaceAll('\\', '/');
      if (key.split('/').some(part => part.startsWith('.env') || /connection\.json$|\.log$|\.tmp$/i.test(part))) throw new Error(`Private file in release allowlist: ${key}`);
      files[key] = new Uint8Array(await readFile(target));
    }
  }
  for (const entry of entries) await collect(entry);
  return files;
}

export function archive(files) {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, contents]) => [name, [contents, { mtime: fixedTime }]])), { level: 9 });
}

export async function packageRelease({ root = ROOT, output = path.join(root, 'artifacts', 'release') } = {}) {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version)) throw new Error('Invalid release version.');
  const source = await collectReleaseFiles(root);
  const extension = Object.fromEntries(Object.entries(source).filter(([name]) => name.startsWith('extension/')).map(([name, bytes]) => [name.slice('extension/'.length), bytes]));
  const manifest = JSON.parse(Buffer.from(extension['manifest.json']).toString('utf8'));
  if (manifest.version !== pkg.version) throw new Error('Package and extension versions differ.');
  const records = [];
  await mkdir(output, { recursive: true });
  for (const [label, files] of [['source', source], ['extension', extension]]) {
    const name = `interlude-${label}-${pkg.version}.zip`;
    const bytes = archive(files);
    await writeFile(path.join(output, name), bytes);
    records.push({ file: name, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength, entries: Object.keys(files).sort() });
  }
  const verification = { version: pkg.version, artifacts: records, notes: 'Source and unpacked-extension bundles. Native helpers build locally; these archives are not signed desktop installers.' };
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(verification, null, 2) + '\n');
  return verification;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { const result = await packageRelease(); console.log(`Packaged Interlude ${result.version}: ${result.artifacts.map(item => item.file).join(', ')}. Private runtime files excluded.`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
