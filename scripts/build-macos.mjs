import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildNativeHelper, nativeBuildOptions } from './native-build.mjs';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

export async function prepareMacOSHelper({ signal, force = false } = {}) {
  if (process.platform !== 'darwin') return null;
  signal?.throwIfAborted();
  const source = path.join(root, 'scripts', 'FocusCodex.swift');
  return buildNativeHelper({ source, directory: path.join(root, '.local', 'bin'), name: 'InterludeFocus-macos',
    buildKey: `macos-swift5-v2-snapshot-${process.arch}`, signal, force, format: 'mach-o', executable: true,
    compile: async (destination, buildSignal, snapshot) => {
      try {
        await execute('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-O', '-framework', 'AppKit', '-framework', 'ApplicationServices', snapshot, '-o', destination],
          { timeout: 60000, maxBuffer: 16000, signal: buildSignal });
      } catch (error) { throw new Error(`Could not build the macOS helper. Install Xcode Command Line Tools: ${error.stderr?.trim() || error.message}`); }
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = nativeBuildOptions(process.argv.slice(2), 'build-macos.mjs');
    const helper = await prepareMacOSHelper(options);
    if (helper && options.smoke) console.log((await execute(helper, ['smoke', '-'], { timeout: 6000 })).stdout.trim());
    else console.log(helper ? 'macOS return helper is ready.' : 'macOS helper is not needed on this platform.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
