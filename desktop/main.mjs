import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog, powerMonitor } from 'electron';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createCompanion } from '../src/server.mjs';
import { createPlatformController } from '../src/platform.mjs';
import { ROOT, stateDirectory } from '../src/config.mjs';
import { HOOKS } from '../src/events.mjs';
import { hookCommand, mergeHooks, updateHooksFile } from '../scripts/install-hooks.mjs';
import { dashboardURL, trustedDesktopSender, validateDesktopAction } from './policy.mjs';

const directory = fileURLToPath(new URL('.', import.meta.url));
const companionRoot = app.isPackaged ? path.join(process.resourcesPath, 'companion') : ROOT;
const extensionPath = path.join(companionRoot, 'extension');
const hooksFile = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'hooks.json');
const command = hookCommand(process.execPath, path.join(companionRoot, 'scripts', 'hook.mjs'), process.platform === 'win32', { runAsNode: true });
let companion, window, tray;
let quitting = false, closed = false, setupBusy = false;
const smokeFile = process.env.INTERLUDE_DESKTOP_SMOKE_FILE;
if (smokeFile) {
  if (!path.isAbsolute(smokeFile)) throw new Error('Desktop smoke output must be an absolute path.');
  app.setPath('userData', path.join(path.dirname(smokeFile), 'electron-profile'));
  console.log('Desktop smoke: main module loaded.');
}

async function hooksInstalled() {
  let config;
  try { config = JSON.parse(await readFile(hooksFile, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return false; throw new Error('Codex hooks configuration could not be read.'); }
  const removed = mergeHooks(config, command, true);
  return HOOKS.every(event => (config.hooks?.[event] ?? []).flatMap(group => group.hooks ?? []).length
    > (removed.hooks?.[event] ?? []).flatMap(group => group.hooks ?? []).length);
}
async function status() {
  return { packaged: app.isPackaged, version: app.getVersion(), extensionPath, hooksInstalled: await hooksInstalled(),
    openAtLogin: app.isPackaged && app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin };
}
function show() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
}
async function shutdown() {
  if (quitting) return;
  quitting = true;
  try { await companion?.close(); }
  finally { closed = true; tray?.destroy(); app.quit(); }
}
async function initialize() {
  if (smokeFile) console.log('Desktop smoke: application ready.');
  const native = app.isPackaged ? createPlatformController({
    prepareWindows: async () => path.join(process.resourcesPath, 'native', 'InterludeFocus.exe'),
    prepareMacOS: async () => path.join(process.resourcesPath, 'native', 'InterludeFocus'),
  }) : createPlatformController();
  // Only the isolated smoke harness can choose a random port; normal builds use 4318.
  companion = await createCompanion({ cwd: companionRoot, nativeFocus: native.focusCodex, nativeDiagnostics: native.platformDiagnostics,
    showLearning: async ({ signal }) => { if (signal.aborted) return { ok: false }; show(); return { ok: window?.isFocused() === true, message: 'Open Interlude to continue learning.' }; },
    ...(smokeFile ? { port: 0 } : {}) });
  if (smokeFile) console.log('Desktop smoke: local companion ready.');
  window = new BrowserWindow({ width: 1200, height: 820, minWidth: 740, minHeight: 560, show: false,
    title: 'Interlude', backgroundColor: '#050505', autoHideMenuBar: true,
    webPreferences: { preload: path.join(directory, 'preload.cjs'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, webSecurity: true, webviewTag: false, devTools: !app.isPackaged } });
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([
    { label: 'Interlude', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Quit Interlude', accelerator: 'Cmd+Q', click: shutdown }] },
    { role: 'editMenu' }, { role: 'windowMenu' },
  ]) : null);
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => { if (!dashboardURL(url, companion.origin)) event.preventDefault(); });
  contents.on('will-redirect', event => event.preventDefault());
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
  contents.on('render-process-gone', () => { companion.disable(); if (!quitting) dialog.showErrorBox('Interlude paused', 'The dashboard stopped unexpectedly. Quit and reopen Interlude. Your monitoring has been turned off.'); });
  window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
  ipcMain.handle('interlude-desktop', async (event, action, value) => {
    if (!trustedDesktopSender(event, window, companion.origin)) throw new Error('Untrusted desktop request.');
    validateDesktopAction(action, value);
    if (action === 'quit') { setImmediate(() => shutdown().catch(() => app.exit(1))); return; }
    if (action === 'status') return status();
    if (setupBusy) throw new Error('Setup is already running. Wait for it to finish.');
    setupBusy = true;
    try {
      if (action === 'install-hooks' || action === 'remove-hooks') {
        if (action === 'remove-hooks') companion.disable();
        await updateHooksFile({ file: hooksFile, command, remove: action === 'remove-hooks' });
      } else if (action === 'extension-folder') {
        const error = await shell.openPath(extensionPath); if (error) throw new Error('The extension folder could not be opened. Copy its path instead.');
      } else if (action === 'login') {
        if (!app.isPackaged) throw new Error('Launch at login is available in the installed app.');
        app.setLoginItemSettings({ openAtLogin: value, args: ['--hidden'] });
      } else if (action === 'updates') await shell.openExternal('https://github.com/SkinnyFatBoy05/interlude/releases');
      return status();
    } finally { setupBusy = false; }
  });
  const icon = nativeImage.createFromPath(app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(ROOT, '.desktop-build', 'icon.png'));
  tray = new Tray(icon.resize({ width: process.platform === 'darwin' ? 18 : 24, height: process.platform === 'darwin' ? 18 : 24 }));
  tray.setToolTip('Interlude — close the window to keep it running');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Interlude', click: show }, { label: 'Turn off monitoring', click: () => companion.disable() },
    { type: 'separator' }, { label: 'Quit Interlude', click: shutdown },
  ]));
  tray.on('click', show);
  powerMonitor.on('suspend', () => companion.disable());
  powerMonitor.on('lock-screen', () => companion.disable());
  await window.loadURL(companion.origin);
  if (!process.argv.includes('--hidden') && !app.getLoginItemSettings({ args: ['--hidden'] }).wasOpenedAtLogin && !smokeFile) show();
  if (smokeFile) {
    window.showInactive();
    // Smoke has no hooks installation or desktop activation side effects.
    await mkdir(path.dirname(smokeFile), { recursive: true });
    await writeFile(smokeFile, JSON.stringify({ origin: companion.origin, packaged: app.isPackaged,
      stateDirectory: stateDirectory(companionRoot), extensionPath, version: app.getVersion(),
      security: { sandbox: contents.getLastWebPreferences().sandbox, contextIsolation: contents.getLastWebPreferences().contextIsolation,
        nodeIntegration: contents.getLastWebPreferences().nodeIntegration } }));
  }
}

if (process.argv.includes('--interlude-uninstall')) {
  try { await updateHooksFile({ file: hooksFile, command, remove: true }); app.exit(0); }
  catch { app.exit(1); }
} else if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', show);
  app.on('activate', show);
  app.on('window-all-closed', () => {});
  app.on('before-quit', event => { if (!closed) { event.preventDefault(); shutdown().catch(() => app.exit(1)); } });
  app.whenReady().then(initialize).catch(async error => {
    if (smokeFile) { await writeFile(smokeFile, JSON.stringify({ error: error.stack })); console.error(error.stack); await shutdown(); return; }
    dialog.showErrorBox('Interlude could not start', error.code === 'EADDRINUSE'
      ? 'Port 4318 is in use. Quit the older Interlude companion or terminal server, then open this app again.'
      : 'The local companion could not start. Check that its local app-data folder is writable, then reinstall if the problem continues.');
    await shutdown();
  });
}
