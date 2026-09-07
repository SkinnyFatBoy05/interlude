export function supportSummary(state) {
  return {
    app: 'Interlude', version: state.version, platform: state.platform,
    monitoring: state.monitoring ?? 'project', enabled: state.enabled, mode: state.mode,
    status: state.status, sessions: state.sessionCount ?? 0, working: state.runningCount ?? 0,
    awaitingAcknowledgement: state.attentionCount ?? 0,
    hooksDetected: Boolean(state.hookSeenAt),
    browser: { connected: Boolean(state.browser?.connected), selected: Boolean(state.browser?.selected),
      mediaReady: Boolean(state.browser?.mediaReady), platform: state.browser?.platform || null },
    native: state.diagnostics ? { supported: state.diagnostics.supported, helperReady: state.diagnostics.helperReady,
      code: state.diagnostics.code, focused: state.diagnostics.focused } : { checked: false },
  };
}
