// Shared by the website and desktop accessibility observers. Missing controls
// never mean completion; a fresh finish signal is required after observed work.
export function validSignal(signal) {
  return signal && ['working', 'attention', 'completed', 'failed', 'composer'].every(k => typeof signal[k] === 'boolean')
    && Number.isInteger(signal.copies) && signal.copies >= 0 && signal.copies <= 10000;
}
export function advanceSignal(previous, signal, now) {
  const next = { ...previous, observedAt: now };
  if (signal.attention && previous.started) return { ...next, status: 'attention', settledAt: null };
  if (signal.working) {
    if (!previous.started || ['complete', 'failed'].includes(previous.status)) return { ...next, started: true, status: 'running', baseline: signal.copies, finishCleared: !signal.completed, startedAt: now, settledAt: null, unknownAt: null };
    return { ...next, status: 'running', finishCleared: previous.finishCleared || !signal.completed, settledAt: null, unknownAt: null };
  }
  if (!previous.started) return { ...next, status: 'idle' };
  if (['complete', 'failed'].includes(previous.status)) return next;
  if (signal.failed) return { ...next, status: 'failed', settledAt: null };
  next.finishCleared = previous.finishCleared || !signal.completed;
  if ((signal.completed && previous.finishCleared) || (signal.composer && signal.copies > previous.baseline)) {
    const settledAt = previous.settledAt ?? now;
    return { ...next, settledAt, status: now - settledAt >= 1500 ? 'complete' : 'settling' };
  }
  return { ...next, status: 'unknown', settledAt: null, unknownAt: previous.unknownAt ?? now };
}
