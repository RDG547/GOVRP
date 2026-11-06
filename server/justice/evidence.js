import process from 'node:process';
import { Buffer } from 'node:buffer';
import { randomUUID, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { fileTypeFromBuffer } from 'file-type';
import { withWorldRequest, worldServerFetch } from '../world/request.js';
import { assertRealWorldAction } from '../admin/development.js';

export const EVIDENCE_LIMIT = 4 * 1024 * 1024;
const formats = new Map([
  ['jpg', ['jpg', 'jpeg']], ['png', ['png']], ['gif', ['gif']], ['webp', ['webp']], ['avif', ['avif']],
  ['mp4', ['mp4']], ['mov', ['mov']], ['webm', ['webm']], ['mp3', ['mp3']], ['wav', ['wav']],
  ['pdf', ['pdf']], ['docx', ['docx']], ['xlsx', ['xlsx']], ['pptx', ['pptx']], ['odt', ['odt']], ['ods', ['ods']],
]);
export async function validateEvidence(body, filename, declaredMime) {
  if (!body.length || body.length > EVIDENCE_LIMIT) throw Object.assign(new Error('Cada anexo deve ter entre 1 byte e 4 MB.'), { statusCode: 413 });
  const extension = filename.split('.').at(-1)?.toLowerCase();
  let detected;
  try { detected = await fileTypeFromBuffer(body); } catch { throw Object.assign(new Error('O arquivo está incompleto ou não possui formato reconhecido.'), { statusCode: 415 }); }
  if (detected && formats.get(detected.ext)?.includes(extension)) {
    // Mobile browsers occasionally omit the MIME; the bytes are authoritative.
    if (declaredMime && !['application/octet-stream', detected.mime].includes(declaredMime)) throw Object.assign(new Error('O conteúdo do arquivo não corresponde ao formato informado.'), { statusCode: 415 });
    return { ext: detected.ext, mime: detected.mime };
  }
  if (!detected && ['txt', 'csv'].includes(extension)) {
    let value;
    try { value = new TextDecoder('utf-8', { fatal: true }).decode(body); } catch { throw Object.assign(new Error('Documentos de texto devem usar a codificação UTF-8.'), { statusCode: 415 }); }
    if (value.includes('\0') || /^\s*<(?:!doctype|html|svg|script)/i.test(value)) throw Object.assign(new Error('O arquivo contém conteúdo executável ou formato não permitido.'), { statusCode: 415 });
    if (declaredMime && !['text/plain', 'text/csv', 'application/csv', 'application/octet-stream', 'application/vnd.ms-excel'].includes(declaredMime)) throw Object.assign(new Error('O formato informado não corresponde a um documento de texto.'), { statusCode: 415 });
    return { ext: extension, mime: extension === 'csv' ? 'text/csv' : 'text/plain' };
  }
  throw Object.assign(new Error('Formato não permitido ou extensão diferente do conteúdo. Use imagens, vídeo, áudio, PDF, documentos, planilhas ou texto.'), { statusCode: 415 });
}
const json = (res, status, payload) => {
  res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.end(JSON.stringify(payload));
};
const bodyOf = request => new Promise((resolve, reject) => {
  const chunks = []; let bytes = 0; let failed = false;
  request.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > EVIDENCE_LIMIT) { if (!failed) reject(Object.assign(new Error('Cada anexo deve ter no máximo 4 MB.'), { statusCode: 413 })); failed = true; return; }
    if (!failed) chunks.push(chunk);
  });
  request.on('end', () => { if (!failed) resolve(Buffer.concat(chunks)); }); request.on('error', reject);
});
export const evidenceHandler = (request, response) => withWorldRequest(request, async () => {
  if (request.method === 'OPTIONS') { response.statusCode = 204; response.end(); return; }
  if (!['POST', 'GET'].includes(request.method)) { response.setHeader('Allow', 'POST, GET, OPTIONS'); json(response, 405, { error: 'Método não permitido.' }); return; }
  try {
    const url = process.env.VITE_SUPABASE_URL, secret = process.env.SUPABASE_SECRET_KEY;
    const token = /^Bearer (.+)$/i.exec(request.headers.authorization || '')?.[1];
    if (!token) { json(response, 401, { error: 'Entre novamente para acessar os anexos.' }); return; }
    const service = createClient(url, secret, { global: { fetch: worldServerFetch }, auth: { persistSession: false, autoRefreshToken: false } });
    const scoped = createClient(url, process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY, { global: { fetch: worldServerFetch, headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const session = await service.auth.getUser(token);
    if (session.error || !session.data.user) { json(response, 401, { error: 'Sua sessão expirou. Entre novamente.' }); return; }
    if (request.method === 'GET') {
      const id = new URL(request.url, 'http://localhost').searchParams.get('id');
      if (!/^[a-f0-9-]{36}$/i.test(id || '')) { json(response, 400, { error: 'Selecione uma prova válida.' }); return; }
      const file = await scoped.rpc('get_police_evidence_file', { p_evidence_id: id });
      if (file.error) { json(response, 403, { error: 'A prova não está disponível para sua conta.' }); return; }
      const [signed,preview] = await Promise.all([service.storage.from('justice-evidence').createSignedUrl(file.data.path, 120, { download: file.data.name }), service.storage.from('justice-evidence').createSignedUrl(file.data.path, 120)]);
      if (signed.error || preview.error) throw signed.error || preview.error;
      json(response, 200, { ...file.data, path: undefined, url: signed.data.signedUrl, preview_url: preview.data.signedUrl }); return;
    }
    await assertRealWorldAction(service, session.data.user.id);
    const filename = decodeURIComponent(request.headers['x-evidence-filename'] || '').normalize('NFC').replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 180);
    if (!filename || !filename.includes('.')) { json(response, 400, { error: 'Informe o nome e a extensão do anexo.' }); return; }
    const body = await bodyOf(request);
    const type = await validateEvidence(body, filename, `${request.headers['content-type'] || ''}`.split(';')[0].trim().toLowerCase());
    const id = randomUUID(), path = `${id}/${randomUUID()}.${type.ext}`;
    const upload = await service.storage.from('justice-evidence').upload(path, body, { contentType: type.mime, upsert: false, cacheControl: '0' });
    if (upload.error) throw upload.error;
    const record = await service.rpc('register_police_evidence_upload', { p_id: id, p_profile_id: session.data.user.id, p_path: path, p_filename: filename, p_mime: type.mime, p_bytes: body.length, p_sha256: createHash('sha256').update(body).digest('hex') });
    if (record.error) { await service.storage.from('justice-evidence').remove([path]); json(response, 400, { error: /limite|cidadania/i.test(record.error.message) ? record.error.message : 'Não foi possível registrar o anexo. Tente novamente.' }); return; }
    json(response, 201, record.data);
  } catch (error) { console.error('Anexo judicial recusado', { code: error.code, status: error.statusCode }); json(response, error.statusCode || 500, { error: error.statusCode ? error.message : 'Não foi possível processar o anexo. Tente novamente.' }); }
});
