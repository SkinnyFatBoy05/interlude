import { test, expect, chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { sanitizeHook } from '../../src/events.mjs';
import { ROOT } from '../../src/config.mjs';

function silentWave() {
  const dataSize = 8000 * 2 * 4;
  const bytes = Buffer.alloc(44 + dataSize);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + dataSize, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(dataSize, 40);
  return 'data:audio/wav;base64,' + bytes.toString('base64');
}

test('installed extension pairs, pauses media, blocks feed autoplay, resumes ownership and releases on disarm', async ({ request }) => {
  const extension = fileURLToPath(new URL('../../extension', import.meta.url));
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1280, height: 900 },
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const source = silentWave();
    await context.route('https://www.youtube.com/**', route => route.fulfill({
      contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"><title>Interlude media fixture</title></head><body>
      <h1>Local media fixture — no external site content</h1>
      <video id="hidden" src="${source}" preload="auto" style="display:none"></video>
      <video id="main" src="${source}" loop controls style="width:640px;height:360px"></video>
      <button id="play">Play fixture</button><button id="preview-play">Autoplay preview</button>
      <video id="preview" src="${source}" muted loop style="width:160px;height:90px"></video>
      <script>document.getElementById('play').onclick=()=>document.getElementById('main').play().catch(()=>{});
      document.getElementById('preview-play').onclick=()=>document.getElementById('preview').play().catch(()=>{});</script></body></html>`,
    }));
    const media = await context.newPage();
    await media.goto('https://www.youtube.com/watch?v=interlude-local-fixture');

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByLabel('Connection code', { exact: true }).fill('b'.repeat(64));
    await popup.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(popup.locator('#status')).toContainText(/Connected/i);
    await expect(popup.locator('#tabs option')).toContainText(['Interlude media fixture']);
    const mediaOption = popup.locator('#tabs option').filter({ hasText: 'Interlude media fixture' });
    await popup.getByLabel('Your media tab', { exact: true }).selectOption(await mediaOption.getAttribute('value'));
    await popup.getByRole('button', { name: 'Use this tab', exact: true }).click();

    const dashboard = await context.newPage();
    await dashboard.goto('http://127.0.0.1:4318/');
    await expect(dashboard.locator('#connection-dot')).toHaveClass('online');
    await expect(dashboard.locator('#media-status')).toHaveText('Ready to play');
    await dashboard.getByRole('button', { name: 'Fun mode', exact: true }).click();
    await dashboard.getByRole('button', { name: 'Turn on Interlude', exact: true }).click();
    await expect(dashboard.getByRole('button', { name: 'Turn off Interlude', exact: true })).toBeVisible();
    await media.getByRole('button', { name: 'Play fixture', exact: true }).click();
    await expect.poll(() => media.locator('#main').evaluate(video => video.paused)).toBe(false);
    async function event(name, turn = 'browser-1') {
      const body = sanitizeHook({ hook_event_name: name, session_id: 'browser-fixture', turn_id: turn, cwd: ROOT, tool_name: 'shell', tool_input: {} });
      const result = await request.post('http://127.0.0.1:4318/api/hook', { headers: { Authorization: `Bearer ${'b'.repeat(64)}` }, data: body });
      expect(result.ok()).toBe(true);
    }
    await event('UserPromptSubmit');
    await expect(dashboard.getByRole('heading', { name: 'This moment is yours.' })).toBeVisible();
    await event('Stop');
    await expect(dashboard.getByRole('heading', { name: 'Your response is ready.' })).toBeVisible();
    await expect.poll(() => media.locator('#main').evaluate(video => video.paused)).toBe(true);
    // Wait for the actual pause acknowledgment. A new prompt before this point
    // can cancel the in-flight pause; rapid cancellation is covered separately.
    await expect(dashboard.locator('#notice')).toHaveText('Codex finished responding. Review its result.');
    await media.getByRole('button', { name: 'Autoplay preview', exact: true }).click();
    await expect.poll(() => media.locator('#preview').evaluate(video => video.paused)).toBe(true);
    await event('UserPromptSubmit', 'browser-2');
    await expect.poll(() => media.locator('#main').evaluate(video => video.paused)).toBe(false);
    expect(await media.locator('#hidden').evaluate(video => video.paused)).toBe(true);
    expect(await media.locator('#preview').evaluate(video => video.paused)).toBe(true);
    await event('PermissionRequest', 'browser-2');
    await expect(dashboard.getByRole('heading', { name: 'A decision is waiting.' })).toBeVisible();
    await expect.poll(() => media.locator('#main').evaluate(video => video.paused)).toBe(true);
    await dashboard.getByRole('button', { name: 'Turn off Interlude', exact: true }).click();
    await expect(media.getByRole('button', { name: 'Release playback', exact: true })).toHaveCount(0);
    expect(await media.locator('#main').evaluate(video => video.paused)).toBe(true);
    await media.getByRole('button', { name: 'Play fixture', exact: true }).click();
    await expect.poll(() => media.locator('#main').evaluate(video => video.paused)).toBe(false);
    await event('SessionEnd', 'browser-2');
  } finally { await context.close(); }
});
