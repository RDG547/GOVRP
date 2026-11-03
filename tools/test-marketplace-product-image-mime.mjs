import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Blob } from 'node:buffer';
import { detectSupportedImageContentType } from '../src/lib/security.js';

const asMisreportedImage = (signature) =>
  new Blob([Uint8Array.from(signature)], { type: 'text/plain;charset=UTF-8' });

for (const [bytes, expected] of [
  [[0xff, 0xd8, 0xff, 0xe0], 'image/jpeg'],
  [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png'],
  [[...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')], 'image/webp'],
  [[...Buffer.from('GIF89a')], 'image/gif'],
  [[0, 0, 0, 24, ...Buffer.from('ftypavif')], 'image/avif'],
]) {
  const file = asMisreportedImage(bytes);
  assert.equal(await detectSupportedImageContentType(file), expected);
  assert.equal(file.slice(0, file.size, expected).type, expected);
}
assert.equal(await detectSupportedImageContentType(asMisreportedImage([...Buffer.from('not an image')])), null);

const form = readFileSync('src/components/dashboard/ProductFormDialog.jsx', 'utf8');
assert.match(form, /await detectSupportedImageContentType\(imageFile\)/);
assert.match(form, /imageFile\.slice\(0, imageFile\.size, imageContentType\)/);
assert.match(form, /\.upload\(newFileName, imageBlob, \{ upsert: false, contentType: imageContentType \}\)/);
assert.match(form, /if \(!imageContentType\)/);
assert.match(form, /uploadedImage\.current = \{ file: imageFile, url: finalImageUrl, path: uploadedPath \}/);
assert.match(form, /publish_business_product/);
console.log('OK: image MIME detection, rejected invalid content, and product image upload normalization');
