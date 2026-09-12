import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { ROOT, LOCAL, PORT, loadConfig, stateDirectory } from './config.mjs';
import { Session } from './session.mjs';
import { Sessions } from './sessions.mjs';
import { validEvent } from './events.mjs';
import { projectLessons, activityLesson } from './lessons.mjs';
import * as nativePlatform from './platform.mjs';
import { Preferences } from './preferences.mjs';
import { supportSummary } from './support.mjs';

const WEB = path.join(ROOT, 'web');
const files = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
export const INTERLUDE_EXTENSION_ID = 'ppfnbagemmijocfmjepgkfljddnkcghn';
export const INTERLUDE_EXTENSION_ORIGIN = 'chrome-extension://' + INTERLUDE_EXTENSION_ID;
const extensionOrigin = origin => origin === INTERLUDE_EXTENSION_ORIGIN;
export function sameToken(value, token) {
  return typeof value === 'string' && typeof token === 'string' && Buffer.byteLength(value) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(value), Buffer.from(token));
}

async function bodyJson(req, limit = 16000) {
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) throw Object.assign(new Error('Request is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}

export async function createCompanion({ port = PORT, token, cwd = ROOT, nativeFocus = nativePlatform.focusCodex, nativeDiagnostics = nativePlatform.platformDiagnostics, showLearning, heartbeatMs = 15000, commandTimeoutMs = 2200, preferencesDirectory = token === undefined ? stateDirectory(cwd) : null } = {}) {
  const config = token === undefined ? await loadConfig(stateDirectory(cwd), { legacyDirectory: path.join(cwd, '.local') }) : { token };
  const secret = config.token;
  if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) throw new Error('Invalid local pairing token.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid local port.');
  const session = new Sessions({ cwd });
  const preferences = new Preferences(preferencesDirectory);
  const saved = await preferences.load();
  session.update(saved.settings);
  if (saved.warning) session.note(saved.warning);
  if (config.migrationWarning) session.note(config.migrationWarning);
  const sockets = new Set();
  const awaiting = new Map();
  let extension = null;
  const emptyBrowser = message => ({ connected: false, selected: false, mediaReady: false, platform: '', title: '', message });
  let browser = emptyBrowser('');
  let diagnostics = null;
  let diagnosticsTask = null;
  let diagnosticsController = null;
  let lessons = await projectLessons(cwd);
  let lessonScope = cwd;
  let lessonRequest = 0;
  function refreshLessons(force = false) {
    const target = session.activeCwd;
    if (!force && target === lessonScope) return;
    lessonScope = target;
    lessons = [];
    const request = ++lessonRequest;
    projectLessons(target).then(result => { if (!closing && request === lessonRequest) { lessons = result; publish(); } });
  }
  const { version } = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  let activeEffect = Promise.resolve();
  let actionController = new AbortController();
  let observedEpoch = session.epoch;
  let closing = false;
  let demo = null;
  let demoTimer = null;
  let latestRevision = -1;
  let actualPort = port;
  const origin = () => `http://127.0.0.1:${actualPort}`;
  const send = (ws, value) => { if (ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify(value)); } catch { ws.terminate(); } } };
  const snapshot = () => ({ ...session.state, browser, lessons: lessons.length ? lessons : [activityLesson], scope: cwd, platform: process.platform, version, desktop: typeof showLearning === 'function', diagnostics, demo: demo?.state ?? null });
  const publish = () => { refreshLessons(); for (const ws of sockets) if (ws.role === 'dashboard') send(ws, { type: 'state', state: snapshot() }); };

  function syncActions() {
    if (observedEpoch !== session.epoch) {
      observedEpoch = session.epoch;
      actionController.abort();
      actionController = new AbortController();
    }
  }
  function command(action, options = {}, signal = actionController.signal, timeoutMs = commandTimeoutMs) {
    if (signal.aborted) return Promise.resolve({ ok: false, cancelled: true });
    if (!extension || extension.readyState !== WebSocket.OPEN) return Promise.resolve({ ok: false, message: 'Connect the browser extension to control your selected media tab.' });
    const owner = extension;
    const id = randomUUID();
    return new Promise(resolve => {
      const finish = result => { clearTimeout(timeout); signal.removeEventListener('abort', cancel); awaiting.delete(id); resolve(result); };
      const cancel = () => { send(owner, { type: 'cancel', id }); finish({ ok: false, cancelled: true }); };
      const timeout = setTimeout(() => { send(owner, { type: 'cancel', id }); finish({ ok: false, message: 'The browser did not confirm the action.' }); }, timeoutMs);
      awaiting.set(id, { resolve: finish, owner });
      signal.addEventListener('abort', cancel, { once: true });
      send(owner, { type: 'command', id, action, ...options });
    });
  }

  async function effect(item, epoch, signal) {
    const current = () => !closing && !signal.aborted && epoch === session.epoch;
    if (!current()) return;
    if (item.type !== 'pause' && (!session.state.enabled || session.state.manualHold || (item.turn && item.turn !== session.state.turn))) return;
    if (item.type === 'pause') {
      if (extension) {
        await command('pause', {}, signal);
        if (current() && !session.state.enabled) await command('release', {}, signal);
      }
      return;
    }
    if (item.type === 'handoff') {
      if (session.state.status !== 'running') return;
      let result;
      if (item.mode === 'learn' && showLearning) {
        result = browser.selected ? await command('pause', {}, signal) : { ok: true };
        if (result.ok && current()) result = await showLearning({ signal });
      } else result = await command(item.mode === 'fun' ? 'break' : 'learn', { resume: session.state.resume }, signal);
      if (!current()) return;
      if (!result.ok) session.note(result.message || 'The browser could not switch tabs.');
    } else if (item.type === 'attention') {
      const pause = await command('pause', { reason: item.reason }, signal);
      // A new prompt or disarm while the browser acknowledges must cancel this return.
      if (!current() || !session.state.enabled || item.turn !== session.state.turn || session.state.status === 'running') return;
      const note = item.reason === 'permission' ? 'Codex may need permission.' : item.reason === 'input' ? 'Codex has a question for you.' : 'Codex finished responding. Review its result.';
      session.note(pause.ok ? note : `${note} ${pause.message || 'Video pause was not confirmed.'}`);
      if (session.state.autoReturn) {
        const result = await boundedNative(nativeFocus, { maximize: session.state.maximize }, signal);
        if (!current()) return;
        if (!result.focused) session.note(`${session.state.notice} ${result.message || 'Open Codex manually.'}`);
        else if (session.state.minimize && pause.ok) await command('minimize', {}, signal);
      }
    }
    if (current()) publish();
  }
  const dispatch = items => {
    syncActions();
    const epoch = session.epoch, signal = actionController.signal;
    for (const item of items) activeEffect = activeEffect.then(() => effect(item, epoch, signal)).catch(() => {
      if (!closing && !signal.aborted && epoch === session.epoch) { session.note('An action could not finish. Return to Codex manually.'); publish(); }
    });
  };

  async function boundedNative(operation, options, parentSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    parentSignal.addEventListener('abort', abort, { once: true });
    if (parentSignal.aborted) controller.abort();
    let timeout;
    try {
      return await Promise.race([
        Promise.resolve().then(() => { if (controller.signal.aborted) return { focused: false, code: 'cancelled' }; return operation({ ...options, signal: controller.signal }); }),
        new Promise(resolve => {
          const cancelled = () => resolve({ focused: false, code: 'cancelled', message: 'Desktop action was cancelled.' });
          controller.signal.addEventListener('abort', cancelled, { once: true });
          if (controller.signal.aborted) cancelled();
          timeout = setTimeout(() => { resolve({ focused: false, code: 'helper_timeout', message: 'The desktop helper did not respond. Open Codex manually.' }); controller.abort(); }, 8500);
        }),
      ]);
    } finally { clearTimeout(timeout); parentSignal.removeEventListener('abort', abort); }
  }

  const server = http.createServer(async (req, res) => {
    const headers = {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'Referrer-Policy': 'no-referrer',
    };
    const reply = (status, data, type = 'application/json') => { res.writeHead(status, { ...headers, 'Content-Type': `${type}; charset=utf-8` }); res.end(type === 'application/json' ? JSON.stringify(data) : data); };
    try {
      if (req.headers.host !== `127.0.0.1:${actualPort}`) return reply(403, { error: 'Invalid host.' });
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) return reply(400, { error: 'Invalid request target.' });
      const pathname = new URL(req.url, origin()).pathname;
      if (req.method === 'GET' && files.has(pathname)) {
        const [name, type] = files.get(pathname);
        return reply(200, await readFile(path.join(WEB, name), 'utf8'), type);
      }
      if (req.method === 'GET' && pathname === '/support.js') return reply(200, await readFile(path.join(ROOT, 'src', 'support.mjs'), 'utf8'), 'text/javascript');
      const requestOrigin = req.headers.origin;
      if (requestOrigin && requestOrigin !== origin()) return reply(403, { error: 'Invalid origin.' });
      if (req.method === 'GET' && pathname === '/api/bootstrap') {
        if (req.headers['x-interlude-client'] !== 'dashboard' || (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) return reply(403, { error: 'Open the local companion.' });
        return reply(200, { token: secret, state: snapshot() });
      }
      if (!sameToken(req.headers.authorization?.replace(/^Bearer /, ''), secret)) return reply(401, { error: 'Not paired.' });
      if (req.method === 'POST' && pathname === '/api/hook') {
        if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json' || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) return reply(415, { error: 'Send uncompressed JSON.' });
        const event = await bodyJson(req);
        if (!validEvent(event)) return reply(400, { error: 'Invalid event.' });
        dispatch(session.receive(event));
        if (event.event === 'PostToolUse' && event.files.includes('package.json') && event.cwd === session.activeCwd) refreshLessons(true);
        publish();
        return reply(200, { ok: true });
      }
      return reply(404, { error: 'Not found.' });
    } catch (error) { reply(error.status ?? 500, { error: error.status ? error.message : 'The local companion could not finish the request.' }); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384 });
  server.on('upgrade', (req, socket, head) => {
    if (closing || sockets.size >= 64 || req.url !== '/bridge' || req.headers.host !== `127.0.0.1:${actualPort}` || !(req.headers.origin === origin() || extensionOrigin(req.headers.origin))) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws, req) => {
    const authTimer = setTimeout(() => ws.close(1008, 'Pairing required'), 3000);
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    sockets.add(ws);
    ws.on('error', () => {});
    ws.on('message', async raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { ws.close(1008, 'Invalid message'); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) { ws.close(1008, 'Invalid message'); return; }
      if (!ws.role) {
        if (message.type === 'pair' && message.role === 'extension' && extensionOrigin(req.headers.origin)) {
          send(ws, { type: 'paired', token: secret });
          return;
        }
        const role = req.headers.origin === origin() ? 'dashboard' : 'extension';
        if (message.type !== 'hello' || message.role !== role || !sameToken(message.token, secret)) { ws.close(1008, 'Pairing rejected'); return; }
        clearTimeout(authTimer);
        if (role === 'extension') {
          // One owner at a time. Replacing a healthy browser causes competing
          // service workers to steal the bridge back on every reconnect.
          if (extension?.readyState === WebSocket.OPEN && extension !== ws) { ws.close(1013, 'Another browser is connected'); return; }
          extension = ws;
          browser = { ...emptyBrowser('Choose a supported media tab in the extension.'), connected: true };
        }
        ws.role = role;
        send(ws, { type: 'ready' }); publish(); return;
      }
      if (message.type === 'ping') { send(ws, { type: 'pong' }); return; }
      if (ws.role === 'extension') {
        if (extension !== ws) return;
        if (message.type === 'browser') {
          const rejoined = (!browser.selected && message.selected === true) || (!browser.mediaReady && message.mediaReady === true);
          browser = { connected: true, selected: message.selected === true, mediaReady: message.selected === true && message.mediaReady === true, platform: typeof message.platform === 'string' ? message.platform.slice(0, 40) : '', title: typeof message.title === 'string' ? message.title.slice(0, 120) : '', message: typeof message.message === 'string' ? message.message.slice(0, 180) : '' };
          if (rejoined && awaiting.size === 0) { session.browserRejoined(); syncActions(); }
          publish();
        } else if (message.type === 'ack' && awaiting.has(message.id)) {
          const pending = awaiting.get(message.id);
          if (pending.owner !== ws) return;
          pending.resolve({ ok: message.ok === true, message: typeof message.message === 'string' ? message.message.slice(0, 200) : '' });
        }
        return;
      }
      try {
        if (message.type === 'settings') {
          dispatch(session.update(message.patch));
          preferences.save(session.state).catch(() => { if (!closing) { session.note('Preferences could not be saved. These settings apply until you quit.'); publish(); } });
          if (session.state.enabled && demo) { demo = null; clearInterval(demoTimer); }
          publish();
        }
        else if (message.type === 'acknowledge') {
          dispatch(session.acknowledge()); publish();
        }
        else if (message.type === 'return') {
          session.manualReturn(); syncActions();
          const epoch = session.epoch, signal = actionController.signal;
          const current = () => !closing && !signal.aborted && epoch === session.epoch;
          publish();
          const result = await command('pause', {}, signal);
          if (!current()) return;
          const note = result.ok ? 'Media paused. Returning to Codex.' : result.message || 'Media pause was not confirmed.';
          session.note(note);
          const focused = await boundedNative(nativeFocus, { maximize: session.state.maximize }, signal);
          if (!current()) return;
          if (!focused.focused) session.note(`${note} ${focused.message || 'Open Codex manually.'}`);
          publish();
        }
        else if (message.type === 'diagnostics') {
          if (!diagnosticsTask) {
            diagnosticsController = new AbortController();
            diagnosticsTask = boundedNative(nativeDiagnostics, {}, diagnosticsController.signal)
              .catch(() => ({ platform: process.platform, supported: false, helperReady: false, code: 'helper_failed', message: 'Desktop diagnostics could not finish.' }))
              .then(result => { if (!closing) { diagnostics = { ...result, checkedAt: Date.now() }; publish(); } })
              .finally(() => { diagnosticsTask = null; diagnosticsController = null; });
          }
          await diagnosticsTask;
        }
        else if (message.type === 'demo') {
          if (!['start', 'close', 'permission', 'input', 'complete', 'resume'].includes(message.action)) throw new Error('Unknown demo action.');
          if (message.action !== 'close' && session.state.enabled) throw new Error('Turn off live monitoring before trying the demo.');
          clearInterval(demoTimer);
          if (message.action === 'close') { demo = null; publish(); return; }
          if (message.action === 'start') {
            let clock = Date.now();
            demo = new Session({ cwd, now: () => clock });
            demo.update({ enabled: true, mode: session.state.mode });
            demo.receive({ id: randomUUID(), at: clock, cwd, session: 'demo', turn: 'demo-turn', event: 'UserPromptSubmit' });
            demoTimer = setInterval(() => { if (!demo) return; clock = Date.now(); demo.tick(); publish(); }, 250);
          } else if (demo && ['permission', 'input', 'complete', 'resume'].includes(message.action)) {
            // Keep the same real reducer. No demo effects are ever dispatched to the OS or extension.
            const name = { permission: 'PermissionRequest', input: 'PreToolUse', complete: 'Stop', resume: 'PostToolUse' }[message.action];
            demo.now = Date.now;
            demo.receive({ id: randomUUID(), at: Date.now(), cwd, session: 'demo', turn: 'demo-turn', event: name, tool: message.action === 'input' ? 'question' : 'command', toolKey: 'demo-tool' });
            demoTimer = setInterval(() => { demo?.tick(); publish(); }, 250);
          }
          publish();
        } else send(ws, { type: 'error', message: 'Unknown action.' });
      } catch (error) { send(ws, { type: 'error', message: error.message }); }
    });
    ws.on('close', () => {
      clearTimeout(authTimer); sockets.delete(ws);
      if (extension === ws) {
        extension = null;
        browser = emptyBrowser('Browser disconnected. Reconnect to restore media controls.');
        for (const pending of awaiting.values()) if (pending.owner === ws) pending.resolve({ ok: false, message: 'Browser disconnected.' });
        publish();
      }
    });
  });

  const interval = setInterval(() => {
    syncActions();
    dispatch(session.tick());
    if (session.state.revision !== latestRevision) { latestRevision = session.state.revision; publish(); }
  }, 150);
  const heartbeat = setInterval(() => {
    for (const ws of sockets) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }
  }, heartbeatMs);
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); }
  catch (error) { clearInterval(interval); clearInterval(heartbeat); wss.close(); throw error; }
  actualPort = server.address().port;
  return {
    origin: origin(), token: secret, session,
    support: () => supportSummary(snapshot()),
    disable: () => { dispatch(session.update({ enabled: false })); publish(); },
    close: async () => {
      if (closing) return;
      closing = true; session.update({ enabled: false }); actionController.abort(); diagnosticsController?.abort();
      clearInterval(interval); clearInterval(heartbeat); clearInterval(demoTimer);
      if (extension?.readyState === WebSocket.OPEN) await command('release', {}, new AbortController().signal, 250);
      for (const ws of sockets) ws.terminate();
      for (const item of awaiting.values()) item.resolve({ ok: false, cancelled: true });
      wss.close(); await new Promise(resolve => server.close(resolve));
      await preferences.flush();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await mkdir(LOCAL, { recursive: true });
    const app = await createCompanion();
    console.log(`Interlude beta is ready at ${app.origin}\nAll local Codex projects can report events. Open the page to enable handoffs.`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
  } catch (error) { console.error(error.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Check whether Interlude is already running.` : error.message); process.exitCode = 1; }
}
