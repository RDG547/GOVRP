import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Blob } from 'node:buffer';
import { detectSupportedImageContentType } from '../src/lib/security.js';

const fakePickerFile = (bytes, type = 'text/plain;charset=UTF-8') =>
  new Blob([Uint8Array.from(bytes)], { type });

const imageCases = [
  { bytes: [0xff, 0xd8, 0xff, 0xe0], mime: 'image/jpeg' },
  { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], mime: 'image/png' },
  { bytes: [...Buffer.from('GIF89a')], mime: 'image/gif' },
  { bytes: [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')], mime: 'image/webp' },
  { bytes: [0, 0, 0, 24, ...Buffer.from('ftypavif')], mime: 'image/avif' },
];

for (const { bytes, mime } of imageCases) {
  // Mobile providers may report text/plain even for genuine images.
  assert.equal(await detectSupportedImageContentType(fakePickerFile(bytes)), mime);
}
assert.equal(await detectSupportedImageContentType(fakePickerFile([...Buffer.from('not an image')], 'image/jpeg')), null);

const xProfile = readFileSync('src/components/social-x/profile/EditProfileModal.jsx', 'utf8');
assert.match(xProfile, /contentType:\s*avatarContentType/);
assert.match(xProfile, /contentType:\s*headerContentType/);
assert.match(xProfile, /detectSupportedImageContentType\(avatarFile\)/);
assert.match(xProfile, /detectSupportedImageContentType\(headerFile\)/);

const partyForm = readFileSync('src/components/parties/PartyManagementDialog.jsx', 'utf8');
const rpcCall = partyForm.match(/supabase\.rpc\('update_party_details_with_number',[\s\S]*?\n\s*\}\);/)?.[0];
assert.ok(rpcCall, 'Party edit RPC must exist');
assert.match(rpcCall, /p_logo_url:\s*party\.logo_url\s*\?\?\s*null/);
assert.match(partyForm, /p_electoral_number:\s*formData\.electoral_number/);

console.log('OK: X image MIME validation and party RPC arguments');
