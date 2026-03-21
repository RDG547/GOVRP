import { createClient } from '@supabase/supabase-js';
import {
  getOptionalPublicEnv,
  getRequiredPublicEnv,
  getRequiredPublicHttpsEnv,
} from '@/lib/env';

const supabaseUrl = getRequiredPublicHttpsEnv('VITE_SUPABASE_URL');
const supabasePublishableKey =
  getOptionalPublicEnv('VITE_SUPABASE_PUBLISHABLE_KEY') ||
  getRequiredPublicEnv('VITE_SUPABASE_ANON_KEY');

export { supabaseUrl, supabasePublishableKey };

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});
