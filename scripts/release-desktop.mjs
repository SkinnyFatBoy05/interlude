import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT } from '../src/config.mjs';
import './prepare-desktop.mjs';

if (process.platform === 'darwin') {
  const appleId = process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID;
  const apiKey = process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER;
  if (!appleId && !apiKey) throw new Error('A public macOS release requires Apple notarization credentials. Use desktop:dist for an unsigned test build.');
}
const result = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js'), '--config', 'desktop/builder.cjs',
  '--config.forceCodeSigning=true', ...(process.platform === 'darwin' ? ['--config.mac.notarize=true'] : []), '--publish', 'never'],
{ cwd: ROOT, stdio: 'inherit', windowsHide: true, env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
