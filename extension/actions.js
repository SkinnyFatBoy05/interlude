import { platformFor } from './platforms.js';

export const COMPANION = 'http://127.0.0.1:4318/';
export const isYouTube = url => platformFor(url)?.id === 'youtube';
const failure = message => ({ ok: false, mediaReady: false, message });
const cancelled = () => failure('This browser action was cancelled.');
const check = options => options.signal?.aborted === true;

export async function withTimeout(promise, ms = 3500, signal) {
  let timer; let abort;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('The player did not respond in time. Reload the selected tab and try again.')), ms);
        abort = () => reject(new Error('This browser action was cancelled.'));
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

// Each frame answers separately; a broadcast can return an arbitrary frame's
// response and incorrectly confirm that all the tab's players have paused.
export async function mediaAction(chrome, tab, action, options = {}) {
  try {
    let frames = chrome.webNavigation
      ? await withTimeout(chrome.webNavigation.getAllFrames({ tabId: tab.id }), 3500, options.signal)
      : [{ frameId: 0, url: tab.url }];
    if (check(options)) return cancelled();
    frames = (frames ?? []).filter(frame => platformFor(frame.url));
    if (!frames.some(frame => frame.frameId === 0)) frames.unshift({ frameId: 0, url: tab.url });
    const requestFrame = async (frame, allowResume = true) => {
      if (check(options)) return cancelled();
      try {
        const response = await withTimeout(chrome.tabs.sendMessage(tab.id, {
          // A cross-origin child cannot verify its visibility in the parent.
          // Release its gate, but require manual Play instead of resuming a
          // potentially scrolled-away embedded clip.
          type: 'interlude-media', action, resume: options.resume === true && frame.frameId === 0 && allowResume,
          commandId: options.commandId, gate: options.gate === true,
          cancelledAction: options.cancelledAction,
        }, { frameId: frame.frameId }), 1500, options.signal);
        if (!response || typeof response.ok !== 'boolean') throw new Error('The player returned no confirmation.');
        return response;
      } catch (error) {
        return failure(`${frame.frameId ? 'An embedded player' : platformFor(tab.url)?.name || 'The selected tab'} could not be reached. Reload the selected tab and allow this site in Interlude. ${error.message || ''}`);
      }
    };
    const main = frames.find(frame => frame.frameId === 0);
    const children = frames.filter(frame => frame.frameId !== 0);
    let results;
    if (action === 'pause') {
      // The root can inspect same-origin iframe DOM. Give it ownership before
      // child adapters verify the already-paused elements.
      const rootResult = await requestFrame(main);
      results = [rootResult, ...await Promise.all(children.map(frame => requestFrame(frame)))];
    } else if (action === 'resume') {
      // Release child guards before the root resumes its owned same-origin
      // media; otherwise a child play listener would immediately stop it.
      const childResults = await Promise.all(children.map(frame => requestFrame(frame)));
      results = [await requestFrame(main, childResults.every(result => result.ok)), ...childResults];
    } else results = await Promise.all(frames.map(frame => requestFrame(frame)));
    if (check(options)) return cancelled();
    const failed = results.find(result => !result.ok);
    if (failed) return failed;
    const mediaReady = results.some(result => result.mediaReady === true);
    if (action === 'pause' || action === 'cancel') {
      if (results.some(result => result.frames?.some(url => !platformFor(url)))) {
        return failure('A visible embedded frame is outside Interlude’s registered sites. Pause it manually; this tab’s playback cannot be fully verified.');
      }
      // Also check audio from inaccessible embeds, Web Audio or closed roots.
      for (let attempt = 0; attempt < 3; attempt++) {
        const fresh = await chrome.tabs.get(tab.id);
        if (!fresh.audible) break;
        if (attempt === 2) return failure('This tab is still producing audio. Pause its player manually, then try again. An embedded or protected player may be outside Interlude’s access.');
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    return { ok: true, mediaReady, paused: action === 'pause' || action === 'cancel', gate: results.some(result => result.gate),
      message: action === 'pause' ? (mediaReady ? 'Playback paused. Autoplay is held until your next break.' : 'Autoplay is held. Open a video or audio player to prepare your next break.')
        : results.find(result => result.mediaReady)?.message || results[0]?.message || 'The tab is ready.' };
  } catch (error) { return failure(error.message || 'The selected tab could not be reached. Reload it and try again.'); }
}

export async function performAction(chrome, selection, action, options = {}) {
  if (check(options)) return cancelled();
  if (action === 'learn') {
    if (selection.tabId) {
      const pause = await performAction(chrome, selection, 'pause', options);
      if (!pause.ok || check(options)) return check(options) ? cancelled() : pause;
    }
    const tabs = await chrome.tabs.query({ url: `${COMPANION}*` });
    if (check(options)) return cancelled();
    const tab = tabs[0] ?? await chrome.tabs.create({ url: COMPANION, active: false });
    if (check(options)) return cancelled();
    await chrome.tabs.update(tab.id, { active: true });
    if (check(options)) return cancelled();
    const window = await chrome.windows.get(tab.windowId);
    if (check(options)) return cancelled();
    await chrome.windows.update(tab.windowId, window.state === 'minimized' ? { state: 'normal', focused: true } : { focused: true });
    return check(options) ? cancelled() : { ok: true };
  }
  if (!selection.tabId) return failure('Select a media tab in the Interlude extension.');
  let tab;
  try { tab = await chrome.tabs.get(selection.tabId); } catch { return failure('The selected media tab was closed. Choose another tab.'); }
  tab = { ...tab, id: tab.id ?? selection.tabId };
  if (check(options)) return cancelled();
  if (!platformFor(tab.url)) return failure('The selected tab has left a registered media site. Choose another tab in Interlude.');
  if (action === 'minimize') { await chrome.windows.update(tab.windowId, { state: 'minimized' }); return check(options) ? cancelled() : { ok: true }; }
  if (!['break', 'pause', 'status', 'release', 'cancel'].includes(action)) return failure('Unknown browser action.');
  if (action === 'break') {
    const window = await chrome.windows.get(tab.windowId);
    if (check(options)) return cancelled();
    await chrome.windows.update(tab.windowId, window.state === 'minimized' ? { state: 'normal', focused: true } : { focused: true });
    if (check(options)) return cancelled();
    await chrome.tabs.update(tab.id, { active: true });
    if (check(options)) return cancelled();
  }
  return mediaAction(chrome, tab, action === 'break' ? 'resume' : action, options);
}
