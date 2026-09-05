import path from 'node:path';
import { scopeKey } from './events.mjs';

const busy = status => ['running', 'stopping', 'permission', 'input'].includes(status);
const remember = (set, key, limit = 1000) => { set.add(key); if (set.size > limit) set.delete(set.values().next().value); };

export class Session {
  constructor({ cwd, now = Date.now } = {}) {
    this.cwd = cwd;
    this.now = now;
    this.seen = new Set();
    this.turns = new Set();
    this.finishedTools = new Map();
    this.waits = new Map();
    this.epoch = 0;
    this.pending = null;
    this.waitKey = null;
    this.state = {
      enabled: false, mode: 'fun', autoReturn: true, maximize: true, resume: true, minimize: false,
      session: null, turn: null, status: 'idle', startedAt: null, project: path.basename(cwd ?? '') || 'Your project',
      hookSeenAt: null, updatedAt: now(), revision: 0, activity: [], notice: '', manualHold: false,
    };
  }

  update(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid settings.');
    const allowed = ['enabled', 'mode', 'autoReturn', 'maximize', 'resume', 'minimize'];
    for (const key of Object.keys(patch)) {
      if (!allowed.includes(key)) throw new Error('Unknown setting.');
      if (key === 'mode' ? !['fun', 'learn'].includes(patch[key]) : typeof patch[key] !== 'boolean') throw new Error('Invalid setting.');
    }
    const wasEnabled = this.state.enabled;
    const changed = Object.keys(patch).some(key => this.state[key] !== patch[key]);
    if (!changed) return [];
    this.epoch += 1;
    Object.assign(this.state, patch);
    if ((!wasEnabled && this.state.enabled) || patch.mode) this.state.manualHold = false;
    this.touch();
    if (!this.state.enabled) {
      // Completion is also an internal status transition. Keep that transition, but tick() will emit no action.
      if (this.pending?.reason !== 'complete') this.pending = null;
      return wasEnabled ? [{ type: 'pause' }] : [];
    }
    if (this.state.status === 'running' && !this.state.manualHold) this.pending = { type: 'handoff', due: this.now() + 500 };
    else if (['permission', 'input'].includes(this.state.status) && !this.state.manualHold) this.pending = { type: 'attention', reason: this.state.status, due: this.now() + 300 };
    return [];
  }

  manualReturn() {
    this.epoch += 1;
    this.state.manualHold = true;
    if (this.pending?.reason !== 'complete') this.pending = null;
    this.touch();
  }

  browserRejoined() {
    if (this.state.enabled && !this.state.manualHold && this.state.status === 'running') {
      this.epoch += 1;
      this.pending = { type: 'handoff', due: this.now() + 500 };
    }
  }

  touch() { this.state.updatedAt = this.now(); this.state.revision += 1; }
  note(text) { this.state.notice = text; this.touch(); }
  log(label, files = []) {
    this.state.activity.unshift({ at: this.now(), label, files });
    this.state.activity = this.state.activity.slice(0, 8);
  }

