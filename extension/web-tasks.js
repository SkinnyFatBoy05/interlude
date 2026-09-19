import { assistantFor, AI_MATCHES, taskURL } from './assistants.js';
import { validSignal, advanceSignal } from './task-signals.js';

export class WebTasks {
  constructor({ chrome, media, now = Date.now }) {
    this.chrome = chrome; this.media = media; this.now = now;
    this.state = { enabled: false, mode: 'fun', tasks: {}, notice: 'Watch a Claude or Codex task tab. No companion is needed for websites.' };
    this.epoch = 0; this.controller = new AbortController(); this.tail = Promise.resolve(); this.inbox = Promise.resolve(); this.pending = null;
    this.initialized = chrome.storage.session.get('webTasks').then(({ webTasks }) => {
      if (webTasks && typeof webTasks.enabled === 'boolean') this.state = webTasks;
    });
  }
  async save() { await this.chrome.storage.session.set({ webTasks: this.state }); }
  invalidate() { this.epoch++; this.controller.abort(); this.controller = new AbortController(); clearTimeout(this.pending); }
  enqueue(fn) { const next = this.tail.then(fn); this.tail = next.catch(() => {}); return next; }
  async register() {
    const granted = await this.chrome.permissions.getAll();
    const matches = AI_MATCHES.filter(origin => granted.origins?.includes(origin));
    await this.chrome.scripting.unregisterContentScripts({ ids: ['interlude-assistants'] }).catch(() => {});
    if (matches.length) await this.chrome.scripting.registerContentScripts([{ id: 'interlude-assistants', matches, js: ['assistant-observer.js'], runAt: 'document_idle', persistAcrossSessions: true }]);
  }
  async watch(tabId) {
    await this.initialized;
    const tab = await this.chrome.tabs.get(tabId), assistant = assistantFor(tab.url);
    if (!assistant || !await this.chrome.permissions.contains({ origins: [assistant.origin] })) throw new Error('Allow access to a Claude or Codex task tab first.');
    if (Object.keys(this.state.tasks).length >= 32 && !this.state.tasks[tabId]) throw new Error('Stop watching a tab before adding more than 32.');
    this.state.tasks[tabId] = { id: tabId, name: assistant.name, title: (tab.title || assistant.name).slice(0, 120), url: taskURL(tab.url), status: 'idle', started: false, observedAt: this.now() };
    await this.save(); await this.register();
    await this.chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['assistant-observer.js'] });
  }
  async configure({ enabled, mode }) {
    await this.initialized;
    if (enabled !== undefined && typeof enabled !== 'boolean') throw new Error('Invalid monitoring setting.');
    if (mode !== undefined && !['fun', 'learn'].includes(mode)) throw new Error('Invalid mode.');
    this.invalidate();
    if (enabled !== undefined) this.state.enabled = enabled;
    if (mode !== undefined) this.state.mode = mode;
    // Re-arming requires fresh work, not completion of a historical task.
    for (const task of Object.values(this.state.tasks)) Object.assign(task, { started: false, status: 'idle', acknowledged: false, handedOff: false });
    await this.enqueue(() => this.media('release'));
    this.state.notice = this.state.enabled ? 'Website monitoring on. Send a prompt in a watched tab.' : 'Website monitoring off. Desktop hooks can control media.';
    await this.save();
  }
  async remove(tabId) {
    await this.initialized;
    if (!this.state.tasks[tabId]) return;
    const wasWorking = this.state.enabled && this.state.tasks[tabId].started;
    this.invalidate(); delete this.state.tasks[tabId];
    const paused = wasWorking ? await this.enqueue(() => this.media('pause')) : null;
    this.state.notice = !wasWorking ? 'A watched tab closed or was removed.'
      : paused?.ok ? 'A watched tab closed or was removed. Playback paused; start a new task to continue.'
        : 'A watched tab closed or was removed. Pause media manually; the player did not confirm.';
    await this.save();
  }
  async navigation(tabId, url) {
    await this.initialized;
    const task = this.state.tasks[tabId]; if (!task || taskURL(url) === task.url) return;
    if (!assistantFor(url)) { await this.remove(tabId); return; }
    const wasWorking = this.state.enabled && task.started;
    this.invalidate();
    Object.assign(task, { started: false, status: 'idle', url: taskURL(url), acknowledged: false, handedOff: false, notified: null });
    if (wasWorking) await this.enqueue(() => this.media('pause'));
    this.state.notice = 'The watched page changed. Waiting for a fresh task signal.'; await this.save();
  }
  accept(message, sender) {
    const next = this.inbox.then(() => this.acceptSignal(message, sender));
    this.inbox = next.catch(() => {}); return next;
  }
  async acceptSignal(message, sender) {
    await this.initialized;
    const task = this.state.tasks[sender.tab?.id];
    if (!task || sender.frameId !== 0 || !assistantFor(sender.url) || !validSignal(message.signal)
      || !/^[\w-]{1,80}$/.test(message.documentId ?? '') || !Number.isSafeInteger(message.sequence) || message.sequence < 1) return;
    const tab = await this.chrome.tabs.get(task.id).catch(() => null);
    if (!tab || !assistantFor(tab.url) || taskURL(tab.url) !== taskURL(message.url) || taskURL(sender.url) !== taskURL(message.url)) return;
    if (!await this.chrome.permissions.contains({ origins: [assistantFor(tab.url).origin] })) return;
    if (task.documentId === message.documentId && message.sequence <= (task.sequence ?? 0)) return;
    // A navigation cannot finish the task that was running in the old document.
    if (task.documentId !== message.documentId || task.url !== taskURL(message.url)) {
      this.invalidate();
      if (task.started && this.state.enabled) await this.enqueue(() => this.media('pause'));
      Object.assign(task, { started: false, status: 'idle', acknowledged: false, handedOff: false, settledAt: null });
    }
    const previous = task.status;
    Object.assign(task, advanceSignal(task, message.signal, this.now()), { documentId: message.documentId, sequence: message.sequence, url: taskURL(message.url) });
    if (task.status === 'unknown') this.state.notice = `${task.name}: waiting for a positive task signal. Missing controls do not mean completion.`;
    if (!this.state.enabled) { task.started = false; task.status = 'idle'; }
    if (previous !== task.status) { this.invalidate(); task.acknowledged = false; }
    if (task.status === 'running' && (previous !== 'running' || task.observationPaused)) { task.handedOff = false; task.notified = null; task.observationPaused = false; }
    await this.save();
    this.schedule();
  }
  schedule() {
    if (!this.state.enabled) return;
    clearTimeout(this.pending);
    const epoch = this.epoch;
    this.pending = setTimeout(() => this.enqueue(() => this.act(epoch)).catch(async error => { this.state.notice = error.message; await this.save(); }), 200);
  }
  async watchdog() { await this.initialized; return this.enqueue(() => this.act(this.epoch)); }
  async act(epoch) {
    if (!this.state.enabled || epoch !== this.epoch) return;
    const signal = this.controller.signal;
    const current = () => this.state.enabled && epoch === this.epoch && !signal.aborted;
    const tasks = Object.values(this.state.tasks);
    const unavailable = tasks.filter(t => t.started && !['attention', 'complete', 'failed'].includes(t.status)
      && (this.now() - t.observedAt > 15000 || (t.status === 'unknown' && this.now() - t.unknownAt >= 10000)));
    if (unavailable.some(t => !t.observationPaused)) {
      const result = await this.media('pause', { signal });
      if (!current()) return;
      for (const task of unavailable) { task.observationPaused = true; task.handedOff = false; }
      this.state.notice = result.ok ? 'Task signals unavailable. Playback paused; reopen the watched task to continue.' : 'Task signals unavailable. Pause media manually; the player did not confirm.';
      await this.save(); return;
    }
    const attention = tasks.find(t => ['attention', 'complete', 'failed'].includes(t.status) && !t.acknowledged);
    if (attention) {
      if (attention.notified === attention.status) return;
      const result = await this.media('pause', { signal });
      if (!current()) return;
      const tab = await this.chrome.tabs.get(attention.id).catch(() => null);
      if (!tab || taskURL(tab.url) !== attention.url) return;
      await this.chrome.tabs.update(tab.id, { active: true });
      if (!current()) return;
      const window = await this.chrome.windows.get(tab.windowId);
      if (!current()) return;
      await this.chrome.windows.update(tab.windowId, { focused: true, ...(window.state === 'minimized' ? { state: 'normal' } : {}) });
      attention.notified = attention.status;
      this.state.notice = `${attention.name}: ${attention.status === 'complete' ? 'response ready' : attention.status === 'failed' ? 'task stopped or failed' : 'your attention is needed'}.${result.ok ? '' : ' Playback pause was not confirmed. Pause manually.'}`;
      await this.save(); return;
    }
    if (tasks.some(t => ['attention', 'complete', 'failed'].includes(t.status) && !t.acknowledged)) return;
    // Unrecognized UI or a missing heartbeat blocks new media handoffs.
    if (tasks.some(t => t.started && (['unknown', 'settling'].includes(t.status) || this.now() - t.observedAt > 15000))) return;
    const running = tasks.filter(t => t.status === 'running').sort((a,b) => b.startedAt - a.startedAt)[0];
    if (!running || running.handedOff || this.now() - running.startedAt < 1200) return;
    let result;
    if (this.state.mode === 'learn') {
      result = await this.media('pause', { signal });
      if (!current() || !result.ok) return;
      const url = this.chrome.runtime.getURL('learning.html');
      const existing = (await this.chrome.tabs.query({ url }))[0];
      if (!current()) return;
      const tab = existing || await this.chrome.tabs.create({ url, active: false });
      if (!current()) return;
      await this.chrome.tabs.update(tab.id, { active: true });
      await this.chrome.windows.update(tab.windowId, { focused: true });
    } else result = await this.media('break', { signal, resume: true });
    if (!current()) return;
    running.handedOff = result?.ok === true;
    this.state.notice = result?.ok ? `${running.name} is working. ${this.state.mode === 'learn' ? 'Learning break.' : 'Enjoy your media.'}` : result?.message || 'Media handoff failed.';
    await this.save();
  }
  async acknowledge() {
    await this.initialized; this.invalidate();
    const task = Object.values(this.state.tasks).find(t => ['attention', 'complete', 'failed'].includes(t.status) && !t.acknowledged);
    if (task) task.acknowledged = true;
    for (const item of Object.values(this.state.tasks)) if (item.status === 'running') item.handedOff = false;
    await this.save(); this.schedule();
  }
}
