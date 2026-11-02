import { createClient } from '@supabase/supabase-js';
import { isPlatformAdmin, assertRealWorldAction } from '../../server/admin/development.js';

// Only the authenticated Admin can request each bounded batch. This endpoint
// deletes actual Storage files through the Storage API, NOT storage.objects SQL.
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  }
  try {
    const url = process.env.VITE_SUPABASE_URL;
    const publicKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !publicKey || !secret) throw new Error('Credenciais do backend indisponíveis.');
    const token = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1];
    if (!token) return res.status(401).json({ error: 'Autenticação necessária.' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const requestId = body?.requestId;
    if (body?.confirmation !== 'APAGAR BACKUP DISPENSADO' ||
        typeof requestId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(requestId)) {
      return res.status(400).json({ error: 'Informe o reset e confirme a exclusão do backup dispensado.' });
    }

    const service = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: identity, error: authError } = await service.auth.getUser(token);
    if (authError || !identity?.user) return res.status(401).json({ error: 'Sessão inválida.' });
    if (!await isPlatformAdmin(service, identity.user.id))
      return res.status(403).json({ error: 'Somente administradores podem excluir estes arquivos.' });
    await assertRealWorldAction(service, identity.user.id);
    const member = createClient(url, publicKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: files, error: listError } = await member.rpc('admin_list_skipped_reset_backup_files', {
      p_request_id: requestId,
    });
    if (listError) throw listError;
    if (files?.length) {
      const { error: deleteError } = await service.storage.from('rp-reset-backups').remove(files);
      if (deleteError) throw deleteError;
    }
    const { data: remaining, error: verifyError } = await member.rpc('admin_list_skipped_reset_backup_files', {
      p_request_id: requestId,
    });
    if (verifyError) throw verifyError;
    if (remaining?.length) {
      return res.status(200).json({ completed: false, removedThisBatch: files?.length || 0, more: true });
    }
    const { data: finalized, error: finalizeError } = await member.rpc('admin_finalize_skipped_reset_backup_cleanup', {
      p_request_id: requestId,
    });
    if (finalizeError) throw finalizeError;
    return res.status(200).json({ completed: true, removedThisBatch: files?.length || 0,
      chunksRemoved: finalized?.chunks_removed || 0 });
  } catch (e) {
    console.error('[GOVRP reset backup cleanup]', { code: e?.code, status: e?.status || e?.statusCode });
    return res.status(e?.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : 500).json({
      error: 'Não foi possível concluir a remoção do backup dispensado. Nenhuma conta ou dado do mundo atual foi alterado.',
    });
  }
}
