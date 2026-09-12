import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardURL, trustedDesktopSender, validateDesktopAction } from '../desktop/policy.mjs';

test('desktop navigation permits only the local dashboard', () => {
  const origin = 'http://127.0.0.1:4318';
  assert.equal(dashboardURL(origin + '/', origin), true);
  for (const url of ['https://example.com', origin + '.evil.test', origin + '/api/bootstrap', 'file:///tmp/a', 'http://localhost:4318/', 'http://user@127.0.0.1:4318/']) assert.equal(dashboardURL(url, origin), false);
});
test('privileged desktop actions reject other windows and subframes', () => {
  const mainFrame = { url: 'http://127.0.0.1:4318/' };
  const webContents = { mainFrame };
  const window = { webContents, isDestroyed: () => false };
  const event = { sender: webContents, senderFrame: mainFrame };
  assert.equal(trustedDesktopSender(event, window, 'http://127.0.0.1:4318'), true);
  assert.equal(trustedDesktopSender({ ...event, senderFrame: { ...mainFrame } }, window, 'http://127.0.0.1:4318'), false);
  assert.equal(trustedDesktopSender({ ...event, sender: {} }, window, 'http://127.0.0.1:4318'), false);
  for (const [action, value] of [['exec', 'rm'], ['install-hooks', '/tmp/evil'], ['login', 'yes'], ['status', {}]]) assert.throws(() => validateDesktopAction(action, value));
  validateDesktopAction('login', true); validateDesktopAction('install-hooks');
});
