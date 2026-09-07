import test from 'node:test';
import assert from 'node:assert/strict';
import { supportSummary } from '../src/support.mjs';
test('support export includes actionable status but excludes user content and credentials', () => {
  const result = supportSummary({ version: '0.3.0', platform: 'win32', status: 'running', token: 'SECRET', scope: 'PRIVATE',
    session: 'PRIVATE', tasks: [{ id: 'PRIVATE' }], notice: 'PRIVATE', browser: { title: 'PRIVATE', message: 'PRIVATE', platform: 'youtube', connected: true },
    diagnostics: { code: 'not_foreground', message: 'PRIVATE' } });
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
  assert.equal(result.browser.connected, true); assert.equal(result.native.code, 'not_foreground');
});
