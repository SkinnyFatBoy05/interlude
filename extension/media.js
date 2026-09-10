(() => {
  if (globalThis.__interludeMediaInstalled) return;
  globalThis.__interludeMediaInstalled = true;
  const owned = new Map();
  const observed = new WeakSet();
  const containers = new WeakMap();
  let gate = false;
  let revision = 0;
  let gateTimer;
  let banner;
  let changeTimer;
  let lastPage = page();
  const source = media => media.currentSrc || media.src || '';
  const playing = media => !media.paused && !media.ended;
  const audio = media => media.tagName?.toLowerCase() === 'audio';
  function page() { return location.href || `${location.pathname}${location.search || ''}${location.hash || ''}`; }
  function mediaPage(media) {
    return JSON.stringify([page(), ...(containers.get(media) || []).map(frame => {
      try { return frame.contentDocument?.URL || frame.src || ''; } catch { return null; }
    })]);
  }
  function area(media) {
    if (containers.get(media)?.some(frame => !area(frame))) return 0;
    const rect = media.getBoundingClientRect();
    const style = getComputedStyle(media);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return 0;
    return Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0))
      * Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
  }
  function collect(root = document, result = [], ancestors = []) {
    for (const media of root.querySelectorAll('video, audio')) {
      containers.set(media, ancestors);
      result.push(media);
      if (!observed.has(media)) {
        observed.add(media);
        media.addEventListener('play', () => {
          if (gate) { owned.delete(media); try { media.pause(); } catch { /* Reported on verification. */ } }
        });
        media.addEventListener('emptied', () => owned.delete(media));
        media.addEventListener('ended', () => owned.delete(media));
      }
    }
    // Public, open shadow DOM only. No site internals or DRM manipulation.
    for (const element of root.querySelectorAll('*')) if (element.shadowRoot) collect(element.shadowRoot, result, ancestors);
    for (const frame of root.querySelectorAll('iframe, frame')) {
      try { if (frame.contentDocument) collect(frame.contentDocument, result, [...ancestors, frame]); } catch { /* Cross-origin frames answer independently. */ }
    }
    return result;
  }
  function visibleFrames(root = document, result = []) {
    for (const frame of root.querySelectorAll('iframe, frame')) {
      if (!area(frame)) continue;
      try { if (frame.contentDocument) { visibleFrames(frame.contentDocument, result); continue; } } catch { /* Cross-origin. */ }
      result.push(frame.src || 'about:blank');
    }
    for (const element of root.querySelectorAll('*')) if (element.shadowRoot) visibleFrames(element.shadowRoot, result);
    return result;
  }
  function primary(players) {
    return players.filter(media => !audio(media) && area(media) > 0)
      .sort((left, right) => area(right) - area(left))[0];
  }
  function invalidate(players) {
    const currentPage = page();
    if (lastPage !== currentPage) { owned.clear(); lastPage = currentPage; }
    const main = primary(players);
    for (const [media, record] of owned) {
      if (!players.includes(media) || record.page !== mediaPage(media) || source(media) !== record.source
        || media.srcObject !== record.srcObject || media.ended || (!audio(media) && media !== main)) owned.delete(media);
    }
  }
  function ready(players) {
    return players.some(media => (source(media) || media.srcObject || media.readyState > 0) && (audio(media) || area(media) > 0));
  }
  function showBanner() {
    if (!gate || banner?.isConnected || (typeof window !== 'undefined' && window.top !== window)) return;
    if (!document.documentElement || !document.createElement) return;
    banner = document.createElement('div');
    banner.setAttribute('data-interlude-control', '');
    banner.style.cssText = 'position:fixed!important;bottom:18px!important;right:18px!important;z-index:2147483647!important;display:block!important;';
    const root = banner.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host{all:initial}aside{max-width:310px;padding:14px 16px;border:1px solid #30322d;border-left:3px solid #caff3d;border-radius:0;background:#0c0c0c;color:#f5f7ef;box-shadow:0 12px 36px #000a;font:14px/1.45 system-ui,sans-serif}p{margin:0 0 10px;color:#cbd0c6}button{padding:8px 11px;border:1px solid #caff3d;border-radius:0;background:transparent;color:#caff3d;font:650 13px system-ui;cursor:pointer}button:hover{background:#caff3d;color:#101400}button:focus-visible{outline:2px solid #caff3d;outline-offset:3px}';
    const box = document.createElement('aside'); box.setAttribute('aria-label', 'Interlude playback control');
    const message = document.createElement('p'); message.textContent = 'Interlude has paused playback while you focus.';
    const button = document.createElement('button'); button.textContent = 'Release playback';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const result = await chrome.runtime.sendMessage({ type: 'media-release' });
        if (!result?.ok) throw new Error();
        setGate(false); owned.clear();
      } catch { message.textContent = 'Open the Interlude extension and choose Release playback, or reload this tab if the extension was removed.'; button.disabled = false; }
    });
    box.append(message, button); root.append(style, box); document.documentElement.append(banner);
  }
  function enforce() {
    if (!gate) return;
    const players = collect(); invalidate(players);
    for (const media of players) if (playing(media)) {
      owned.delete(media); try { media.pause(); } catch { /* Verified by the command. */ }
    }
    showBanner();
  }
  function setGate(active) {
    gate = active;
    clearInterval(gateTimer);
    if (active) { showBanner(); gateTimer = setInterval(enforce, 500); }
    else { banner?.remove(); banner = null; }
  }
  // Capturing play catches newly inserted feed players before the next scan.
  document.addEventListener('play', event => {
    if (gate && typeof event.target?.pause === 'function') {
      owned.delete(event.target); try { event.target.pause(); } catch { /* Verified below. */ }
    }
  }, true);
  function announce() {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => { chrome.runtime.sendMessage?.({ type: 'media-change' }).catch(() => {}); }, 250);
  }
  document.addEventListener('loadedmetadata', announce, true);
  document.addEventListener('emptied', announce, true);
  document.addEventListener('play', announce, true);
  if (typeof MutationObserver !== 'undefined') new MutationObserver(() => { if (gate) enforce(); }).observe(document, { childList: true, subtree: true });
  document.addEventListener('yt-navigate-start', () => owned.clear());
  if (typeof addEventListener === 'function') {
    addEventListener('popstate', () => owned.clear());
    addEventListener('hashchange', () => owned.clear());
    addEventListener('scroll', () => { if (owned.size) invalidate(collect()); }, { passive: true });
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || message.type !== 'interlude-media') return;
    (async () => {
      const players = collect(); invalidate(players);
      if (message.action === 'status') return { ok: true, mediaReady: ready(players), gate,
        message: gate ? 'Playback is held while you focus.' : ready(players) ? 'A media player is ready.' : 'Open a video or audio player on this site.' };
      const currentRevision = ++revision;
      if (message.action === 'pause' || message.action === 'cancel') {
        const main = primary(players);
        // A rapid new prompt can cancel a pause after it stopped this exact
        // player but before verification acknowledged it. Keep that valid
        // ownership for the next break; cancellation itself never resumes.
        // Cancelling a break still invalidates ownership and late play promises.
        const cancelledPause = message.action === 'cancel' && ['pause', 'learn'].includes(message.cancelledAction);
        if (message.action === 'cancel' && !cancelledPause) owned.clear();
        if (!gate && message.action === 'pause') for (const media of players) {
          if (playing(media) && !media.muted && media.volume !== 0 && (audio(media) || media === main) && source(media)) {
            owned.set(media, { source: source(media), srcObject: media.srcObject, page: mediaPage(media) });
          }
        }
        setGate(true);
        for (const media of players) if (playing(media)) try { media.pause(); } catch { /* Check actual playback below. */ }
        if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen().catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 80));
        const remaining = collect();
        if (remaining.some(playing)) return { ok: false, mediaReady: ready(remaining), gate: true, message: 'Playback is still running. Pause this site manually, then try again.' };
        return { ok: true, mediaReady: ready(remaining), gate: true, paused: true, message: 'Playback paused. Autoplay is held until your next break.' };
      }
      if (message.action === 'release' || message.action === 'resume') {
        const resumable = message.action === 'resume' && message.resume ? [...owned.entries()] : [];
        owned.clear(); setGate(false);
        for (const [media, record] of resumable) {
          if (revision !== currentRevision) break;
          if (mediaPage(media) !== record.page || source(media) !== record.source || media.srcObject !== record.srcObject) continue;
          try {
            let timeout;
            const started = Promise.resolve(media.play()).then(() => {
              if (revision !== currentRevision || mediaPage(media) !== record.page || source(media) !== record.source || media.srcObject !== record.srcObject) media.pause();
            });
            try {
              await Promise.race([started, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Playback timed out.')), 1000); })]);
            } finally { clearTimeout(timeout); }
            if (revision !== currentRevision) return { ok: false, mediaReady: ready(players), gate, message: 'This playback action was cancelled.' };
            if (media.paused) throw new Error('Playback did not start.');
          } catch {
            // A pending play promise can resolve after timeout: invalidate it and
            // pause immediately so it cannot unexpectedly start later.
            revision++; try { media.pause(); } catch { /* Best effort. */ }
            return { ok: false, mediaReady: ready(players), gate, message: 'This site needs a click on Play before it can resume.' };
          }
        }
        return { ok: true, mediaReady: ready(players), gate: false, message: resumable.length ? 'Playback resumed.' : 'Playback released. Press Play whenever you are ready.' };
      }
      return { ok: false, message: 'Unknown playback action.' };
    })().then(result => reply({ ...result, frames: visibleFrames() })).catch(error => reply({ ok: false, mediaReady: false, message: `Could not control this player. ${error.message || 'Reload the selected tab.'}` }));
    return true;
  });
  const bootstrapRevision = revision;
  chrome.runtime.sendMessage?.({ type: 'media-bootstrap' }).then(state => {
    if (bootstrapRevision !== revision || !state?.gate) return;
    setGate(true); enforce();
  }).catch(() => {});
})();
