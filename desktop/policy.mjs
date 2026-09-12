export function dashboardURL(value, origin) {
  try { const url = new URL(value); return url.origin === origin && url.pathname === '/' && !url.username && !url.password; }
  catch { return false; }
}
export function trustedDesktopSender(event, window, origin) {
  return Boolean(window && !window.isDestroyed() && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame && dashboardURL(event.senderFrame?.url, origin));
}
export const DESKTOP_ACTIONS = Object.freeze(['status', 'install-hooks', 'remove-hooks', 'extension-folder', 'login', 'updates', 'quit']);
export function validateDesktopAction(action, value) {
  if (!DESKTOP_ACTIONS.includes(action) || (action === 'login' ? typeof value !== 'boolean' : value !== undefined)) throw new Error('Invalid desktop action.');
}
