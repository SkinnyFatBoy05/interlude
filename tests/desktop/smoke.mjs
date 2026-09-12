import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { ROOT } from '../../src/config.mjs';

const temporary = await mkdtemp(path.join(os.tmpdir(), 'Interlude desktop smoke '));
const env = { ...process.env, INTERLUDE_STATE_DIR: path.join(temporary, 'state'), CODEX_HOME: path.join(temporary, 'codex'),
  INTERLUDE_DESKTOP_SMOKE_FILE: path.join(temporary, 'ready.json') };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.argv[2] && path.resolve(process.argv[2]);
const electronPath = executablePath ? null : (await import('electron')).default;
let desktop;
let packagedProcess, packagedPage;
try {
  await mkdir(env.CODEX_HOME, { recursive: true });
  const original = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'unrelated' }] }] } };
  await writeFile(path.join(env.CODEX_HOME, 'hooks.json'), JSON.stringify(original));
  {
    // Production fuses disable the main-process inspector. Connect only to the
    // renderer's ephemeral loopback debugging port for packaged UI verification.
    packagedProcess = spawn(executablePath || electronPath, ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', ...(executablePath ? [] : [path.resolve(ROOT)])], { env, windowsHide: true });
    const endpoint = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(async () => {
        const metadata = await readFile(env.INTERLUDE_DESKTOP_SMOKE_FILE, 'utf8').catch(() => 'No startup metadata.');
        reject(new Error(`Packaged app did not expose its test renderer. ${output.slice(-4000)} ${metadata}`));
      }, 30000);
      packagedProcess.stdout.on('data', data => { output += data; });
      packagedProcess.stderr.on('data', data => { output += data; const match = output.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
      packagedProcess.once('error', error => { clearTimeout(timer); reject(error); });
      packagedProcess.once('exit', code => { clearTimeout(timer); reject(new Error(`Packaged app exited before startup (${code}): ${output.slice(-1500)}`)); });
    });
    const browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    packagedPage = context.pages()[0] ?? await context.waitForEvent('page');
    desktop = { firstWindow: async () => packagedPage, close: async () => {
      await packagedPage.evaluate(() => window.interludeDesktop.quit()).catch(() => {});
      await browser.close();
      if (packagedProcess.exitCode === null) await new Promise(resolve => { const timer = setTimeout(resolve, 5000); packagedProcess.once('exit', () => { clearTimeout(timer); resolve(); }); });
    } };
  }
  const page = await desktop.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('#connection-dot')).toHaveClass('online');
  await expect(page.getByRole('heading', { name: 'Make room for the wait.' })).toBeVisible();
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => typeof window.process), 'undefined');
  await expect(async () => JSON.parse(await readFile(env.INTERLUDE_DESKTOP_SMOKE_FILE, 'utf8'))).toPass();
  const metadata = JSON.parse(await readFile(env.INTERLUDE_DESKTOP_SMOKE_FILE, 'utf8'));
  const security = metadata.security;
  assert.equal(security.sandbox, true); assert.equal(security.contextIsolation, true); assert.equal(security.nodeIntegration, false);
  await page.getByRole('button', { name: 'Connect browser', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open extension folder' })).toBeVisible();
  await page.getByRole('button', { name: 'Connect Codex', exact: true }).click();
  await expect(page.locator('#desktop-setup-status')).toContainText('Hooks installed');
  const hooks = JSON.parse(await readFile(path.join(env.CODEX_HOME, 'hooks.json'), 'utf8'));
  assert.equal(hooks.hooks.Stop[0].hooks[0].command, 'unrelated');
  const hook = hooks.hooks.Stop.at(-1).hooks[0].command;
  const payload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'desktop-test', turn_id: 'one', cwd: ROOT });
  // Execute the exact installed shell command, with stdin, not a hand-built equivalent.
  const stdout = await new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
      process.platform === 'win32' ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', hook] : ['-c', hook], { env, windowsHide: true, timeout: 10000 });
    let output = '', error = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => error += data);
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`Bundled hook failed (${code}): ${error}`)));
    child.stdin.end(payload);
  });
  assert.deepEqual(JSON.parse(stdout), {});
  await page.getByRole('button', { name: 'Disconnect Codex', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect Codex', exact: true })).toBeVisible();
  assert.deepEqual(JSON.parse(await readFile(path.join(env.CODEX_HOME, 'hooks.json'), 'utf8')), original);
  await page.getByRole('button', { name: 'Close setup', exact: true }).click();
  await page.getByRole('button', { name: 'Locked-in mode', exact: true }).click();
  await expect(page.locator('#lesson')).toBeVisible();
  await page.getByText('Connection details', { exact: true }).click();
  await page.getByRole('button', { name: 'Copy debug summary', exact: true }).click();
  await expect(page.locator('#support-status')).toContainText('Copied.');
  const output = path.join(ROOT, 'artifacts', 'desktop-qa'); await mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, executablePath ? 'packaged.png' : 'development.png') });
  assert.deepEqual(errors, []);
  const runtime = { packaged: metadata.packaged, version: metadata.version };
  await desktop.close(); desktop = null;
  const preferences = JSON.parse(await readFile(path.join(env.INTERLUDE_STATE_DIR, 'preferences.json'), 'utf8'));
  assert.equal(preferences.mode, 'learn'); assert.equal(preferences.enabled, undefined);
  console.log(JSON.stringify({ ok: true, ...runtime, checks: ['sandbox', 'renderer isolation', 'guided setup', 'bundled hook execution', 'hook removal', 'preferences', 'console'] }));
} finally {
  await desktop?.close();
  if (packagedProcess && packagedProcess.exitCode === null) packagedProcess.kill();
  assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith('Interlude desktop smoke '));
  await rm(temporary, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
}
