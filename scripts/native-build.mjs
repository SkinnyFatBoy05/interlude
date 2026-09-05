import { lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

export async function validNativeArtifact(file, { format, executable = false } = {}) {
  let info;
  try { info = await lstat(file); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0) return false;
  if (executable && process.platform !== 'win32' && (info.mode & 0o111) === 0) return false;
  if (!format) return true;
  const handle = await open(file, 'r');
  try {
    const header = Buffer.alloc(64);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (format === 'pe') {
      if (bytesRead < 64 || header[0] !== 0x4d || header[1] !== 0x5a) return false;
      const offset = header.readUInt32LE(0x3c);
      if (offset < 64 || offset > info.size - 4) return false;
      const signature = Buffer.alloc(4);
      await handle.read(signature, 0, 4, offset);
      return signature.equals(Buffer.from([0x50, 0x45, 0, 0]));
    }
    if (format === 'mach-o') return bytesRead >= 32 && ['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(header.subarray(0, 4).toString('hex'));
    throw new Error('Unknown native executable format.');
  } finally { await handle.close(); }
}

export function nativeBuildOptions(args, script) {
  if (args.some(arg => !['--smoke', '--force'].includes(arg)) || new Set(args).size !== args.length) throw new Error(`Use ${script} [--smoke] [--force].`);
  return { force: args.includes('--force'), smoke: args.includes('--smoke') };
}

export async function buildNativeHelper({ source, directory, name, extension = '', buildKey, compile, signal, force = false, format, executable = false }) {
  signal?.throwIfAborted();
  const sourceBytes = await readFile(source);
  const hash = createHash('sha256').update(sourceBytes).update(buildKey).digest('hex').slice(0, 20);
  const folder = path.resolve(directory);
  const child = basename => {
    const candidate = path.resolve(folder, basename);
    if (path.dirname(candidate) !== folder) throw new Error('Native build paths must remain inside the helper directory.');
    return candidate;
  };
  const destination = child(`${name}-${hash}${extension}`);
  const validation = { format, executable };
  if (!force && await validNativeArtifact(destination, validation)) { signal?.throwIfAborted(); return destination; }
  await mkdir(folder, { recursive: true });
  const unique = `${name}-${hash}-${randomUUID()}`;
  const temporary = child(`${unique}${extension}`);
  const snapshot = child(`${unique}.source${path.extname(source)}`);
  try {
    // Compile the bytes we hashed even if an editor changes the source during the build.
    await writeFile(snapshot, sourceBytes, { flag: 'wx', mode: 0o600 });
    signal?.throwIfAborted();
    await compile(temporary, signal, snapshot);
    signal?.throwIfAborted();
    if (!await validNativeArtifact(temporary, validation)) throw new Error('The compiler did not produce a valid native executable.');
    if (!force && await validNativeArtifact(destination, validation)) return destination;
    let previous;
    try {
      await lstat(destination);
      previous = child(`${path.basename(destination)}.replaced-${randomUUID()}`);
      // Preserve unexpected files and directories without traversing or deleting their contents.
      await rename(destination, previous);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await rename(temporary, destination); }
    catch (error) {
      if (await validNativeArtifact(destination, validation)) return destination;
      if (previous) {
        try { await lstat(destination); }
        catch (missing) { if (missing.code === 'ENOENT') await rename(previous, destination); }
      }
      throw error;
    }
    return destination;
  } finally { await Promise.all([rm(temporary, { force: true }), rm(snapshot, { force: true })]); }
}
