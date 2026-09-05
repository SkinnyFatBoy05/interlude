import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
async function* sources(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) yield* sources(file);
    else if (/\.(mjs|js)$/.test(entry.name)) yield file;
  }
}
for (const folder of ['src', 'scripts', 'web', 'extension', 'tests']) {
  for await (const file of sources(folder)) {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.error) { console.error(result.error.message); process.exit(1); }
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
const permissions = [...manifest.permissions, ...manifest.host_permissions, ...(manifest.optional_host_permissions ?? [])];
if (manifest.manifest_version !== 3 || permissions.some(value => value === '<all_urls>' || value === '*://*/*' || value === 'https://*/*')) throw new Error('Unexpected broad extension permission.');
console.log('JavaScript syntax and extension manifest checks passed.');
