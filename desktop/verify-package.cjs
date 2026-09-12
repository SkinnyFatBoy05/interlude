const path = require('node:path');
const { access } = require('node:fs/promises');
const { listPackage } = require('@electron/asar');

module.exports = async context => {
  const resources = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  const entries = new Set(listPackage(path.join(resources, 'app.asar')).map(name => name.replaceAll('\\', '/').replace(/^\//, '')));
  for (const file of ['desktop/bootstrap.cjs', 'desktop/main.mjs', 'desktop/preload.cjs', 'src/server.mjs', 'src/config.mjs', 'src/events.mjs', 'web/index.html', 'node_modules/ws/index.js']) {
    if (!entries.has(file)) throw new Error(`Desktop archive is missing ${file}.`);
  }
  for (const file of ['src/config.mjs', 'src/events.mjs', 'scripts/hook.mjs', 'extension/manifest.json']) await access(path.join(resources, 'companion', file));
  console.log('Desktop archive and separate hook runtime verified.');
};
