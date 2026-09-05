import { fileURLToPath } from 'node:url';
import { sanitizeHook, scopeKey } from '../src/events.mjs';
import { readConnection } from '../src/config.mjs';

// No hook output may influence Codex decisions. Even unavailable companions are a successful no-op.
try {
  const chunks = []; let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 2_000_000) throw new Error('Input too large');
    chunks.push(chunk);
  }
  const event = sanitizeHook(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  const root = fileURLToPath(new URL('../', import.meta.url));
  if (event && scopeKey(event.cwd) === scopeKey(root)) {
    const config = await readConnection();
    await fetch('http://127.0.0.1:4318/api/hook', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
      body: JSON.stringify(event), signal: AbortSignal.timeout(650),
    });
  }
} catch { /* Monitoring must never interfere with the user's task. */ }
process.stdout.write('{}');
