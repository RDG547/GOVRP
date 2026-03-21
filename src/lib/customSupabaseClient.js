import { supabase } from '@/lib/supabaseClient';

const customSupabaseClient = supabase;

export default customSupabaseClient;

export {
  customSupabaseClient,
  customSupabaseClient as supabase,
};
