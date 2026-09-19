import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { hookCommand, updateHooksFile } from './install-hooks.mjs';
import { ROOT, loadConfig } from '../src/config.mjs';

export const CLAUDE_HOOKS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Stop', 'StopFailure', 'SessionEnd'];
export const claudeSettingsFile = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
export function claudeHookCommand(node = process.execPath, script = path.join(ROOT, 'scripts', 'claude-hook.mjs'), windows = process.platform === 'win32', options = {}) {
  const command = hookCommand(node, script, windows, options);
  // Claude's Windows command runner may use cmd or Git Bash. An encoded
  // PowerShell command preserves literal paths in either shell.
  return windows ? `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(command, 'utf16le').toString('base64')}` : command;
}
export function mergeClaudeHooks(existing, command, remove = false) {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)
    || (existing.hooks !== undefined && (!existing.hooks || typeof existing.hooks !== 'object' || Array.isArray(existing.hooks)))) throw new Error('Claude settings have an unexpected shape. No changes were made.');
  if (typeof command !== 'string' || !command || /[\x00-\x1f\x7f]/.test(command)) throw new Error('Invalid Claude hook command.');
  const next = structuredClone(existing); next.hooks ??= {};
  for (const event of CLAUDE_HOOKS) {
    if (next.hooks[event] !== undefined && !Array.isArray(next.hooks[event])) throw new Error(`Invalid Claude ${event} hooks.`);
    const groups = (next.hooks[event] ?? []).map(group => {
      if (!group || typeof group !== 'object' || !Array.isArray(group.hooks) || group.hooks.some(h => !h || typeof h !== 'object')) throw new Error('Invalid Claude hook group.');
      const hooks = group.hooks.filter(h => !(h.type === 'command' && h.command === command && h.statusMessage === 'Interlude: Claude task event'));
      return hooks.length === 0 && hooks.length !== group.hooks.length && Object.keys(group).length === 1 ? null : { ...group, hooks };
    }).filter(Boolean);
    if (!remove) groups.push({ hooks: [{ type: 'command', command, timeout: 2, statusMessage: 'Interlude: Claude task event' }] });
    if (groups.length) next.hooks[event] = groups; else delete next.hooks[event];
  }
  return next;
}
async function main() {
  const action = process.argv[2] ?? '--preview';
  if (!['--preview', '--install', '--remove'].includes(action) || process.argv.length > 3) throw new Error('Use --preview, --install or --remove.');
  if (action === '--preview') { console.log(`Install ${CLAUDE_HOOKS.length} passive Claude Code handlers in ${claudeSettingsFile()}. Existing settings are preserved. Review in Claude Code /hooks. Ordinary Chat/Cowork is not monitored.`); return; }
  if (action === '--install') await loadConfig();
  await updateHooksFile({ file: claudeSettingsFile(), command: claudeHookCommand(), remove: action === '--remove', merge: mergeClaudeHooks });
  console.log(action === '--install' ? 'Claude Code hooks installed. Review /hooks and start a new Code session.' : 'Interlude Claude Code hooks removed. Other settings preserved.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
