import { copyFile, mkdir, writeFile, rm, lstat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { ROOT } from '../src/config.mjs';
import { prepareWindowsHelper } from './build-windows.mjs';
import { prepareMacOSHelper } from './build-macos.mjs';
import './desktop-assets.mjs';
import { collectReleaseFiles } from './package-release.mjs';

if (!['win32', 'darwin'].includes(process.platform)) throw new Error('Build the desktop app on Windows or macOS.');
const helper = await (process.platform === 'win32' ? prepareWindowsHelper : prepareMacOSHelper)();
const result = JSON.parse((await promisify(execFile)(helper, process.platform === 'win32' ? ['smoke'] : ['smoke', '-'], { windowsHide: true, timeout: 6000 })).stdout);
if (result.code !== 'smoke_ok') throw new Error('Native helper failed its packaging smoke check.');
const output = path.join(ROOT, '.desktop-build', 'native');
await mkdir(output, { recursive: true });
await copyFile(helper, path.join(output, process.platform === 'win32' ? 'InterludeFocus.exe' : 'InterludeFocus'));
await writeFile(path.join(output, 'build.json'), JSON.stringify({ platform: process.platform, arch: process.arch }));
// extraResources excludes its source files from app.asar on macOS. Stage the
// separate hook runtime so its config/events modules also remain in the app.
const staging = path.resolve(ROOT, '.desktop-build', 'companion');
if (!staging.startsWith(path.resolve(ROOT) + path.sep) || (await lstat(path.dirname(staging))).isSymbolicLink()) throw new Error('Unsafe desktop staging directory.');
const hookFiles = await collectReleaseFiles(ROOT, ['src/config.mjs', 'src/events.mjs', 'scripts/hook.mjs', 'extension']);
await rm(staging, { recursive: true, force: true });
for (const [relative, bytes] of Object.entries(hookFiles)) {
  const destination = path.join(staging, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
}
console.log(`Desktop resources ready for ${process.platform}/${process.arch}.`);
