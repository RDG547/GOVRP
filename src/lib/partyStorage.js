import { supabase, supabasePublishableKey, supabaseUrl } from '@/lib/supabaseClient';
import { buildStoragePath } from '@/lib/security';
import { loadWorldRuntime } from '@/lib/worldRuntime';

/**
 * Upload a party logo/header with an explicit world generation.
 * Supabase Storage does not forward the custom HTTP generation header into
 * Postgres, so the storage.objects trigger checks user_metadata instead.
 */
export async function uploadPartyAsset({ file, prefix, entityId }) {
  if (!file || !['party-logos', 'party-headers'].includes(prefix)) {
    throw new Error('Imagem ou categoria de arquivo inválida.');
  }

  // A tab left open across a world reset may have the previous generation
  // cached. Refresh immediately before creating the Storage request.
  const world = await loadWorldRuntime(supabaseUrl, supabasePublishableKey, true);
  if (!world?.generation_id || world.maintenance) {
    throw new Error('O universo está em manutenção ou indisponível. Atualize a página e tente novamente.');
  }

  const path = buildStoragePath({ prefix, entityId, fileName: file.name });
  const { data, error } = await supabase.storage.from('public-assets').upload(path, file, {
    upsert: false,
    metadata: { world_generation: world.generation_id },
  });

  if (error) {
    if (String(error.code || error.statusCode || '').startsWith('5500') ||
        /geração anterior|world.generation|universo está em manutenção/i.test(error.message || '')) {
      throw new Error('A sessão do universo foi atualizada. Recarregue a página e tente enviar a imagem novamente.');
    }
    throw error;
  }

  return supabase.storage.from('public-assets').getPublicUrl(data.path).data.publicUrl;
}
