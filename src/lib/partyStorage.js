import { supabase } from '@/lib/supabaseClient';
import { buildStoragePath } from '@/lib/security';

/**
 * Uploads use the ordinary Storage owner/bucket policies. The database reset
 * maintenance gate protects destructive transitions without browser metadata.
 */
export async function uploadPartyAsset({ file, prefix, entityId }) {
  if (!file || !['party-logos', 'party-headers'].includes(prefix)) {
    throw new Error('Imagem ou categoria de arquivo inválida.');
  }

  const path = buildStoragePath({ prefix, entityId, fileName: file.name });
  const { data, error } = await supabase.storage.from('public-assets').upload(path, file, {
    upsert: false,
  });

  if (error) {
    if (/manutenção/i.test(error.message || '')) {
      throw new Error('O GOVRP está em manutenção. Tente novamente em instantes.');
    }
    throw error;
  }

  return supabase.storage.from('public-assets').getPublicUrl(data.path).data.publicUrl;
}
