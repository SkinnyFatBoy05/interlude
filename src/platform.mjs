import { execFile } from 'node:child_process';
import { prepareWindowsHelper } from '../scripts/build-windows.mjs';
import { prepareMacOSHelper } from '../scripts/build-macos.mjs';

const supportedPlatforms = new Set(['win32', 'darwin']);
const bundlePattern = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

function baseResult(platform, code, message) {
  return { platform, supported: supportedPlatforms.has(platform), helperReady: false,
    capabilities: { activate: supportedPlatforms.has(platform), maximize: supportedPlatforms.has(platform), attention: platform === 'win32' },
    focused: false, focusedWindowMaximized: false, targetFound: false, targetCount: 0,
    attentionRequested: false, maximizeStatus: 'not_requested', code, message };
}

// Dependencies allow protocol and cancellation tests without moving desktop windows.
export function createPlatformController({ platform = process.platform, environment = process.env,
  prepareWindows = prepareWindowsHelper, prepareMacOS = prepareMacOSHelper, execute = execFile } = {}) {
  async function run(mode, { signal } = {}) {
    const result = (code, message) => baseResult(platform, code, message);
    const cancelled = () => result('cancelled', 'Desktop return was cancelled.');
    if (signal?.aborted) return cancelled();
    if (!supportedPlatforms.has(platform)) return result('unsupported_platform', 'Desktop return supports macOS and Windows. Open Codex manually on this platform.');
    const bundleId = environment.INTERLUDE_CODEX_BUNDLE_ID;
    if (platform === 'darwin' && bundleId !== undefined && (typeof bundleId !== 'string' || bundleId.length > 255 || !bundlePattern.test(bundleId))) {
      return result('invalid_configuration', 'INTERLUDE_CODEX_BUNDLE_ID must be the exact bundle identifier from the installed Codex app.');
    }
    let helper;
    try { helper = await (platform === 'win32' ? prepareWindows : prepareMacOS)({ signal }); }
    catch {
      if (signal?.aborted) return cancelled();
      return result('helper_unavailable', platform === 'darwin'
        ? 'The macOS return helper is unavailable. Install Xcode Command Line Tools, then run npm run build:macos. Open Codex from the Dock for now.'
        : 'The Windows return helper is unavailable. Run npm run build:windows, then try again. Open Codex from the taskbar for now.');
    }
    if (signal?.aborted) return cancelled();
    if (!helper) return result('helper_unavailable', 'The native return helper is unavailable. Open Codex manually.');
    const args = platform === 'darwin' ? [mode, bundleId ?? '-'] : [mode];
    return new Promise(resolve => {
      const finish = (error, stdout) => {
        if (signal?.aborted || error?.name === 'AbortError') return resolve(cancelled());
        if (error) return resolve({ ...result('helper_failed', 'Desktop return could not complete. Run node scripts/build-native.mjs --force --smoke to rebuild the helper, and open Codex manually.'), helperReady: true });
        try {
          const native = JSON.parse(stdout.trim());
          if (!native || typeof native.focused !== 'boolean' || typeof native.message !== 'string' || native.message.length > 2000
            || typeof native.code !== 'string' || !/^[a-z_]{1,64}$/.test(native.code)
            || !Number.isInteger(native.targetCount) || native.targetCount < 0 || native.targetCount > 10000
            || typeof native.targetFound !== 'boolean' || typeof native.focusedWindowMaximized !== 'boolean'
            || typeof native.attentionRequested !== 'boolean' || typeof native.maximizeStatus !== 'string'
            || (native.focused && (!native.targetFound || native.targetCount !== 1))
            || (native.focusedWindowMaximized && !native.focused)) throw new Error('Invalid native response');
          const safe = { ...result(native.code, native.message), helperReady: true,
            focused: native.focused, focusedWindowMaximized: native.focusedWindowMaximized,
            targetFound: native.targetFound, targetCount: native.targetCount,
            attentionRequested: native.attentionRequested, maximizeStatus: native.maximizeStatus.slice(0, 64) };
          if (typeof native.accessibilityTrusted === 'boolean') safe.accessibilityTrusted = native.accessibilityTrusted;
          if (typeof native.targetBundleId === 'string' && bundlePattern.test(native.targetBundleId) && native.targetBundleId.length <= 255) safe.targetBundleId = native.targetBundleId;
          return resolve(safe);
        } catch { return resolve({ ...result('helper_invalid_response', 'The native helper returned an invalid status. Run node scripts/build-native.mjs --force --smoke and open Codex manually.'), helperReady: true }); }
      };
      try { execute(helper, args, { windowsHide: true, timeout: 6000, maxBuffer: 8192, signal }, finish); }
      catch (error) { finish(error, ''); }
      });
  }
  return {
    focusCodex: ({ maximize = true, signal } = {}) => run(maximize ? 'yes' : 'no', { signal }),
    platformDiagnostics: ({ signal } = {}) => run('status', { signal })
  };
}

const controller = createPlatformController();
export const focusCodex = controller.focusCodex;
export const platformDiagnostics = controller.platformDiagnostics;
