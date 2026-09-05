import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildNativeHelper, nativeBuildOptions } from './native-build.mjs';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
export async function prepareWindowsHelper({ signal, force = false } = {}) {
  if (process.platform !== 'win32') return null;
  signal?.throwIfAborted();
  const windowsRoot = process.env.SystemRoot || 'C:\\Windows';
  const candidates = ['Framework64', 'Framework'].map(folder => path.join(windowsRoot, 'Microsoft.NET', folder, 'v4.0.30319', 'csc.exe'));
  let compiler;
  for (const candidate of candidates) { try { await access(candidate); compiler = candidate; break; } catch { /* Try the other architecture. */ } }
  if (!compiler) throw new Error('The Windows .NET Framework compiler is unavailable. Automatic Codex return needs the Windows helper.');
  const source = path.join(root, 'scripts', 'FocusCodex.cs');
  return buildNativeHelper({ source, directory: path.join(root, '.local', 'bin'), name: 'InterludeFocus', extension: '.exe',
    buildKey: 'windows-framework4-v3-snapshot', signal, force, format: 'pe', executable: true,
    compile: async (destination, buildSignal, snapshot) => {
      try {
        await execute(compiler, ['/nologo', '/target:exe', '/optimize+', '/reference:System.Web.Extensions.dll', `/out:${destination}`, snapshot],
          { windowsHide: true, timeout: 20000, maxBuffer: 16000, signal: buildSignal });
      } catch (error) { throw new Error(`Could not build the Windows helper: ${error.stdout?.trim() || error.message}`); }
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = nativeBuildOptions(process.argv.slice(2), 'build-windows.mjs');
    const helper = await prepareWindowsHelper(options);
    if (helper && options.smoke) console.log((await execute(helper, ['smoke'], { windowsHide: true, timeout: 6000 })).stdout.trim());
    else console.log(helper ? 'Windows return helper is ready.' : 'Windows helper is not needed on this platform.');
  }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