  receive(event) {
    const now = this.now();
    if (scopeKey(event.cwd) !== scopeKey(this.cwd) || now - event.at > 15000 || event.at - now > 5000 || this.seen.has(event.id)) return [];
    remember(this.seen, event.id);
    this.state.hookSeenAt = now;
    this.touch();
    if (event.event === 'UserPromptSubmit') {
      const turnKey = `${event.session}:${event.turn}`;
      if (this.turns.has(turnKey)) return [];
      if (this.state.session !== event.session && busy(this.state.status)) return [];
      if (this.state.startedAt !== null && event.at < this.state.startedAt) return [];
      remember(this.turns, turnKey);
      this.epoch += 1;
      this.waits.clear(); this.finishedTools.clear();
      Object.assign(this.state, { session: event.session, turn: event.turn, status: 'running', startedAt: event.at, notice: '', activity: [], manualHold: false });
      this.waitKey = null;
      this.log('Prompt submitted');
      this.pending = this.state.enabled ? { type: 'handoff', due: now + 1200 } : null;
      return [];
    }
    if (event.session !== this.state.session || (event.turn !== this.state.turn && event.event !== 'SessionEnd')) return [];
    if (['complete', 'interrupted', 'disconnected', 'idle'].includes(this.state.status)) return [];
    if (event.event === 'PermissionRequest' || (event.event === 'PreToolUse' && event.tool === 'question')) {
      if (event.event === 'PreToolUse' && event.at > (this.finishedTools.get(event.toolKey) ?? Infinity)) this.finishedTools.delete(event.toolKey);
      if (this.finishedTools.has(event.toolKey) || this.waits.has(event.toolKey)) return [];
      const reason = event.event === 'PermissionRequest' ? 'permission' : 'input';
      this.epoch += 1;
      this.waits.set(event.toolKey, { reason, asyncQuestion: event.asyncQuestion });
      this.waitKey = event.toolKey;
      this.state.status = [...this.waits.values()].some(wait => wait.reason === 'input') ? 'input' : 'permission';
      this.log(reason === 'permission' ? 'Permission requested' : 'A question needs your attention');
      this.pending = this.state.enabled && !this.state.manualHold ? { type: 'attention', reason: this.state.status, due: now + (reason === 'permission' ? 1400 : 300) } : null;
    } else if (event.event === 'Stop') {
      if (this.state.status === 'stopping') return [];
      this.epoch += 1;
      this.waits.clear();
      this.state.status = 'stopping';
      this.pending = { type: 'attention', reason: 'complete', due: now + 1200 };
      this.waitKey = null;
    } else if (event.event === 'Interrupt' || event.event === 'SessionEnd') {
      this.epoch += 1;
      this.waits.clear();
      this.pending = null;
      this.state.status = event.event === 'Interrupt' ? 'interrupted' : 'disconnected';
      this.log(event.event === 'Interrupt' ? 'You stopped this turn' : 'Codex session ended');
      return this.state.enabled ? [{ type: 'pause' }] : [];
    } else if (['PreToolUse', 'PostToolUse'].includes(event.event)) {
      const wasWaiting = ['permission', 'input', 'stopping'].includes(this.state.status);
      const waiting = this.waits.get(event.toolKey);
      const matchingResult = event.event === 'PostToolUse' && !!waiting && !event.asyncQuestion && !waiting.asyncQuestion;
      if (event.event === 'PostToolUse' && !event.asyncQuestion) {
        this.finishedTools.set(event.toolKey, event.at);
        if (this.finishedTools.size > 1000) this.finishedTools.delete(this.finishedTools.keys().next().value);
      }
      if (event.event === 'PreToolUse') this.finishedTools.delete(event.toolKey);
      if (matchingResult) this.waits.delete(event.toolKey);
      if (this.state.status === 'stopping' || (wasWaiting && matchingResult && this.waits.size === 0)) {
        this.epoch += 1;
        this.pending = null;
        this.state.status = 'running';
        this.waitKey = null;
        if (this.state.enabled && !this.state.manualHold) this.pending = { type: 'handoff', due: now + 900 };
      } else if (matchingResult) {
        this.epoch += 1;
        this.state.status = [...this.waits.values()].some(wait => wait.reason === 'input') ? 'input' : 'permission';
        this.pending = this.state.enabled && !this.state.manualHold ? { type: 'attention', reason: this.state.status, due: now + 300 } : null;
      }
      if (event.event === 'PostToolUse') this.log(event.tool === 'edit' ? 'File edit tool finished' : event.tool === 'command' ? 'Command finished' : 'Tool finished', event.files);
      else if (!wasWaiting) this.log(event.tool === 'edit' ? 'Editing project files' : event.tool === 'command' ? 'Running a command' : 'Using a tool');
    }
    return [];
  }

  tick() {
    if (!this.pending || this.now() < this.pending.due) return [];
    const next = this.pending;
    this.pending = null;
    if (next.reason === 'complete') { this.state.status = 'complete'; this.log('Codex finished responding'); this.touch(); }
    if (!this.state.enabled || this.state.manualHold) return [];
    if (next.type === 'handoff' && this.state.status !== 'running') return [];
    return [{ type: next.type, reason: next.reason, mode: this.state.mode, turn: this.state.turn }];
  }
}
