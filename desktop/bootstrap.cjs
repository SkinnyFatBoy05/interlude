const { app, dialog } = require('electron');
const path = require('node:path');
const smokeFile = process.env.INTERLUDE_DESKTOP_SMOKE_FILE;
if (smokeFile) {
  if (!path.isAbsolute(smokeFile)) throw new Error('Desktop smoke output must be an absolute path.');
  app.setPath('userData', path.join(path.dirname(smokeFile), 'electron-profile'));
  console.log('Desktop smoke: bootstrap loaded.');
}
// Catch import failures before Electron's default modal error handler can leave
// an invisible, unresponsive process behind during packaged startup.
import('./main.mjs').catch(error => {
  if (smokeFile) console.error(error.stack);
  else dialog.showErrorBox('Interlude could not start', 'Application files could not be loaded. Reinstall Interlude, then try again.');
  app.exit(1);
});
