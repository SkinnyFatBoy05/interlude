import { performAction } from './actions.js';
import { SITE_MATCHES, DEFAULT_MATCHES, platformFor, permissionFor } from './platforms.js';

let socket;
let keepAlive;
let reconnect;
let handshake;
let connecting = false;
let ready = false;
let selection = {};
let lastMessage = 'Start the local companion. Interlude will connect automatically.';
let actionQueue = Promise.resolve();
let reportSequence = 0;
let registration = Promise.resolve();
const handled = new Map();
const active = new Map();
const initialized = chrome.storage.session.get('selection').then(value => { selection = value.selection ?? {}; });
const send = value => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
const saveSelection = () => chrome.storage.session.set({ selection });
const enqueue = action => { const next = actionQueue.then(action); actionQueue = next.catch(() => {}); return next; };

function registerSites() {
  const next = registration.then(syncRegisteredSites);
  registration = next.catch(() => {});
  return next;
}
async function syncRegisteredSites() {
  const permissions = await chrome.permissions.getAll();
  const matches = SITE_MATCHES.filter(match => !DEFAULT_MATCHES.includes(match) && permissions.origins?.includes(match));
  await chrome.scripting.unregisterContentScripts({ ids: ['interlude-optional-sites'] }).catch(() => {});
  if (matches.length) await chrome.scripting.registerContentScripts([{ id: 'interlude-optional-sites', matches, js: ['media.js'], runAt: 'document_start', allFrames: true, persistAcrossSessions: true }]);
}
async function installInTab(tabId) {
  // Existing tabs become usable immediately after permission is granted.
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  for (const frame of frames || []) {
    const origin = permissionFor(frame.url);
    if (origin && await chrome.permissions.contains({ origins: [origin] })) {
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [frame.frameId] }, files: ['media.js'] });
    }
  }
}
async function report() {
  await initialized;
  const sequence = ++reportSequence;
  const selectedId = selection.tabId;
  let tab;
  try { if (selectedId) tab = await chrome.tabs.get(selectedId); } catch { /* Closed tab. */ }
  const platform = platformFor(tab?.url);
  const selected = Boolean(tab && platform);
  if (!selected && selectedId && selection.tabId === selectedId) {
    selection = {}; await saveSelection();
    lastMessage = 'The selected tab was closed or left a registered site. Choose another media tab.';
  }
  const media = selected ? await performAction(chrome, { tabId: selectedId }, 'status') : null;
  const state = { type: 'browser', selected, mediaReady: selected && media?.ok === true && media.mediaReady === true,
    platform: platform?.id || '', title: selected ? tab.title || platform.name : '',
    message: !ready ? lastMessage : media?.message || lastMessage, gate: selected && selection.gate === true };
  if (ready && sequence === reportSequence && (selectedId === selection.tabId || (!selected && !selection.tabId))) send(state);
  return { ...state, connected: ready, tabId: selected ? selectedId : null };
}
async function runAction(action, options = {}) {
  await initialized;
  if (options.signal?.aborted) return { ok: false, message: 'This browser action was cancelled.' };
  const selectedId = Object.hasOwn(options, 'targetTabId') ? options.targetTabId : selection.tabId;
  const ownsSelection = selectedId && selection.tabId === selectedId;
  if (['pause', 'learn', 'cancel'].includes(action) && ownsSelection) { selection = { ...selection, gate: true }; await saveSelection(); }
  if (['break', 'release'].includes(action) && ownsSelection) { selection = { ...selection, gate: false }; await saveSelection(); }
  const result = await performAction(chrome, { tabId: selectedId }, action, options);
  lastMessage = result?.message || (result?.ok ? 'Ready.' : 'The browser action could not be completed.');
  return result;
}
async function cancelTarget(targetTabId, commandId, cancelledAction) {
  if (!targetTabId) return;
  await runAction('cancel', { targetTabId, commandId, cancelledAction });
  // If the user selected another tab while the cancelled action was pending,
  // the old player still needs cancellation, but must not retain an orphan gate.
  if (selection.tabId !== targetTabId) await runAction('release', { targetTabId });
}
async function storedPairing() {
  const stored = await chrome.storage.local.get(['token', 'autoPair']);
  if (stored.autoPair === false) {
    lastMessage = 'Disconnected. Choose Connect companion when you want to reconnect.';
    return { allowed: false, token: null };
  }
  const token = typeof stored.token === 'string' && /^[a-f0-9]{64}$/.test(stored.token) ? stored.token : null;
  return { allowed: true, token };
}
function cancelCommands() {
  for (const pending of active.values()) pending.controller.abort();
  active.clear();
}
async function connect() {
  await initialized;
  if (connecting || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  connecting = true;
  try {
    const pairing = await storedPairing();
    if (!pairing.allowed) return;
    let token = pairing.token;
    const current = new WebSocket('ws://127.0.0.1:4318/bridge');
    socket = current;
    handshake = setTimeout(() => { if (socket === current && !ready) current.close(); }, 8000);
    current.onopen = () => {
      if (socket !== current) return;
      send(token ? { type: 'hello', role: 'extension', token } : { type: 'pair', role: 'extension' });
    };
    current.onmessage = async event => {
      if (socket !== current) return;
      let message; try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'paired') {
        if (token || typeof message.token !== 'string' || !/^[a-f0-9]{64}$/.test(message.token)) { current.close(1008, 'Invalid pairing response'); return; }
        token = message.token;
        await chrome.storage.local.set({ token, autoPair: true });
        if (socket === current && current.readyState === WebSocket.OPEN) send({ type: 'hello', role: 'extension', token });
        return;
      }
      if (message.type === 'ready') {
        clearTimeout(handshake); ready = true; lastMessage = 'Connected to the local companion.';
        clearInterval(keepAlive);
        keepAlive = setInterval(() => { send({ type: 'ping' }); report().catch(() => {}); }, 20000);
        report().catch(() => {}); return;
      }
      if (message.type === 'cancel' && ready && typeof message.id === 'string') {
        const pending = active.get(message.id);
        if (pending) {
          pending.controller.abort();
          // The abort releases the queue immediately; cancel is inserted before
          // any subsequent command and stops a late media.play() completion.
          if (pending.started && ['break', 'pause', 'learn'].includes(pending.action)) {
            enqueue(() => cancelTarget(pending.targetTabId, message.id, pending.action)).then(() => report()).catch(() => {});
          }
        }
        return;
      }
      if (message.type !== 'command' || !ready || typeof message.id !== 'string' || message.id.length > 200) return;
      if (handled.has(message.id)) { send(handled.get(message.id)); return; }
      if (active.has(message.id)) return;
      if (!['break', 'learn', 'pause', 'minimize', 'release', 'status'].includes(message.action)) {
        send({ type: 'ack', id: message.id, ok: false, message: 'Unknown browser action.' }); return;
      }
      const controller = new AbortController();
      const targetTabId = selection.tabId;
      const pending = { controller, targetTabId, action: message.action, started: false };
      active.set(message.id, pending);
      enqueue(async () => {
        if (socket !== current || !ready || controller.signal.aborted) return;
        let result;
        try {
          if (selection.tabId !== targetTabId) result = { ok: false, message: 'The media selection changed before this action could start. Try again with the selected tab.' };
          else { pending.started = true; result = await runAction(message.action, { ...message, targetTabId, commandId: message.id, signal: controller.signal }); }
        }
        catch (error) { result = { ok: false, message: error.message || 'The browser could not complete this action.' }; }
        if (socket !== current || !ready || controller.signal.aborted) return;
        const acknowledgment = { type: 'ack', id: message.id, ...result };
        handled.set(message.id, acknowledgment);
        if (handled.size > 100) handled.delete(handled.keys().next().value);
        send(acknowledgment);
        report().catch(() => {});
      }).finally(() => { active.delete(message.id); }).catch(() => {});
    };
    current.onclose = event => {
      if (socket !== current) return;
      const interrupted = [...active.values()].filter(pending => pending.started && ['break', 'pause', 'learn'].includes(pending.action))
        .map(pending => ({ targetTabId: pending.targetTabId, action: pending.action }));
      ready = false; cancelCommands(); clearInterval(keepAlive); clearTimeout(handshake); socket = null;
      for (const pending of interrupted) enqueue(() => cancelTarget(pending.targetTabId, undefined, pending.action)).catch(() => {});
      if (event.code === 1008) chrome.storage.local.remove('token').catch(() => {});
      lastMessage = event.code === 1008 ? 'Pairing expired. Reconnecting automatically…' : 'Companion offline. Start Interlude to reconnect, or release playback from this extension.';
      clearTimeout(reconnect);
      reconnect = setTimeout(() => connect().catch(() => {}), event.code === 1008 ? 500 : 4000);
    };
    current.onerror = () => {};
  } finally { connecting = false; }
}
async function popupState() {
  if (!ready) await connect();
  const state = await report();
  const tabs = await Promise.all((await chrome.tabs.query({})).filter(tab => platformFor(tab.url)).map(async tab => {
    const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id }).catch(() => []);
    const origins = [...new Set([permissionFor(tab.url), ...(frames || []).map(frame => permissionFor(frame.url)).filter(Boolean)])];
    return { id: tab.id, title: tab.title || platformFor(tab.url).name, platform: platformFor(tab.url).id,
      platformName: platformFor(tab.url).name, origin: permissionFor(tab.url), origins };
  }));
  return { ok: true, state, tabs };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  // An extension page opened in a normal tab also has sender.tab. Authenticate
  // the exact extension page before distinguishing content-script messages.
  const isPopup = sender.url === chrome.runtime.getURL('popup.html');
  if (!isPopup && sender.tab) {
    if (!platformFor(sender.url) || !['media-bootstrap', 'media-release', 'media-change'].includes(message.type)) return;
    initialized.then(async () => {
      if (selection.tabId !== sender.tab.id) return { ok: false, gate: false };
      if (message.type === 'media-release') return enqueue(() => runAction('release', { targetTabId: sender.tab.id }));
      if (message.type === 'media-change') { report().catch(() => {}); return { ok: true }; }
      return { ok: true, gate: selection.gate === true };
    }).then(respond).catch(error => respond({ ok: false, message: error.message }));
    return true;
  }
  if (!isPopup) return;
  if (message.type === 'status') {
    popupState().then(respond).catch(error => respond({ ok: false, message: error.message }));
    return true;
  }
  enqueue(async () => {
    await initialized;
    if (message.type === 'connect') {
      await chrome.storage.local.set({ autoPair: true });
      await chrome.storage.local.remove('token');
      ready = false; cancelCommands(); clearTimeout(reconnect); clearTimeout(handshake); clearInterval(keepAlive);
      const previous = socket; socket = null; previous?.close(); await connect();
    } else if (message.type === 'select') {
      const tab = await chrome.tabs.get(message.tabId);
      const platform = platformFor(tab.url);
      if (!platform) throw new Error('Choose a tab on a registered media site.');
      if (!await chrome.permissions.contains({ origins: [permissionFor(tab.url)] })) throw new Error('Allow this site using the Use this tab button.');
      if (selection.tabId && selection.tabId !== message.tabId) {
        const result = await runAction('pause');
        if (!result.ok) throw new Error(`The previous tab could not pause. ${result.message}`);
        await runAction('release');
      }
      await registerSites();
      await installInTab(tab.id);
      selection = { tabId: tab.id, gate: selection.tabId === tab.id && selection.gate === true }; await saveSelection();
      lastMessage = `${platform.name} tab selected.`;
      if (selection.gate) await runAction('pause');
    } else if (message.type === 'release') {
      const result = await runAction('release'); if (!result.ok) throw new Error(result.message);
    } else if (message.type === 'disconnect') {
      if (selection.tabId) await runAction('release');
      await chrome.storage.local.remove('token');
      await chrome.storage.local.set({ autoPair: false });
      ready = false; cancelCommands(); clearTimeout(reconnect); clearTimeout(handshake); clearInterval(keepAlive);
      const previous = socket; socket = null; previous?.close();
      lastMessage = 'Disconnected. Choose Connect companion when you want to reconnect.';
    } else if (message.type !== 'status') throw new Error('Unknown extension action.');
  }).then(popupState).then(respond).catch(error => respond({ ok: false, message: error.message || 'The extension could not complete this action.' }));
  return true;
});
chrome.tabs.onRemoved.addListener(id => { if (selection.tabId === id) report().catch(() => {}); });
chrome.tabs.onUpdated.addListener((id, changes) => {
  if (selection.tabId === id && (changes.status === 'complete' || changes.url || changes.audible !== undefined)) report().catch(() => {});
});
chrome.permissions.onAdded.addListener(() => registerSites().catch(() => {}));
chrome.permissions.onRemoved.addListener(() => { registerSites().catch(() => {}); report().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => connect().catch(() => {}));
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'reconnect') connect().catch(() => {}); });
chrome.alarms.create('reconnect', { periodInMinutes: 1 });
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
registerSites().catch(() => {});
connect().catch(() => {});
