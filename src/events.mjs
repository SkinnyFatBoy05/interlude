import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

export const HOOKS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'Interrupt', 'SessionEnd'];
const safeId = value => typeof value === 'string' && /^[\w.-]{1,160}$/.test(value);
const controls = /[\u0000-\u001f\u007f]/;
export const pathStyle = value => /^[a-z]:[\\/]|^\\\\/i.test(value) ? path.win32 : path.posix;
export const validScope = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !controls.test(value) && pathStyle(value).isAbsolute(value);
export const scopeKey = value => {
  const api = pathStyle(value);
  const resolved = api.resolve(value);
  return api === path.win32 ? resolved.toLowerCase() : resolved;
};
const safeFile = file => typeof file === 'string' && file.length > 0 && file.length < 240
  && !controls.test(file) && !file.includes(':') && !path.win32.isAbsolute(file) && !path.posix.isAbsolute(file)
  && !file.split(/[\\/]/).some(part => part === '..' || part === '.' || part === '');
const eventKeys = new Set(['id', 'at', 'event', 'session', 'turn', 'cwd', 'tool', 'files', 'toolKey', 'asyncQuestion']);

export function sanitizeHook(input, now = Date.now()) {
  if (!input || !HOOKS.includes(input.hook_event_name) || !safeId(input.session_id)) return null;
  if (input.hook_event_name !== 'SessionEnd' && !safeId(input.turn_id)) return null;
  if (!validScope(input.cwd)) return null;
  const paths = pathStyle(input.cwd);
  const name = typeof input.tool_name === 'string' ? input.tool_name : '';
  const tool = /request_user_input/i.test(name) ? 'question'
    : /apply_patch|^(Edit|Write)$/.test(name) ? 'edit'
    : /Bash|exec_command|shell/.test(name) ? 'command' : name ? 'tool' : null;
  const files = [];
  if (tool === 'edit' && typeof input.tool_input?.command === 'string') {
    for (const match of input.tool_input.command.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
      const candidate = match[1].trim();
      const relative = paths.isAbsolute(candidate) ? paths.relative(input.cwd, candidate) : candidate;
      if (safeFile(relative) && !files.includes(relative.replaceAll('\\', '/'))) files.push(relative.replaceAll('\\', '/'));
      if (files.length === 8) break;
    }
  }
  return {
    id: randomUUID(), at: now, event: input.hook_event_name, session: input.session_id,
    turn: input.turn_id ?? '', cwd: paths.resolve(input.cwd), tool, files,
    toolKey: name ? createHash('sha256').update(name + JSON.stringify(input.tool_input ?? {})).digest('hex') : null,
    asyncQuestion: /request_user_input_async/i.test(name),
  };
}

export function validEvent(value) {
  return !!(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => eventKeys.has(key)) && safeId(value.id) && HOOKS.includes(value.event)
    && safeId(value.session) && (safeId(value.turn) || (value.event === 'SessionEnd' && value.turn === ''))
    && validScope(value.cwd)
    && Number.isFinite(value.at) && ['question', 'edit', 'command', 'tool', null].includes(value.tool)
    && (value.toolKey === null || (typeof value.toolKey === 'string' && /^[a-f0-9]{64}$/.test(value.toolKey)))
    && typeof value.asyncQuestion === 'boolean'
    && Array.isArray(value.files) && value.files.length <= 8
    && value.files.every(safeFile));
}
