import { test, expect, chromium } from '@playwright/test';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT } from '../../src/config.mjs';

test('record the real beta extension across two projects', async () => {
  test.skip(process.env.INTERLUDE_RECORD_DEMO !== '1', 'Opt-in recording; generated media and FFmpeg are required.');
  test.setTimeout(150000);
  const output = path.join(ROOT, 'artifacts', 'demo');
  const fixtureRoot = path.join(ROOT, '.tmp', 'recording');
  const stateDir = path.join(fixtureRoot, 'state');
  const projects = { studio: path.join(fixtureRoot, 'studio-ui'), api: path.join(fixtureRoot, 'api-service') };
  await mkdir(output, { recursive: true }); await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(stateDir, 'connection.json'), JSON.stringify({ token: 'b'.repeat(64) }));
  for (const [id, folder] of Object.entries(projects)) {
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'package.json'), JSON.stringify({ dependencies: id === 'studio' ? { react: '19' } : { express: '5' } }));
  }
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true, viewport: { width: 960, height: 1080 },
    recordVideo: { dir: path.join(output, 'raw'), size: { width: 960, height: 1080 } },
    args: [`--disable-extensions-except=${path.join(ROOT, 'extension')}`, `--load-extension=${path.join(ROOT, 'extension')}`],
  });
  let dashboardVideo, mediaVideo;
  const evidence = [];
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const dashboard = await context.newPage(); dashboardVideo = dashboard.video();
    const media = await context.newPage(); mediaVideo = media.video();
    await context.route('https://www.youtube.com/**', async route => {
      if (new URL(route.request().url()).pathname === '/interlude-fixture.webm') {
        await route.fulfill({ contentType: 'video/webm', body: await readFile(path.join(output, 'sample.webm')) }); return;
      }
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"><title>Interlude test player</title>
      <style>body{margin:0;background:#102c24;color:#f8f8ef;font:22px system-ui;padding:44px}small{color:#d6ec9d}h1{font-size:44px;margin:16px 0 24px}video{width:100%;border-radius:16px;background:#091d17}button{padding:16px 24px;border:0;border-radius:12px;background:#dbf3a2;font-size:22px;color:#163b30;margin:24px 0}#state{font-size:32px;font-weight:700}#clock{font:30px monospace}aside{border-top:1px solid #ffffff30;margin-top:32px;padding-top:24px;line-height:1.6}#chapter{min-height:80px;color:#d6ec9d}</style></head>
      <body><small>REAL HTML MEDIA · CONTROLLED BY THE EXTENSION</small><h1>Your break, under control.</h1>
      <video id="main" src="/interlude-fixture.webm" loop controls></video><button id="play">Start sample video</button>
      <div id="state">PAUSED</div><div id="clock">00.00 seconds</div><aside><div id="chapter">Pairing the real extension…</div><p>Functional beta recording. Codex hooks are simulated; desktop activation is mocked. This is a generated test clip, not a live YouTube or paid-streaming session.</p></aside>
      <script>const v=document.getElementById('main');document.getElementById('play').onclick=()=>v.play();setInterval(()=>{document.getElementById('state').textContent=v.paused?'PAUSED':'PLAYING';document.getElementById('clock').textContent=v.currentTime.toFixed(2)+' seconds';},100);</script></body></html>` });
    });
    await dashboard.goto('http://127.0.0.1:4318/');
    await expect(dashboard.locator('#connection-dot')).toHaveClass('online');
    await media.goto('https://www.youtube.com/watch?v=interlude-generated-demo');
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByLabel('Connection code', { exact: true }).fill('b'.repeat(64));
    await popup.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(popup.locator('#status')).toContainText(/Connected/);
    const option = popup.locator('#tabs option').filter({ hasText: 'Interlude test player' });
    await popup.getByLabel('Your media tab', { exact: true }).selectOption(await option.getAttribute('value'));
    await popup.getByRole('button', { name: 'Use this tab', exact: true }).click();
    await expect(dashboard.locator('#media-status')).toHaveText('Ready to play'); await popup.close();
    const hook = (id, name, extra = {}) => {
      const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'hook.mjs')], {
        input: JSON.stringify({ hook_event_name: name, session_id: `record-${id}`, turn_id: 'record-turn', cwd: projects[id], tool_name: 'shell', tool_input: {}, ...extra }),
        env: { ...process.env, INTERLUDE_STATE_DIR: stateDir }, encoding: 'utf8', timeout: 4000, windowsHide: true,
      });
      expect(result.status).toBe(0); expect(result.stdout).toBe('{}'); expect(result.stderr).toBe('');
    };
    async function chapter(text, seconds = 4) {
      await media.locator('#chapter').evaluate((element, value) => { element.textContent = value; }, text);
      evidence.push({ text, at: new Date().toISOString(), paused: await media.locator('#main').evaluate(v => v.paused), dashboard: await dashboard.locator('#status-title').innerText() });
      // Deliberate presentation pacing after assertions, not synchronization.
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }
    await dashboard.getByRole('button', { name: 'Fun mode', exact: true }).click();
    await dashboard.getByRole('button', { name: 'Turn on Interlude', exact: true }).click();
    await expect(dashboard.getByRole('button', { name: 'Turn off Interlude', exact: true })).toBeVisible();
    await media.getByRole('button', { name: 'Start sample video' }).click();
    hook('studio', 'UserPromptSubmit'); hook('api', 'UserPromptSubmit');
    await expect(dashboard.locator('#chat-status')).toContainText('2 working');
    await expect.poll(() => media.locator('#main').evaluate(v => v.paused)).toBe(false);
    await chapter('01 · Two Codex projects are working. The selected video keeps playing.', 6);
    hook('api', 'Stop');
    await expect(dashboard.locator('#notice')).toHaveText('Codex finished responding. Review its result.');
    await expect.poll(() => media.locator('#main').evaluate(v => v.paused)).toBe(true);
    await expect(dashboard.locator('#chat-status')).toContainText('1 working');
    await chapter('02 · api-service finished. Playback pauses while studio-ui keeps working.', 6);
    await dashboard.getByRole('button', { name: 'Acknowledge this alert' }).click();
    await expect.poll(() => media.locator('#main').evaluate(v => v.paused)).toBe(false);
    await chapter('03 · Alert acknowledged. The other chat is still working, so playback resumes.', 5);
    await dashboard.getByRole('button', { name: 'Locked-in mode', exact: true }).click();
    await expect(dashboard.locator('#lesson-title')).toHaveText('How the interface reacts');
    await expect.poll(() => media.locator('#main').evaluate(v => v.paused)).toBe(true);
    await dashboard.getByRole('button', { name: 'Reveal answer', exact: true }).click();
    await expect(dashboard.locator('#lesson-answer')).toBeVisible();
    await chapter('04 · Locked-in mode pauses media and teaches from studio-ui’s actual React dependency.', 6);
    hook('studio', 'PermissionRequest');
    await expect(dashboard.getByRole('heading', { name: 'A decision is waiting.' })).toBeVisible();
    await expect(dashboard.locator('#notice')).toContainText('Codex may need permission.');
    await chapter('05 · A permission request also pauses the break. Interlude never approves it.', 5);
    hook('studio', 'PostToolUse');
    await dashboard.getByRole('button', { name: 'Fun mode', exact: true }).click();
    await expect.poll(() => media.locator('#main').evaluate(v => v.paused)).toBe(false);
    await chapter('06 · Codex reports that work continued. Fun mode resumes the same owned player.', 4);
    hook('studio', 'Stop');
    await expect(dashboard.locator('#notice')).toHaveText('Codex finished responding. Review its result.');
    await expect.poll(() => media.locator('#main').evaluate(v => v.paused)).toBe(true);
    await chapter('07 · Both tasks are finished. Playback stays paused for your review.', 5);
    await dashboard.getByRole('button', { name: 'Acknowledge this alert' }).click();
    await dashboard.getByRole('button', { name: 'Turn off Interlude', exact: true }).click();
    await expect(media.getByRole('button', { name: 'Release playback', exact: true })).toHaveCount(0);
    await writeFile(path.join(output, 'evidence.json'), JSON.stringify({ disclosure: 'Real app, extension and hook emitter. Synthetic Codex events and generated media; native focus mocked.', chapters: evidence }, null, 2));
  } finally { await context.close(); }
  // A persistent context closes its browser transport. Copy completed local
  // recordings directly instead of invoking saveAs through that closed transport.
  await copyFile(await dashboardVideo.path(), path.join(output, 'dashboard.webm'));
  await copyFile(await mediaVideo.path(), path.join(output, 'media.webm'));
});
