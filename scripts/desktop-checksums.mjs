import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ROOT } from '../src/config.mjs';

const folder = path.join(ROOT, 'artifacts', 'desktop');
const records = [];
for (const name of (await readdir(folder)).sort()) {
  if (!/^Interlude-[\w.-]+\.(exe|dmg|zip)$/.test(name)) continue;
  const bytes = await readFile(path.join(folder, name));
  records.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
}
if (!records.length) throw new Error('No desktop release artifacts found.');
await writeFile(path.join(folder, 'SHA256SUMS.txt'), records.join('\n') + '\n');
console.log(`Checksummed ${records.length} desktop artifacts.`);
