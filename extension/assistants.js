export const AI_MATCHES = ['https://claude.ai/*', 'https://chatgpt.com/*', 'https://chat.openai.com/*', 'https://codex.chatgpt.com/*'];
export function assistantFor(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (url.hostname === 'claude.ai' && /^\/(?:new|chat(?:\/|$)|code(?:\/|$))/.test(url.pathname)) return { id: 'claude', name: 'Claude', origin: 'https://claude.ai/*' };
    if (url.hostname === 'codex.chatgpt.com' || (['chatgpt.com', 'chat.openai.com'].includes(url.hostname) && /^\/codex(?:\/|$)/.test(url.pathname))) return { id: 'codex', name: 'Codex', origin: `${url.origin}/*` };
  } catch { /* Not an assistant task page. */ }
  return null;
}
export function taskURL(value) { try { const u = new URL(value); return u.origin + u.pathname; } catch { return ''; } }
