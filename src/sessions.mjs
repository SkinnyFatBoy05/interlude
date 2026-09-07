import { Session } from './session.mjs';
import { scopeKey, pathStyle } from './events.mjs';

const settingKeys = ['enabled', 'mode', 'autoReturn', 'maximize', 'resume', 'minimize'];
const waiting = status => ['permission', 'input', 'stopping'].includes(status);

// One reducer per Codex session; only this coordinator owns desktop handoffs.
export class Sessions {
  constructor({ cwd, now = Date.now, limit = 32 } = {}) {
    this.cwd = cwd; this.now = now; this.limit = limit;
    this.idle = new Session({ cwd, now });
    this.entries = new Map(); this.alerts = new Map(); this.acknowledged = new Set();
    this.retiredTurns = new Map();
    this.active = null; this.epoch = 0; this.revision = 0; this.lastAlert = null;
    this.manualHold = false; this.notice = ''; this.hookSeenAt = null;
    this.settings = Object.fromEntries(settingKeys.map(key => [key, this.idle.state[key]]));
  }
  key(id, state) { return `${id}:${state.turn}:${state.status}`; }
  get selected() { return this.entries.get(this.alerts.values().next().value?.id ?? this.active); }
  get pending() { return this.selected?.pending; }
  get activeCwd() { return this.selected?.cwd ?? this.cwd; }
  get state() {
    const current = this.selected?.state ?? this.idle.state;
    return { ...current, ...this.settings, project: pathStyle(this.activeCwd).basename(this.activeCwd),
      notice: this.notice, manualHold: this.manualHold, revision: this.revision, hookSeenAt: this.hookSeenAt,
      monitoring: 'all', activeProject: this.activeCwd, sessionCount: this.entries.size,
      runningCount: [...this.entries.values()].filter(item => item.state.status === 'running').length,
      attentionCount: this.alerts.size,
      tasks: [...this.entries].map(([id, item]) => ({ id, project: pathStyle(item.cwd).basename(item.cwd),
        status: item.state.status, needsAttention: this.alerts.has(this.key(id, item.state)) })),
    };
  }
  bump() { this.epoch++; this.revision++; }
  note(message) { this.notice = message; this.revision++; }
  blocked() {
    return this.manualHold || this.alerts.size > 0 || [...this.entries].some(([id, item]) =>
      waiting(item.state.status) && !this.acknowledged.has(this.key(id, item.state)));
  }
  reconcile() {
    const currentKeys = new Set([...this.entries].map(([id, item]) => this.key(id, item.state)));
    for (const key of this.acknowledged) if (!currentKeys.has(key)) this.acknowledged.delete(key);
    const head = this.alerts.keys().next().value;
    for (const [key, alert] of this.alerts) {
      const item = this.entries.get(alert.id);
      if (!item || key !== this.key(alert.id, item.state)) this.alerts.delete(key);
    }
    if (head !== this.alerts.keys().next().value) { this.lastAlert = null; this.bump(); }
  }
  resumeOther() {
    if (!this.settings.enabled || this.blocked()) return;
    const candidates = [...this.entries].filter(([, item]) => item.state.status === 'running');
    candidates.sort((a, b) => b[1].state.startedAt - a[1].state.startedAt);
    if (candidates.length) { this.active = candidates[0][0]; candidates[0][1].browserRejoined(); this.bump(); }
  }
  receive(event) {
    if (this.now() - event.at > 15000 || event.at - this.now() > 5000) return [];
    for (const [key, expires] of this.retiredTurns) if (expires < this.now()) this.retiredTurns.delete(key);
    if (this.retiredTurns.has(`${event.session}:${event.turn}`)) return [];
    let item = this.entries.get(event.session);
    if (!item) {
      if (event.event !== 'UserPromptSubmit') return [];
      if (this.entries.size >= this.limit) {
        const removable = [...this.entries].find(([id, entry]) => !['running', 'stopping', 'permission', 'input'].includes(entry.state.status)
          && ![...this.alerts.values()].some(alert => alert.id === id));
        if (!removable) { this.note(`Tracking ${this.limit} chats. Finish or acknowledge a task before starting another.`); return []; }
        for (const turn of removable[1].turns) this.retiredTurns.set(turn, this.now() + 20000);
        while (this.retiredTurns.size > 10000) this.retiredTurns.delete(this.retiredTurns.keys().next().value);
        this.entries.delete(removable[0]);
      }
      item = new Session({ cwd: event.cwd, now: this.now }); item.update(this.settings);
      this.entries.set(event.session, item);
    }
    if (scopeKey(item.cwd) !== scopeKey(event.cwd)) return [];
    const previousEpoch = item.epoch, previousRevision = item.state.revision;
    const wasBlocked = this.blocked();
    const effects = item.receive(event);
    if (item.state.revision === previousRevision) return [];
    this.hookSeenAt = this.now(); this.revision++;
    const newPrompt = event.event === 'UserPromptSubmit' && item.epoch !== previousEpoch;
    if (item.epoch !== previousEpoch && (event.event === 'PermissionRequest' || (event.event === 'PreToolUse' && event.tool === 'question'))) {
      this.acknowledged.delete(this.key(event.session, item.state));
    }
    if (newPrompt) {
      this.manualHold = false;
      this.notice = '';
      if (!this.alerts.size || this.selected === item) this.active = event.session;
    }
    if (this.selected === item && item.epoch !== previousEpoch) this.bump();
    this.reconcile();
    if (newPrompt && !this.alerts.size) this.active = event.session;
    if (wasBlocked && !this.blocked() && !newPrompt) this.resumeOther();
    // A cancelled background task must not pause the active task's break.
    return event.session === this.active ? effects.filter(effect => effect.type === 'pause') : [];
  }
  tick() {
    let handoff = null;
    for (const [id, item] of this.entries) {
      const revision = item.state.revision;
      for (const effect of item.tick()) {
        if (effect.type === 'attention') {
          const key = this.key(id, item.state);
          if (!this.acknowledged.has(key)) this.alerts.set(key, { id, effect });
        } else if (effect.type === 'handoff' && id === this.active) handoff = effect;
      }
      if (revision !== item.state.revision) this.revision++;
    }
    this.reconcile();
    const [key, alert] = this.alerts.entries().next().value ?? [];
    if (alert && key !== this.lastAlert && this.settings.enabled && !this.manualHold) {
      this.lastAlert = key; this.bump(); return [alert.effect];
    }
    return handoff && !this.blocked() && this.settings.enabled ? [handoff] : [];
  }
  acknowledge() {
    const [key] = this.alerts.entries().next().value ?? [];
    if (!key) return [];
    this.alerts.delete(key); this.acknowledged.add(key);
    if (this.acknowledged.size > 1000) this.acknowledged.delete(this.acknowledged.values().next().value);
    this.lastAlert = null; this.note('Acknowledged. Playback resumes only if another chat is working.'); this.bump();
    this.resumeOther(); return [];
  }
  update(patch) {
    const previous = { ...this.settings };
    this.idle.update(patch); // Validate completely before mutating any live session.
    Object.assign(this.settings, patch);
    if (!settingKeys.some(key => previous[key] !== this.settings[key])) return [];
    for (const item of this.entries.values()) item.update(patch);
    if (patch.mode || (!previous.enabled && this.settings.enabled)) this.manualHold = false;
    this.lastAlert = null; this.bump();
    if (!this.settings.enabled) return previous.enabled ? [{ type: 'pause' }] : [];
    this.resumeOther(); return [];
  }
  manualReturn() { this.manualHold = true; this.bump(); }
  browserRejoined() { this.resumeOther(); }
}
