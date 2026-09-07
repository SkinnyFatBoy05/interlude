import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, writeFile, link, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { scopeKey } from './events.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const LOCAL = path.join(ROOT, '.local');
export const PORT = 4318;
export const ORIGIN = `http://127.0.0.1:${PORT}`;

export function stateDirectory(cwd = ROOT, { platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (env.INTERLUDE_STATE_DIR) {
    if (!paths.isAbsolute(env.INTERLUDE_STATE_DIR)) throw new Error('INTERLUDE_STATE_DIR must be an absolute directory.');
    return paths.normalize(env.INTERLUDE_STATE_DIR);
  }
  const scope = createHash('sha256').update(scopeKey(cwd)).digest('hex').slice(0, 24);
  const base = platform === 'win32' ? paths.join(env.LOCALAPPDATA || paths.join(home, 'AppData', 'Local'), 'Interlude')
    : platform === 'darwin' ? paths.join(home, 'Library', 'Application Support', 'Interlude')
      : paths.join(env.XDG_STATE_HOME && paths.isAbsolute(env.XDG_STATE_HOME) ? env.XDG_STATE_HOME : paths.join(home, '.local', 'state'), 'Interlude');
  return paths.join(base, scope);
}

export async function readConfig(directory = stateDirectory()) {
  const handle = await open(path.join(directory, 'connection.json'), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 1024) throw new Error('Invalid local connection file.');
    let config;
    try { config = JSON.parse(await handle.readFile('utf8')); }
    catch { throw new Error('Invalid local connection file.'); }
    if (!config || typeof config.token !== 'string' || !/^[a-f0-9]{64}$/.test(config.token)) throw new Error('Invalid local connection file.');
    if (process.platform !== 'win32') await handle.chmod(0o600);
    return { token: config.token };
  } finally { await handle.close(); }
}

export async function readConnection() {
  try { return await readConfig(); }
  catch (error) {
    // A hook may run before the companion's first launch after an update.
    if (error.code !== 'ENOENT' || process.env.INTERLUDE_STATE_DIR) throw error;
    return readConfig(LOCAL);
  }
}

export async function loadConfig(directory = stateDirectory(), { legacyDirectory = directory === stateDirectory() ? LOCAL : null, removeLegacy = unlink } = {}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'connection.json');
  const legacyFile = legacyDirectory && path.resolve(legacyDirectory) !== path.resolve(directory) ? path.join(legacyDirectory, 'connection.json') : null;
  let legacy = null;
  if (legacyFile) {
    try { legacy = await readConfig(legacyDirectory); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const finishMigration = async config => {
    if (!legacy) return config;
    if (legacy.token !== config.token) return { ...config, migrationWarning: 'A different legacy pairing file remains in this project’s .local directory. Confirm browser pairing, then remove only .local/connection.json.' };
    try { await removeLegacy(legacyFile); }
    catch (error) {
      if (error.code !== 'ENOENT') return { ...config, migrationWarning: 'Pairing moved to local app data, but the old .local/connection.json could not be removed. Remove that old file after confirming browser pairing.' };
    }
    return config;
  };
  try {
    return await finishMigration(await readConfig(directory));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const config = legacy ?? { token: randomBytes(32).toString('hex') };
    const temporary = path.join(directory, `.connection-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
      // Publish a complete file atomically without replacing another process's token.
      try { await link(temporary, file); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      return await finishMigration(await readConfig(directory));
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
}
