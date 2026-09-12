import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { ROOT } from '../src/config.mjs';

// A deterministic geometric app icon; generated locally, no remote asset fetch.
const size = 512;
const pixels = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const offset = y * (size * 4 + 1) + 1 + x * 4;
  const outside = Math.hypot(Math.max(64 - x, x - (size - 65), 0), Math.max(64 - y, y - (size - 65), 0)) > 64;
  const bar = y >= 136 && y < 376 && ((x >= 159 && x < 221) || (x >= 291 && x < 353));
  pixels.set(bar ? [202, 255, 61, 255] : [5, 5, 5, outside ? 0 : 255], offset);
}
function chunk(type, bytes) {
  const content = Buffer.concat([Buffer.from(type), bytes]);
  let crc = 0xffffffff;
  for (const byte of content) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  const result = Buffer.alloc(bytes.length + 12); result.writeUInt32BE(bytes.length); content.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result;
}
const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
await mkdir(path.join(ROOT, '.desktop-build'), { recursive: true });
await writeFile(path.join(ROOT, '.desktop-build', 'icon.png'), png);
