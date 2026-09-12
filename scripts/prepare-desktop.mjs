import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { ROOT } from '../src/config.mjs';
import { prepareWindowsHelper } from './build-windows.mjs';
import { prepareMacOSHelper } from './build-macos.mjs';
import './desktop-assets.mjs';

if (!['win32', 'darwin'].includes(process.platform)) throw new Error('Build the desktop app on Windows or macOS.');
const helper = await (process.platform === 'win32' ? prepareWindowsHelper : prepareMacOSHelper)();
const result = JSON.parse((await promisify(execFile)(helper, process.platform === 'win32' ? ['smoke'] : ['smoke', '-'], { windowsHide: true, timeout: 6000 })).stdout);
if (result.code !== 'smoke_ok') throw new Error('Native helper failed its packaging smoke check.');
const output = path.join(ROOT, '.desktop-build', 'native');
await mkdir(output, { recursive: true });
await copyFile(helper, path.join(output, process.platform === 'win32' ? 'InterludeFocus.exe' : 'InterludeFocus'));
await writeFile(path.join(output, 'build.json'), JSON.stringify({ platform: process.platform, arch: process.arch }));
console.log(`Desktop resources ready for ${process.platform}/${process.arch}.`);
