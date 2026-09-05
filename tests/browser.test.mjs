import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { isYouTube, performAction, withTimeout } from '../extension/actions.js';
import { PLATFORMS, SITE_MATCHES, OPTIONAL_MATCHES, platformFor } from '../extension/platforms.js';

const mediaCode = await readFile(new URL('../extension/media.js', import.meta.url), 'utf8');
function mockMedia({ paused = false, autoplayDenied = false, visible = true, source = 'video-one', top = 0, muted = false, volume = 1, tagName = 'VIDEO', refusesPause = false, delayedPlay } = {}) {
  const events = new Map();
  return { paused, ended: false, currentSrc: source, visible, top, muted, volume, tagName,
    pause() { if (!refusesPause) this.paused = true; },
    async play() { if (autoplayDenied) throw new Error('blocked'); if (delayedPlay) await delayedPlay; this.paused = false; for (const fn of events.get('play') || []) fn(); },
    addEventListener(name, fn) { events.set(name, [...events.get(name) || [], fn]); },
    getBoundingClientRect() { return { left: 100, top: this.top, right: this.visible ? 580 : 100, bottom: this.visible ? this.top + 720 : this.top, width: this.visible ? 480 : 0, height: this.visible ? 720 : 0 }; },
  };
}
function media({ players = [mockMedia()], pathname = '/watch?v=one', bootstrapGate = false, rootDocument } = {}) {
  let listener; let page = pathname;
  const events = new Map();
  const timers = new Set();
  const context = {
    chrome: { runtime: { id: 'test', onMessage: { addListener(fn) { listener = fn; } }, sendMessage: async () => ({ gate: bootstrapGate }) } },
    document: rootDocument || { querySelectorAll: selector => selector === 'video, audio' ? players : [], fullscreenElement: null, addEventListener(name, fn) { events.set(name, [...events.get(name) || [], fn]); } },
    innerWidth: 1920, innerHeight: 1080,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    location: { get pathname() { return page; }, search: '' },
    setTimeout, clearTimeout, setInterval(fn, ms) { const timer = setInterval(fn, ms); timer.unref(); timers.add(timer); return timer; }, clearInterval,
  };
  vm.runInNewContext(mediaCode, context);
  return { video: players[0], players,
    navigate() { page = '/watch?v=two'; for (const fn of events.get('yt-navigate-start') || []) fn(); },
    spaNavigate() { page = '/new-feed-item'; },
    autoplay(player) { player.paused = false; for (const fn of events.get('play') || []) fn({ target: player }); },
    close() { for (const timer of timers) clearInterval(timer); },
    send(action, resume = true, options = {}) { return new Promise(resolve => listener({ type: 'interlude-media', action, resume, ...options }, { id: 'test' }, resolve)); },
  };
}
function harness(t, options) { const h = media(options); t.after(() => h.close()); return h; }

