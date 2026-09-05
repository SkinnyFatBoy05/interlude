import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareWindowsHelper } from './build-windows.mjs';
import { prepareMacOSHelper } from './build-macos.mjs';
import { nativeBuildOptions } from './native-build.mjs';

try {
  const options = nativeBuildOptions(process.argv.slice(2), 'build-native.mjs');
  const helper = process.platform === 'win32' ? await prepareWindowsHelper(options) : await prepareMacOSHelper(options);
  if (!helper) console.log('Desktop return is available on macOS and Windows. The companion can still run here.');
  else if (options.smoke) {
    const args = process.platform === 'darwin' ? ['smoke', '-'] : ['smoke'];
    const { stdout } = await promisify(execFile)(helper, args, { windowsHide: true, timeout: 6000, maxBuffer: 8192 });
    const result = JSON.parse(stdout.trim());
    if (result.code !== 'smoke_ok' || result.focused !== false || result.attentionRequested !== false) throw new Error('Native helper smoke failed.');
    console.log(`${process.platform}: native compilation and read-only smoke passed. Interactive desktop return still requires a live desktop check.`);
  } else console.log('Native return helper is ready.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
