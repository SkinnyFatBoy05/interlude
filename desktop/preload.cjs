const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('interludeDesktop', Object.freeze({
  status: () => ipcRenderer.invoke('interlude-desktop', 'status'),
  installHooks: () => ipcRenderer.invoke('interlude-desktop', 'install-hooks'),
  removeHooks: () => ipcRenderer.invoke('interlude-desktop', 'remove-hooks'),
  installClaudeHooks: () => ipcRenderer.invoke('interlude-desktop', 'install-claude-hooks'),
  removeClaudeHooks: () => ipcRenderer.invoke('interlude-desktop', 'remove-claude-hooks'),
  openExtension: () => ipcRenderer.invoke('interlude-desktop', 'extension-folder'),
  setLogin: enabled => ipcRenderer.invoke('interlude-desktop', 'login', enabled),
  updates: () => ipcRenderer.invoke('interlude-desktop', 'updates'),
  quit: () => ipcRenderer.invoke('interlude-desktop', 'quit'),
  copySupport: () => ipcRenderer.invoke('interlude-desktop', 'copy-support'),
}));
