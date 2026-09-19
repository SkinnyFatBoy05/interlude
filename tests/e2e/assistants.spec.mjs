import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('Claude chat, Claude Code web and Codex web hand off with no companion connection', async () => {
  test.setTimeout(90000);
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'interlude-web-e2e-'));
  const extension = path.join(temporary, 'extension');
  await cp(fileURLToPath(new URL('../../extension', import.meta.url)), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  // Test profile pre-grants these origins. No real browser permissions change.
  manifest.host_permissions.push('https://claude.ai/*', 'https://chatgpt.com/*');
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], viewport: { width: 1280, height: 900 } });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Media fixture</title><main><video id="video" loop controls style="width:640px;height:360px"></video><button id="play">Play</button></main><script>
    const rate=8000, data=new ArrayBuffer(44+rate*4), view=new DataView(data); function text(i,s){for(let j=0;j<s.length;j++)view.setUint8(i+j,s.charCodeAt(j));} text(0,'RIFF');view.setUint32(4,data.byteLength-8,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,rate*4,true);video.src=URL.createObjectURL(new Blob([data],{type:'audio/wav'}));document.querySelector('#play').onclick=()=>video.play();</script>` }));
    const fixture = `<!doctype html><title>Assistant fixture</title><main><h1>Local assistant fixture</h1><textarea aria-label="Prompt"></textarea><div id="state"></div><button id="start">Start fixture work</button><button id="finish">Finish fixture work</button><button id="ask">Request fixture approval</button></main><script>
      let copies=0;const state=document.querySelector('#state');document.querySelector('#start').onclick=()=>state.innerHTML='<button aria-label="Stop response">Stop response</button>';
      document.querySelector('#finish').onclick=()=>{copies++;state.innerHTML='<button aria-label="Copy response">Copy response</button>'.repeat(copies)};
      document.querySelector('#ask').onclick=()=>state.innerHTML='<button>Allow once</button><button>Deny</button>';
      </script>`;
    await context.route('https://claude.ai/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
    await context.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
    const media = await context.newPage(); await media.goto('https://www.youtube.com/watch?v=fixture');
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'disconnect' }));
    await popup.getByRole('button', { name: 'Use this tab', exact: true }).click();
    for (const url of ['https://claude.ai/chat/fixture', 'https://claude.ai/code/fixture', 'https://chatgpt.com/codex/cloud/tasks/fixture']) {
      const assistant = await context.newPage(); await assistant.goto(url);
      const tabId = await worker.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(t => t.url === url).id), url);
      await expect(popup.locator(`#ai-tabs option[value="${tabId}"]`)).toHaveCount(1);
      await popup.locator('#ai-tabs').selectOption(String(tabId));
      await popup.getByRole('button', { name: 'Watch this AI tab' }).click();
      await expect(popup.locator('#web-tasks')).toContainText('idle');
      await popup.getByRole('button', { name: 'Turn on website monitoring', exact: true }).click();
      await media.locator('#play').click();
      await assistant.locator('#start').click();
      await expect(popup.locator('#web-status')).toContainText('is working');
      await assistant.locator('#ask').click();
      await expect.poll(() => media.locator('#video').evaluate(v => v.paused)).toBe(true);
      await expect(popup.locator('#web-status')).toContainText('attention is needed');
      await assistant.locator('#start').click();
      await expect.poll(() => media.locator('#video').evaluate(v => v.paused)).toBe(false);
      await assistant.locator('#finish').click();
      await expect(popup.locator('#web-status')).toContainText('response ready');
      await expect.poll(() => media.locator('#video').evaluate(v => v.paused)).toBe(true);
      await expect.poll(() => worker.evaluate(() => chrome.tabs.query({ active: true }).then(tabs => tabs.map(t => t.url)))).toContain(url);
      await popup.getByRole('button', { name: 'Turn off website monitoring', exact: true }).click();
      await assistant.close();
      await expect(popup.locator('#web-tasks li')).toHaveCount(0);
    }
    await popup.screenshot({ path: path.join(os.tmpdir(), 'interlude-0.5-popup.png'), fullPage: true });
    const learning = await context.newPage(); await learning.goto(`chrome-extension://${id}/learning.html`);
    await expect(learning.getByRole('heading', { name: 'Understand what you’re building.' })).toBeVisible();
    await learning.getByText('Where should access control live?', { exact: true }).click();
    await expect(learning.getByText('On the server for every protected operation.', { exact: false })).toBeVisible();
  } finally { await context.close(); await rm(temporary, { recursive: true, force: true }); }
});
