(() => {
  if (globalThis.__interludeAssistantObserver) return;
  globalThis.__interludeAssistantObserver = true;
  const documentId = crypto.randomUUID();
  let sequence = 0, last = '', lastSent = 0, scheduled = false;
  const visible = element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  function sample() {
    scheduled = false;
    const eligible = location.hostname === 'claude.ai' ? /^\/(?:new|chat(?:\/|$)|code(?:\/|$))/.test(location.pathname)
      : location.hostname === 'codex.chatgpt.com' || (['chatgpt.com', 'chat.openai.com'].includes(location.hostname) && /^\/codex(?:\/|$)/.test(location.pathname));
    if (!eligible) return;
    // Inspect controls/status labels only. Never read or transmit conversation
    // text, prompt fields, model output, account data, or private network APIs.
    const root = document.querySelector('main, [role="main"]') || document.body;
    if (!root) return;
    const buttons = [...root.querySelectorAll('button, [role="button"]')].filter(visible);
    const labels = buttons.map(b => (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').trim().toLowerCase());
    const statuses = [...root.querySelectorAll('[role="status"], [data-status], [data-state]')].filter(visible).map(e =>
      (e.getAttribute('aria-label') || e.getAttribute('data-status') || e.getAttribute('data-state') || (e.getAttribute('role') === 'status' ? e.textContent : '') || '').trim().toLowerCase());
    const working = labels.some(label => /^(stop|stop response|stop generating|stop streaming|stop task|cancel task)$/.test(label))
      || statuses.some(label => /^(running|working|in progress|thinking|queued)$/.test(label));
    const attention = labels.some(l => /^(allow once|approve|allow this time)$/.test(l)) && labels.some(l => /^(deny|reject|don't allow)$/.test(l))
      || statuses.some(l => /^(needs input|awaiting approval|waiting for your response|needs your attention)$/.test(l));
    const completed = statuses.some(l => /^(completed|complete|task complete|ready for review)$/.test(l));
    const failed = statuses.some(l => /^(failed|error|cancelled|canceled|interrupted)$/.test(l));
    const copies = labels.filter(l => /^(copy|copy response|copy message|copy to clipboard)$/.test(l)).length;
    const composer = [...root.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].some(e => visible(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true');
    const signal = { working, attention, completed, failed, copies, composer };
    const url = location.origin + location.pathname;
    const signature = JSON.stringify({ signal, url });
    if (signature === last && Date.now() - lastSent < 1000) return;
    last = signature; lastSent = Date.now();
    chrome.runtime.sendMessage({ type: 'assistant-signal', documentId, sequence: ++sequence, url, signal }).catch(() => {});
  }
  const observer = new MutationObserver(() => {
    if (!scheduled) { scheduled = true; setTimeout(sample, 100); }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  setInterval(sample, 1000); // SPA navigation and worker wake-up; bounded heartbeat.
  sample();
})();
