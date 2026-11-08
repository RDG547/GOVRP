import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectSupportedImageContentType, snapshotSelectedImageFile } from '../src/lib/security.js';

const signatures = [
  { name: 'camera.jpg', bytes: [255, 216, 255, 224], type: 'image/jpeg' },
  { name: 'photo.bin', bytes: [137, 80, 78, 71, 13, 10, 26, 10], type: 'image/png' },
  { name: 'avatar.gif', bytes: [...Buffer.from('GIF89a')], type: 'image/gif' },
  { name: 'webp.txt', bytes: [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')], type: 'image/webp' },
  { name: 'photo.avif', bytes: [0, 0, 0, 24, ...Buffer.from('ftypavif')], type: 'image/avif' },
];

for (const { name, bytes, type } of signatures) {
  let allowed = true;
  let reads = 0;
  const source = {
    name, type: 'text/plain;charset=UTF-8', size: bytes.length, lastModified: 12345,
    async arrayBuffer() {
      reads++;
      if (!allowed) throw Object.assign(new Error('Permission revoked'), { name: 'NotReadableError' });
      return Uint8Array.from(bytes).buffer;
    },
  };
  // This happens at file selection, while the browser can read the original.
  const stableFile = await snapshotSelectedImageFile(source);
  allowed = false; // Android picker has now revoked the original reference.
  assert.equal(reads, 1);
  assert.equal(stableFile.name, name);
  assert.equal(stableFile.type, type);
  assert.equal(await detectSupportedImageContentType(stableFile), type);
  assert.deepEqual([...new Uint8Array(await stableFile.arrayBuffer())], bytes);
  assert.equal(reads, 1, 'Submitting must read only the cached copy');
}

await assert.rejects(() => snapshotSelectedImageFile({
  name: 'lost.jpg', size: 4, async arrayBuffer() {
    throw Object.assign(new Error('File no longer readable'), { name: 'NotReadableError' });
  },
}), { name: 'NotReadableError' });
await assert.rejects(() => snapshotSelectedImageFile({
  name: 'spoofed.png', size: 6, async arrayBuffer() {
    return Uint8Array.from(Buffer.from('NOTPNG')).buffer;
  },
}), /Formato de imagem inválido/);
await assert.rejects(() => snapshotSelectedImageFile({
  name: 'partial.png', size: 9, async arrayBuffer() {
    return Uint8Array.from([0x89, 0x50]).buffer;
  },
}), /não pôde ser lido completamente/);

const uploader = readFileSync('src/components/ImageUploader.jsx', 'utf8');
const form = readFileSync('src/components/dashboard/ProductFormDialog.jsx', 'utf8');
assert.match(uploader, /await snapshotSelectedImageFile\(selectedFile\)/);
assert.match(uploader, /cacheSelectedFile \? \[\] : allowedMimeTypes/);
assert.match(uploader, /cacheSelectedFile \? \[\] : allowedExtensions/);
assert.match(uploader, /onPreparingChange\?\.\(true\)/);
assert.match(uploader, /sequence !== selectionSequence\.current/);
assert.match(uploader, /Não foi possível acessar a foto selecionada/);
assert.match(form, /cacheSelectedFile/);
assert.match(form, /disabled=\{loading \|\| imagePreparing/);
assert.match(form, /if \(loading \|\| imagePreparing\) return/);
assert.match(form, /\.upload\(newFileName, imageBlob, \{ upsert: false, contentType: imageContentType \}\)/);
assert.match(form, /uploadedImage\.current = \{ file: imageFile, url: finalImageUrl, path: uploadedPath \}/);
assert.match(form, /p_idempotency_key:requestKey\.current/);
assert.match(form, /thirst:15,happiness:8,health:-3/);
console.log('PASS: Android permission loss, real MIME detection, rejected files, independent bytes, UI guards and idempotency');
