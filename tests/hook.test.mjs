import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

function runHook(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/hook.mjs', import.meta.url))], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Hook did not finish.')); }, 3000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.on('close', code => { clearTimeout(timeout); resolve({ code, output, errors }); }); child.stdin.end(input);
  });
}
test('hook remains an empty successful observer for malformed and oversized input', async () => {
  for (const input of ['not JSON', JSON.stringify({ private: 'Do not echo this' }), JSON.stringify({ text: 'é'.repeat(1_000_001) })]) {
    assert.deepEqual(await runHook(input), { code: 0, output: '{}', errors: '' });
  }
});
test('hook ignores valid events outside its exact project scope', async () => {
  const input = { hook_event_name: 'UserPromptSubmit', session_id: 'hook-test', turn_id: 'turn-test', cwd: path.join(os.tmpdir(), 'interlude-unmonitored-project'), prompt: 'Never transmit this' };
  assert.deepEqual(await runHook(JSON.stringify(input)), { code: 0, output: '{}', errors: '' });
});
