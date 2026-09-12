import { mkdir, open, writeFile, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const keys = ['mode', 'autoReturn', 'maximize', 'resume', 'minimize'];
export function preferencesOnly(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid preferences.');
  const settings = {};
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) continue;
    if (key === 'mode' ? !['fun', 'learn'].includes(value[key]) : typeof value[key] !== 'boolean') throw new Error('Invalid preferences.');
    settings[key] = value[key];
  }
  return settings;
}

export class Preferences {
  constructor(directory) { this.directory = directory; this.pending = Promise.resolve(); }
  async load() {
    if (!this.directory) return { settings: {} };
    let handle;
    try {
      handle = await open(path.join(this.directory, 'preferences.json'), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const info = await handle.stat();
      if (!info.isFile() || info.size > 4096) throw new Error('Invalid preferences.');
      return { settings: preferencesOnly(JSON.parse(await handle.readFile('utf8'))) };
    } catch (error) {
      return { settings: {}, ...(error.code === 'ENOENT' ? {} : { warning: 'Saved preferences could not be read. Defaults are active; change a setting to save them again.' }) };
    } finally { await handle?.close(); }
  }
  save(value) {
    const settings = preferencesOnly(value);
    if (!this.directory) return Promise.resolve();
    const next = this.pending.then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = path.join(this.directory, `.preferences-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify(settings, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        await rename(temporary, path.join(this.directory, 'preferences.json'));
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    });
    this.pending = next.catch(() => {});
    return next;
  }
  flush() { return this.pending; }
}
