import { readFile, mkdir, copyFile, open, rename, rm, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { HOOKS } from '../src/events.mjs';
import { ROOT, loadConfig } from '../src/config.mjs';

export function hookCommand(nodePath = process.execPath, script = path.join(ROOT, 'scripts', 'hook.mjs'), windows = process.platform === 'win32') {
  const pathAPI = windows ? path.win32 : path.posix;
  for (const value of [nodePath, script]) {
    if (typeof value !== 'string' || value.length > 32768 || /[\x00-\x1f\x7f]/.test(value) || !pathAPI.isAbsolute(value)) {
      throw new Error('Hook executable and script must be absolute paths without control characters.');
    }
  }
  // Codex uses PowerShell on Windows. Quote each literal path as PowerShell code.
  const quotePS = value => `'${value.replaceAll("'", "''")}'`;
  const quoteSH = value => "'" + value.replaceAll("'", "'\\''") + "'";
  return windows ? `& ${quotePS(nodePath)} ${quotePS(script)}` : `${quoteSH(nodePath)} ${quoteSH(script)}`;
}

// Recognize only the two literal arguments emitted by this installer (including v0.1).
// Never execute or loosely search a shell command while deciding which handlers we own.
function hookIdentity(command) {
  if (typeof command !== 'string') return null;
  const windows = command.startsWith('& ');
  let index = windows ? 2 : 0;
  const literal = () => {
    if (command[index++] !== "'") return null;
    let value = '';
    while (index < command.length) {
      if (command[index] !== "'") { value += command[index++]; continue; }
      if (windows && command[index + 1] === "'") { value += "'"; index += 2; continue; }
      if (!windows && command.slice(index, index + 4) === "'\\''") { value += "'"; index += 4; continue; }
      index++;
      return value;
    }
    return null;
  };
  const nodePath = literal();
  if (nodePath === null || command[index++] !== ' ') return null;
  const script = literal();
  if (script === null || index !== command.length) return null;
  const paths = windows ? path.win32 : path.posix;
  const executable = paths.basename(nodePath);
  if (!(windows ? /^(node|nodejs)\.exe$/i : /^(node|nodejs)$/).test(executable) || paths.basename(script) !== 'hook.mjs') return null;
  try { if (hookCommand(nodePath, script, windows) !== command) return null; }
  catch { return null; }
  const normalized = paths.normalize(script);
  return `${windows ? 'windows' : 'posix'}:${windows ? normalized.toLowerCase() : normalized}`;
}

export function mergeHooks(existing, command, remove = false) {
  if (typeof existing !== 'object' || !existing || Array.isArray(existing) || ('hooks' in existing && (typeof existing.hooks !== 'object' || !existing.hooks || Array.isArray(existing.hooks)))) throw new Error('Existing hooks.json has an unexpected shape. No changes were made.');
  if (typeof command !== 'string' || !command || /[\x00-\x1f\x7f]/.test(command)) throw new Error('The hook command is invalid. No changes were made.');
  const next = structuredClone(existing);
  const identity = hookIdentity(command);
  next.hooks ??= {};
  for (const event of HOOKS) {
    if (event in next.hooks && !Array.isArray(next.hooks[event])) throw new Error(`Existing ${event} config is not a list. No changes were made.`);
    const groups = (next.hooks[event] ?? []).map(group => {
      if (!group || typeof group !== 'object' || Array.isArray(group) || !Array.isArray(group.hooks)
        || group.hooks.some(handler => !handler || typeof handler !== 'object' || Array.isArray(handler))) throw new Error(`Existing ${event} hook group is invalid. No changes were made.`);
      const hooks = group.hooks.filter(handler => !(handler.type === 'command' && handler.statusMessage === 'Interlude: update local companion'
        && (handler.command === command || (identity !== null && hookIdentity(handler.command) === identity))));
      // Empty user groups and group metadata are preserved. Only our empty generated group is removed.
      if (hooks.length !== group.hooks.length && !hooks.length && Object.keys(group).length === 1) return null;
      return { ...group, hooks };
    }).filter(group => group !== null);
    if (!remove) groups.push({ hooks: [{ type: 'command', command, timeout: event === 'Interrupt' || event === 'SessionEnd' ? 3 : 2, statusMessage: 'Interlude: update local companion' }] });
    if (groups.length) next.hooks[event] = groups;
    else delete next.hooks[event];
  }
  return next;
}

export async function updateHooksFile({ file, command, remove = false }) {
  await mkdir(path.dirname(file), { recursive: true });
  const lockFile = `${file}.interlude-lock`;
  let lock;
  try { lock = await open(lockFile, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another Interlude hook installation is active. If none is running, remove the stale hooks.json.interlude-lock file and retry.');
    throw error;
  }
  const temporary = `${file}.interlude-${randomUUID()}.tmp`;
  try {
    let before = null;
    let mode = 0o600;
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('hooks.json must be a regular file. No changes were made.');
      mode = info.mode & 0o777;
      before = await readFile(file, 'utf8');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const merged = mergeHooks(before === null ? {} : JSON.parse(before), command, remove);
    const content = JSON.stringify(merged, null, 2) + '\n';
    if (before === content || (before === null && remove)) return { changed: false, backup: null };
    let backup = null;
    if (before !== null) {
      backup = `${file}.interlude-backup-${Date.now()}-${randomUUID()}`;
      await copyFile(file, backup, constants.COPYFILE_EXCL);
    }
    const handle = await open(temporary, 'wx', mode);
    try { await handle.writeFile(content, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    // Also catch edits by tools that do not participate in Interlude's installer lock.
    let current = null;
    try { current = await readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current !== before) throw new Error('hooks.json changed during installation. No changes were applied; retry after the other edit finishes.');
    await rename(temporary, file);
    return { changed: true, backup };
  } finally {
    try { await rm(temporary, { force: true }); }
    finally {
      try { await lock.close(); }
      finally { await rm(lockFile, { force: true }); }
    }
  }
}

async function main() {
  const action = process.argv[2] ?? '--preview';
  if (!['--preview', '--install', '--remove'].includes(action) || process.argv.length > 3) throw new Error('Use --preview, --install or --remove.');
  const directory = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const file = path.join(directory, 'hooks.json');
  let existing = {};
  try { existing = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  mergeHooks(existing, hookCommand(), action === '--remove');
  if (action === '--preview') {
    console.log(`Interlude will merge ${HOOKS.length} event handlers into ${file}.\nAll local Codex projects are monitored while Interlude is enabled. Installed from: ${ROOT}\nNo prompts, commands, transcripts or tool outputs are sent.\nCommand: ${hookCommand()}\nExisting handlers will be preserved. Hooks must be reviewed in Codex /hooks before they run.`);
    return;
  }
  if (action === '--install') await loadConfig();
  await updateHooksFile({ file, command: hookCommand(), remove: action === '--remove' });
  console.log(action === '--install' ? 'Interlude hooks installed. Review and trust them in Codex /hooks, then restart the desktop app or start a fresh task.' : 'Interlude hooks removed. Other hooks were preserved.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
