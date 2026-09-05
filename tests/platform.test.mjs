import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir, chmod, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPlatformController } from '../src/platform.mjs';
import { buildNativeHelper, validNativeArtifact, nativeBuildOptions } from '../scripts/native-build.mjs';

const native = (overrides = {}) => ({ focused: false, focusedWindowMaximized: false, code: 'not_foreground', message: 'Codex is not in front.', targetFound: true, targetCount: 1, attentionRequested: false, maximizeStatus: 'not_requested', ...overrides });
function fixture({ platform = 'win32', response = native(), error = null, environment = {}, prepare } = {}) {
  const calls = [];
  const compile = async ({ signal }) => { calls.push({ prepare: true, signal }); return prepare ? prepare(signal) : '/native/helper'; };
  const controller = createPlatformController({ platform, environment, prepareWindows: compile, prepareMacOS: compile,
    execute: (file, args, options, callback) => { calls.push({ file, args, options }); callback(error, typeof response === 'string' ? response : JSON.stringify(response)); } });
  return { ...controller, calls };
}

test('platform diagnostics use read-only native status on Windows and macOS', async () => {
  for (const platform of ['win32', 'darwin']) {
    const controller = fixture({ platform });
    const status = await controller.platformDiagnostics();
    assert.equal(status.helperReady, true);
    assert.equal(status.platform, platform);
    assert.equal(status.focused, false);
    assert.deepEqual(controller.calls[1].args, platform === 'win32' ? ['status'] : ['status', '-']);
    assert.equal(controller.calls[1].options.timeout, 6000);
    assert.equal(controller.calls[1].options.windowsHide, true);
  }
});

test('native dispatch honors maximize and validates configured macOS identity', async () => {
  const controller = fixture({ platform: 'darwin', environment: { INTERLUDE_CODEX_BUNDLE_ID: 'com.example.Codex' } });
  await controller.focusCodex({ maximize: false });
  assert.deepEqual(controller.calls[1].args, ['no', 'com.example.Codex']);
  for (const value of ['', '-x', 'a\nb.c', 'a b.c', 'x'.repeat(256), '../Codex', 'com.example.Codex;open']) {
    const invalid = fixture({ platform: 'darwin', environment: { INTERLUDE_CODEX_BUNDLE_ID: value } });
    assert.equal((await invalid.focusCodex()).code, 'invalid_configuration');
    assert.equal(invalid.calls.length, 0);
  }
});

test('focus is never inferred from malformed output, a crash, or a timeout', async () => {
  for (const response of ['', 'garbage', '{}', 'null', '[]', native({ focused: 'true' }), native({ focused: true, targetCount: 2 }), native({ focusedWindowMaximized: true })]) {
    const result = await fixture({ response }).focusCodex();
    assert.equal(result.focused, false);
    assert.equal(result.code, 'helper_invalid_response');
  }
  const result = await fixture({ response: native({ focused: true }), error: new Error('timeout') }).focusCodex();
  assert.equal(result.focused, false);
  assert.equal(result.code, 'helper_failed');
});

test('native success preserves verified state and drops unexpected process data', async () => {
  const result = await fixture({ response: native({ focused: true, focusedWindowMaximized: true, code: 'focused', maximizeStatus: 'maximized', secretWindowTitle: 'private', unexpected: { injected: true } }) }).focusCodex();
  assert.equal(result.focused, true);
  assert.equal(result.focusedWindowMaximized, true);
  assert.equal(result.maximizeStatus, 'maximized');
  assert.equal(result.secretWindowTitle, undefined);
  assert.equal(result.unexpected, undefined);
});

test('activation denial and attention remain distinct from successful focus', async () => {
  const result = await fixture({ response: native({ code: 'activation_denied', attentionRequested: true }) }).focusCodex();
  assert.equal(result.focused, false);
  assert.equal(result.attentionRequested, true);
});

test('cancellation prevents builds and native execution after cancellation', async () => {
  const abort = new AbortController();
  abort.abort();
  const first = fixture();
  assert.equal((await first.focusCodex({ signal: abort.signal })).code, 'cancelled');
  assert.equal(first.calls.length, 0);
  const during = new AbortController();
  const second = fixture({ prepare: () => { during.abort(); return '/helper'; } });
  assert.equal((await second.focusCodex({ signal: during.signal })).code, 'cancelled');
  assert.equal(second.calls.length, 1);
  const running = new AbortController();
  const controller = createPlatformController({ platform: 'win32', prepareWindows: async () => '/helper', execute: (_, __, options, callback) => {
    assert.equal(options.signal, running.signal);
    running.abort();
    callback(null, JSON.stringify(native({ focused: true })));
  } });
  assert.equal((await controller.focusCodex({ signal: running.signal })).code, 'cancelled');
});

test('missing compiler and unsupported platforms provide actionable outcomes', async () => {
  assert.equal((await fixture({ prepare: () => { throw new Error('missing'); } }).focusCodex()).code, 'helper_unavailable');
  const controller = fixture({ platform: 'linux' });
  const result = await controller.platformDiagnostics();
  assert.equal(result.supported, false);
  assert.equal(result.code, 'unsupported_platform');
  assert.equal(controller.calls.length, 0);
});

