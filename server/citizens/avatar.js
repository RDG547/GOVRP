import {withWorldRequest,worldServerFetch} from '../world/request.js';
import {assertRealWorldAction} from '../admin/development.js';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const AVATAR_BUCKET = 'avatars';
const MAX_AVATAR_BYTES = 4 * 1024 * 1024;
const MIME_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/avif', 'avif'],
]);

let serverSupabase;

const json = (response, statusCode, payload) => {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
};

const getRequiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`A variável ${name} não foi configurada no servidor.`);
  return value;
};

const getServerSupabase = () => {
  if (!serverSupabase) {
    serverSupabase = createClient(
      getRequiredEnv('VITE_SUPABASE_URL'),
      getRequiredEnv('SUPABASE_SECRET_KEY'),
      {global:{fetch:worldServerFetch}, auth: { autoRefreshToken: false, persistSession: false } },
    );
  }
  return serverSupabase;
};

const readBody = (request, maximumBytes) => new Promise((resolve, reject) => {
  const chunks = [];
  let total = 0;
  request.on('data', (chunk) => {
    total += chunk.length;
    if (total > maximumBytes) {
      const error = new Error('A imagem deve ter no máximo 4 MB.');
      error.statusCode = 413;
      reject(error);
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on('end', () => resolve(Buffer.concat(chunks)));
  request.on('error', reject);
});

const getUser = async (supabase, request) => {
  const authorization = request.headers?.authorization || '';
  const token = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  if (!token) {
    const error = new Error('Sessão inválida.');
    error.statusCode = 401;
    throw error;
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.id) {
    const authError = new Error('Não foi possível validar a sessão.');
    authError.statusCode = 401;
    throw authError;
  }
  return data.user;
};

const raw_citizenAvatarHandler = async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.statusCode = 204;
    response.end();
    return;
  }
  if (!['POST', 'DELETE'].includes(request.method)) {
    response.setHeader('Allow', 'POST, DELETE, OPTIONS');
    json(response, 405, { error: 'Método não permitido.' });
    return;
  }

  try {
    const supabase = getServerSupabase();
    const user = await getUser(supabase, request);
    await assertRealWorldAction(supabase,user.id);

    if (request.method === 'POST') {
      const mimeType = `${request.headers?.['content-type'] || ''}`.split(';')[0].trim().toLowerCase();
      const extension = MIME_EXTENSIONS.get(mimeType);
      if (!extension) {
        json(response, 415, { error: 'Formato de imagem não permitido.' });
        return;
      }
      const body = await readBody(request, MAX_AVATAR_BYTES);
      if (!body.length) {
        json(response, 400, { error: 'Selecione uma imagem para enviar.' });
        return;
      }
      const path = `${user.id}/avatar-${randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(path, body, { contentType: mimeType, upsert: false });
      if (uploadError) throw uploadError;
      const publicUrl = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
      json(response, 201, { path, publicUrl });
      return;
    }

    const body = await readBody(request, 16 * 1024);
    const payload = body.length ? JSON.parse(body.toString('utf8')) : {};
    const path = typeof payload.path === 'string' ? decodeURIComponent(payload.path).replace(/^\/+/, '') : '';
    if (!path.startsWith(`${user.id}/`)) {
      json(response, 403, { error: 'Você só pode remover a própria imagem.' });
      return;
    }
    const { error: removeError } = await supabase.storage.from(AVATAR_BUCKET).remove([path]);
    if (removeError) throw removeError;
    json(response, 200, { removed: true });
  } catch (error) {
    json(response, error.statusCode || 500, { error: error.message || 'Não foi possível processar a imagem.' });
  }
};

export const citizenAvatarHandler=(request,response)=>withWorldRequest(request,()=>raw_citizenAvatarHandler(request,response));
