import { supabase } from '@/lib/supabaseClient';
import { buildStoragePath } from '@/lib/security';

/**
 * Upload a party logo/header with an explicit world generation.
 * Supabase Storage does not forward the custom HTTP generation header into
 * Postgres, so the storage.objects trigger checks user_metadata instead.
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