test('native builds reuse completed source revisions and rebuild changed sources', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'interlude-build-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source.txt');
  await writeFile(source, 'one');
  let count = 0;
  const options = { source, directory, name: 'helper', buildKey: 'test', compile: async file => { count++; await writeFile(file, 'compiled'); } };
  const first = await buildNativeHelper(options);
  assert.equal(await readFile(first, 'utf8'), 'compiled');
  assert.equal(await buildNativeHelper(options), first);
  assert.equal(count, 1);
  await writeFile(source, 'two');
  assert.notEqual(await buildNativeHelper(options), first);
  assert.equal(count, 2);
});

test('native builds never publish a failed or cancelled partial executable', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'interlude-build-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source.txt');
  await writeFile(source, 'one');
  const options = { source, directory, name: 'helper', buildKey: 'test' };
  await assert.rejects(buildNativeHelper({ ...options, compile: async file => { await writeFile(file, 'partial'); throw new Error('failed'); } }), /failed/);
  const abort = new AbortController();
  await assert.rejects(buildNativeHelper({ ...options, signal: abort.signal, compile: async file => { await writeFile(file, 'partial'); abort.abort(); } }), /abort/i);
  assert.deepEqual(await readdir(directory), ['source.txt']);
});

test('native builds compile a snapshot even when source changes during compilation', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'interlude-build-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source.txt');
  await writeFile(source, 'before');
  const file = await buildNativeHelper({ source, directory, name: 'helper', buildKey: 'test', compile: async (destination, _, snapshot) => {
    await writeFile(source, 'after');
    await writeFile(destination, await readFile(snapshot));
  } });
  assert.equal(await readFile(file, 'utf8'), 'before');
  assert.equal(await readFile(source, 'utf8'), 'after');
  assert.ok((await readdir(directory)).every(name => !name.includes('.source')));
});

test('empty cached helpers rebuild and a force rebuild replaces a structurally valid cache', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'interlude-build-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source.txt'); await writeFile(source, 'source');
  let builds = 0;
  const options = { source, directory, name: 'helper', buildKey: 'test', compile: async file => writeFile(file, `build-${++builds}`) };
  const file = await buildNativeHelper(options);
  await writeFile(file, '');
  assert.equal(await buildNativeHelper(options), file);
  assert.equal(await readFile(file, 'utf8'), 'build-2');
  assert.equal(await buildNativeHelper({ ...options, force: true }), file);
  assert.equal(await readFile(file, 'utf8'), 'build-3');
  await assert.rejects(buildNativeHelper({ ...options, force: true, compile: async temporary => writeFile(temporary, '') }), /valid native executable/);
  assert.equal(await readFile(file, 'utf8'), 'build-3');
});

test('unexpected cache directories are preserved and replaced without recursive deletion', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'interlude-build-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source.txt'); await writeFile(source, 'source');
  const options = { source, directory, name: 'helper', buildKey: 'test', compile: async file => writeFile(file, 'compiled') };
  const file = await buildNativeHelper(options);
  await rm(file); await mkdir(file); await writeFile(path.join(file, 'keep.txt'), 'preserved');
  assert.equal(await buildNativeHelper(options), file);
  assert.equal(await readFile(file, 'utf8'), 'compiled');
  const saved = (await readdir(directory)).find(name => name.startsWith(`${path.basename(file)}.replaced-`));
  assert.equal(await readFile(path.join(directory, saved, 'keep.txt'), 'utf8'), 'preserved');
});

test('native cache validation rejects broken executable headers and missing executable mode', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'interlude-build-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'helper');
  await writeFile(file, 'not an executable');
  assert.equal(await validNativeArtifact(file, { format: 'pe' }), false);
  assert.equal(await validNativeArtifact(file, { format: 'mach-o' }), false);
  const pe = Buffer.alloc(128); pe.write('MZ'); pe.writeUInt32LE(64, 0x3c); pe.set([0x50, 0x45, 0, 0], 64);
  await writeFile(file, pe); assert.equal(await validNativeArtifact(file, { format: 'pe' }), true);
  pe.writeUInt32LE(1000, 0x3c); await writeFile(file, pe); assert.equal(await validNativeArtifact(file, { format: 'pe' }), false);
  const macho = Buffer.alloc(64); macho.set([0xcf, 0xfa, 0xed, 0xfe]);
  await writeFile(file, macho); assert.equal(await validNativeArtifact(file, { format: 'mach-o' }), true);
  if (process.platform !== 'win32') {
    await chmod(file, 0o600); assert.equal(await validNativeArtifact(file, { format: 'mach-o', executable: true }), false);
    await chmod(file, 0o700); assert.equal(await validNativeArtifact(file, { format: 'mach-o', executable: true }), true);
  }
});

test('symlinked caches are never treated as native executables', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'interlude-build-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'actual'); await mkdir(target);
  const file = path.join(directory, 'helper');
  try { await symlink(target, file, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('This host does not allow creating symlinks.'); return; } throw error; }
  assert.equal(await validNativeArtifact(file), false);
});

test('native build recovery flags are bounded and reject repeated or unknown arguments', () => {
  assert.deepEqual(nativeBuildOptions(['--force', '--smoke'], 'build-native.mjs'), { force: true, smoke: true });
  for (const args of [['--force', '--force'], ['--smoke', '--run'], ['--force=1']]) assert.throws(() => nativeBuildOptions(args, 'build-native.mjs'));
});