test('pauses and resumes the exact owned video', async t => { const h = harness(t); assert.equal((await h.send('pause')).ok, true); assert.equal(h.video.paused, true); assert.equal((await h.send('resume')).ok, true); assert.equal(h.video.paused, false); });
test('a video paused by the user stays paused', async t => { const h = harness(t, { players: [mockMedia({ paused: true })] }); await h.send('pause'); await h.send('resume'); assert.equal(h.video.paused, true); });
test('resume preference releases autoplay without starting playback', async t => { const h = harness(t); await h.send('pause'); const result = await h.send('resume', false); assert.equal(h.video.paused, true); assert.equal(result.gate, false); });
test('explicit release clears gate without resuming and permits manual play', async t => { const h = harness(t); await h.send('pause'); await h.send('release'); assert.equal(h.video.paused, true); await h.video.play(); assert.equal(h.video.paused, false); });
test('navigation drops playback ownership', async t => { const h = harness(t); await h.send('pause'); h.navigate(); await h.send('resume'); assert.equal(h.video.paused, true); });
test('generic SPA navigation drops playback ownership', async t => { const h = harness(t); await h.send('pause'); h.spaNavigate(); await h.send('resume'); assert.equal(h.video.paused, true); });
test('a changed source is not resumed', async t => { const h = harness(t); await h.send('pause'); h.video.currentSrc = 'another-video'; await h.send('resume'); assert.equal(h.video.paused, true); });
test('replacing a player with the same source does not transfer ownership', async t => { const h = harness(t); await h.send('pause'); const next = mockMedia({ paused: true }); h.players.splice(0, 1, next); await h.send('resume'); assert.equal(next.paused, true); });
test('manual playback while held is stopped and forfeits ownership', async t => { const h = harness(t); await h.send('pause'); await h.video.play(); assert.equal(h.video.paused, true); await h.send('resume'); assert.equal(h.video.paused, true); });
test('autoplay rejection produces an actionable message', async t => { const h = harness(t, { players: [mockMedia({ autoplayDenied: true })] }); await h.send('pause'); const result = await h.send('resume'); assert.equal(result.ok, false); assert.match(result.message, /click on Play/); });
test('Shorts resumes the visible clip among inactive mounted videos', async t => {
  const inactive = mockMedia({ paused: true, visible: false }); const active = mockMedia({ source: 'visible-short' }); const next = mockMedia({ paused: true, visible: false, source: 'next-short' });
  const h = harness(t, { players: [inactive, active, next], pathname: '/shorts/one' }); await h.send('pause'); await h.send('resume');
  assert.equal(active.paused, false); assert.equal(inactive.paused, true); assert.equal(next.paused, true);
});
test('all playing videos and audio pause, but only primary visible video resumes', async t => {
  const hidden = mockMedia({ visible: false }); const active = mockMedia({ source: 'active' }); const preview = mockMedia({ muted: true, source: 'preview', top: 900 });
  const h = harness(t, { players: [hidden, active, preview] }); await h.send('pause'); assert.ok(h.players.every(player => player.paused)); await h.send('resume');
  assert.equal(active.paused, false); assert.equal(hidden.paused, true); assert.equal(preview.paused, true);
});
test('zero-size audio can resume its exact owned source', async t => { const h = harness(t, { players: [mockMedia({ tagName: 'AUDIO', visible: false })] }); await h.send('pause'); assert.equal(h.video.paused, true); await h.send('resume'); assert.equal(h.video.paused, false); });
test('muted previews are paused without becoming owned', async t => { const h = harness(t, { players: [mockMedia({ muted: true })] }); await h.send('pause'); await h.send('resume'); assert.equal(h.video.paused, true); });
test('a scrolled-away clip is never resumed', async t => {
  const first = mockMedia(); const next = mockMedia({ paused: true, visible: false, source: 'next-short' }); const h = harness(t, { players: [first, next] });
  await h.send('pause'); first.visible = false; next.visible = true; await h.send('resume'); assert.equal(first.paused, true); assert.equal(next.paused, true);
});
test('hidden mounted paused videos report unavailable readiness but can hold autoplay', async t => { const h = harness(t, { players: [mockMedia({ paused: true, visible: false })] }); const result = await h.send('pause'); assert.equal(result.ok, true); assert.equal(result.mediaReady, false); assert.equal(result.gate, true); });
test('media readiness leaves playing media unchanged', async t => { const h = harness(t); const result = await h.send('status'); assert.equal(result.mediaReady, true); assert.equal(h.video.paused, false); });
test('a text-only feed has a successful status and no ready player', async t => { const h = harness(t, { players: [] }); const result = await h.send('status'); assert.equal(result.ok, true); assert.equal(result.mediaReady, false); });
test('new feed autoplay is blocked while attention is held', async t => { const h = harness(t); await h.send('pause'); const next = mockMedia({ source: 'next' }); h.players.push(next); h.autoplay(next); assert.equal(next.paused, true); await h.send('resume'); assert.equal(next.paused, true); });
test('reload bootstrap holds new content without claiming resumable ownership', async t => { const h = harness(t, { bootstrapGate: true }); await new Promise(resolve => setImmediate(resolve)); assert.equal(h.video.paused, true); await h.send('resume'); assert.equal(h.video.paused, true); });
test('a player refusing pause returns failure', async t => { const h = harness(t, { players: [mockMedia({ refusesPause: true })] }); const result = await h.send('pause'); assert.equal(result.ok, false); assert.match(result.message, /still running/); });
test('cancellation stops a play promise that resolves late', async t => {
  let start; const delayedPlay = new Promise(resolve => { start = resolve; }); const h = harness(t, { players: [mockMedia({ delayedPlay })] });
  await h.send('pause'); const pending = h.send('resume'); const cancel = h.send('cancel'); start(); await Promise.all([pending, cancel]); assert.equal(h.video.paused, true); assert.equal((await h.send('status')).gate, true);
});
test('cancelling a pause before acknowledgment preserves ownership for the next break', async t => {
  const main = mockMedia(); const preview = mockMedia({ source: 'preview', muted: true, paused: true, top: 900 });
  const h = harness(t, { players: [main, preview] });
  const pendingPause = h.send('pause'); assert.equal(main.paused, true);
  h.autoplay(preview); assert.equal(preview.paused, true);
  await h.send('cancel', true, { cancelledAction: 'pause' });
  assert.equal(main.paused, true); assert.equal((await h.send('status')).gate, true);
  await pendingPause; await h.send('resume'); assert.equal(main.paused, false); assert.equal(preview.paused, true);
});
test('cancelling learning preserves its already-paused exact player without starting it', async t => {
  const h = harness(t); const pendingPause = h.send('pause');
  await h.send('cancel', true, { cancelledAction: 'learn' }); assert.equal(h.video.paused, true);
  await pendingPause; await h.send('resume'); assert.equal(h.video.paused, false);
});
test('cancelled pause never restores ownership after source change or manual playback', async t => {
  for (const change of [h => { h.video.currentSrc = 'another-source'; }, h => h.video.play()]) {
    const h = harness(t); const pendingPause = h.send('pause'); await change(h);
    await h.send('cancel', true, { cancelledAction: 'pause' }); await pendingPause;
    await h.send('resume'); assert.equal(h.video.paused, true);
  }
});
test('cancelled pause never claims a player paused by the user', async t => {
  const h = harness(t, { players: [mockMedia({ paused: true })] }); const pendingPause = h.send('pause');
  await h.send('cancel', true, { cancelledAction: 'pause' }); await pendingPause; await h.send('resume'); assert.equal(h.video.paused, true);
});
test('same-origin iframe ownership is captured by root and child guard releases before root resumes', async t => {
  const player = mockMedia();
  const childDocument = { querySelectorAll: selector => selector === 'video, audio' ? [player] : [], addEventListener() {} };
  const frame = { ...mockMedia(), contentDocument: childDocument, src: 'https://www.youtube.com/embed/one' };
  const rootDocument = { querySelectorAll: selector => selector === 'iframe, frame' ? [frame] : [], addEventListener() {} };
  const root = harness(t, { rootDocument }); const child = harness(t, { rootDocument: childDocument });
  const { chrome } = browserMock({ frames: [{ frameId: 0, url: 'https://www.youtube.com/watch?v=one' }, { frameId: 9, url: frame.src }],
    mediaResponse: (_id, message, { frameId }) => (frameId === 0 ? root : child).send(message.action, message.resume) });
  assert.equal((await performAction(chrome, { tabId: 99 }, 'pause')).ok, true); assert.equal(player.paused, true);
  assert.equal((await performAction(chrome, { tabId: 99 }, 'break', { resume: true })).ok, true); assert.equal(player.paused, false);
});
test('same-origin iframe navigation forfeits root playback ownership', async t => {
  const player = mockMedia();
  const childDocument = { URL: 'https://www.youtube.com/embed/one', querySelectorAll: selector => selector === 'video, audio' ? [player] : [], addEventListener() {} };
  const frame = { ...mockMedia(), contentDocument: childDocument, src: childDocument.URL };
  const rootDocument = { querySelectorAll: selector => selector === 'iframe, frame' ? [frame] : [], addEventListener() {} };
  const root = harness(t, { rootDocument });
  await root.send('pause'); childDocument.URL = 'https://www.youtube.com/embed/two'; await root.send('resume'); assert.equal(player.paused, true);
});
test('platform allowlist rejects deceptive hosts, schemes, credentials and nonstandard ports', () => {
  assert.ok(isYouTube('https://www.youtube.com/watch?v=x'));
  for (const platform of PLATFORMS) for (const host of platform.hosts) assert.equal(platformFor(`https://${host}/`)?.id, platform.id);
  for (const url of ['https://www.youtube.com.evil.test/', 'https://evilwww.youtube.com/', 'http://www.youtube.com/', 'javascript:alert(1)', 'not a url', 'https://user@youtube.com/', 'https://youtube.com:1234/', 'https://youtube.com./']) assert.equal(platformFor(url), null);
});
test('manifest requests only exact registered optional hosts', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.optional_host_permissions, OPTIONAL_MATCHES);
  assert.ok(!JSON.stringify(manifest).includes('<all_urls>')); assert.ok(!SITE_MATCHES.some(pattern => pattern.includes('*.')));
  assert.ok(manifest.permissions.includes('scripting')); assert.ok(manifest.content_scripts.every(script => script.all_frames));
});
function browserMock({ state = 'maximized', mediaResponse = { ok: true, mediaReady: true }, audible = false, frames } = {}) {
  const calls = [];
  const chrome = { tabs: { get: async id => ({ id, windowId: 7, audible, url: 'https://www.youtube.com/watch?v=x' }), update: async (...args) => calls.push(['tab', ...args]), sendMessage: async (...args) => { calls.push(['media', ...args]); return typeof mediaResponse === 'function' ? mediaResponse(...args) : mediaResponse; } }, windows: { get: async () => ({ state }), update: async (...args) => calls.push(['window', ...args]) } };
  if (frames) chrome.webNavigation = { getAllFrames: async () => frames };
  return { chrome, calls };
}
test('break selects the configured tab and preserves maximized state', async () => { const { chrome, calls } = browserMock(); assert.equal((await performAction(chrome, { tabId: 99 }, 'break', { resume: true })).ok, true); assert.equal(calls[1][1], 99); assert.equal(calls[2][1], 99); assert.equal(calls[2][2].action, 'resume'); assert.equal(calls[0][2].state, undefined); });
test('break restores a minimized browser', async () => { const { chrome, calls } = browserMock({ state: 'minimized' }); await performAction(chrome, { tabId: 99 }, 'break'); assert.deepEqual(calls[0][2], { state: 'normal', focused: true }); });
test('learning reports failed pause without moving away', async () => { const { chrome } = browserMock({ mediaResponse: { ok: false, message: 'Playback could not pause.' } }); chrome.tabs.query = async () => { throw new Error('Must not switch to learning.'); }; assert.equal((await performAction(chrome, { tabId: 99 }, 'learn')).message, 'Playback could not pause.'); });
test('missing or malformed media responses never produce success', async () => { for (const mediaResponse of [undefined, {}, { ok: 'true' }]) { const { chrome } = browserMock({ mediaResponse: () => mediaResponse }); const result = await performAction(chrome, { tabId: 99 }, 'status'); assert.equal(result.ok, false); assert.match(result.message, /Reload the selected tab/); } });
test('a missing content script gives actionable reload and permission guidance', async () => { const { chrome } = browserMock({ mediaResponse: () => { throw new Error('Receiving end does not exist.'); } }); const result = await performAction(chrome, { tabId: 99 }, 'status'); assert.equal(result.ok, false); assert.match(result.message, /Reload the selected tab/); });
test('all registered frames must confirm pause', async () => {
  const { chrome, calls } = browserMock({ frames: [{ frameId: 0, url: 'https://www.youtube.com/' }, { frameId: 7, url: 'https://player.vimeo.com/video/1' }], mediaResponse: (_id, _message, { frameId }) => ({ ok: frameId === 0, mediaReady: true, message: 'Embedded pause failed.' }) });
  const result = await performAction(chrome, { tabId: 99 }, 'pause'); assert.equal(result.ok, false); assert.equal(calls.filter(call => call[0] === 'media').length, 2);
});
test('remaining tab audio rejects an otherwise successful pause', async () => { const { chrome } = browserMock({ audible: true }); const result = await performAction(chrome, { tabId: 99 }, 'pause'); assert.equal(result.ok, false); assert.match(result.message, /still producing audio/); });
test('unknown visible embedded frames prevent false pause confirmation', async () => { const { chrome } = browserMock({ mediaResponse: { ok: true, mediaReady: true, frames: ['https://unknown-player.example/'] } }); const result = await performAction(chrome, { tabId: 99 }, 'pause'); assert.equal(result.ok, false); assert.match(result.message, /embedded frame/); });
test('a cross-origin embedded clip is released without automatic resume', async () => {
  const { chrome, calls } = browserMock({ frames: [{ frameId: 0, url: 'https://www.youtube.com/' }, { frameId: 7, url: 'https://player.vimeo.com/video/1' }] });
  await performAction(chrome, { tabId: 99 }, 'break', { resume: true });
  const child = calls.find(call => call[0] === 'media' && call[3].frameId === 7);
  assert.equal(child[2].action, 'resume'); assert.equal(child[2].resume, false);
});
test('cancellation forwards the original action to media adapters', async () => {
  const { chrome, calls } = browserMock();
  await performAction(chrome, { tabId: 99 }, 'cancel', { cancelledAction: 'pause' });
  assert.equal(calls.find(call => call[0] === 'media')[2].cancelledAction, 'pause');
});
test('navigation away blocks tab/window control', async () => { const chrome = { tabs: { get: async () => ({ url: 'https://example.com/' }) } }; assert.equal((await performAction(chrome, { tabId: 1 }, 'break')).ok, false); assert.equal((await performAction(chrome, {}, 'pause')).ok, false); });
test('cancellation after an awaited browser read prevents focus and resume', async () => {
  const controller = new AbortController(); const { chrome, calls } = browserMock(); chrome.windows.get = async () => { controller.abort(); return { state: 'normal' }; };
  assert.equal((await performAction(chrome, { tabId: 1 }, 'break', { signal: controller.signal })).ok, false); assert.equal(calls.length, 0);
});
test('a nonresponsive player is bounded by a timeout', async () => { await assert.rejects(withTimeout(new Promise(() => {}), 10), /did not respond in time/); });
