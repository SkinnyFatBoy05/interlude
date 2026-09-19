import { randomUUID, createHash } from 'node:crypto';
import { advanceSignal, validSignal } from '../extension/task-signals.js';

export class DesktopObserver {
  constructor({ cwd, receive, now = Date.now }) { this.cwd = cwd; this.receive = receive; this.now = now; this.reset(); }
  reset() { this.state = { started: false, status: 'idle' }; this.window = null; this.session = null; this.turn = null; this.unavailableAt = null; this.waiting = false; }
  emit(event) {
    if (!this.session || !this.turn) return;
    this.receive({ id: randomUUID(), at: this.now(), event, provider: 'claude', surface: 'desktop-ui', session: this.session,
      turn: this.turn, cwd: this.cwd, tool: 'tool', files: [], toolKey: 'c'.repeat(64), asyncQuestion: false });
  }
  sample(result) {
    const signal = result.observation;
    if (!signal?.available || !validSignal(signal)) {
      this.unavailableAt ??= this.now();
      if (this.state.started && this.now() - this.unavailableAt >= 10000) { this.emit('Interrupt'); this.reset(); }
      return;
    }
    this.unavailableAt = null;
    if (this.window !== signal.window) {
      if (this.state.started) this.emit('Interrupt');
      this.reset(); this.window = signal.window;
      this.session = 'claude-ui-' + createHash('sha256').update(signal.window).digest('hex');
    }
    const previous = this.state.status;
    this.state = advanceSignal(this.state, signal, this.now());
    if (this.state.status === 'unknown' && this.now() - this.state.unknownAt >= 10000) {
      this.emit('Interrupt'); this.reset(); return 'Claude task state became unavailable. Playback paused; select the task and start again.';
    }
    if (this.state.status === previous) return;
    if (this.state.status === 'running') {
      if (['idle', 'complete', 'failed'].includes(previous)) { this.waiting = false; this.turn = randomUUID(); this.emit('UserPromptSubmit'); }
      else if (this.waiting) { this.waiting = false; this.emit('PostToolUse'); }
    } else if (this.state.status === 'attention') { this.waiting = true; this.emit('PermissionRequest'); }
    else if (this.state.status === 'complete') { this.waiting = false; this.emit('Stop'); }
    else if (this.state.status === 'failed') { this.waiting = false; this.emit('Interrupt'); }
    if (this.state.status === 'unknown') return 'Waiting for a positive Claude task signal. Missing controls do not mean completion.';
  }
}
