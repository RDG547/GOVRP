import {previewRequestBlocked,ADMIN_PREVIEW_MESSAGE} from './adminPreview';
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
  global:{fetch:(input,options)=>previewRequestBlocked(input,options)?Promise.resolve(new Response(JSON.stringify({code:'42501',message:ADMIN_PREVIEW_MESSAGE}),{status:403,headers:{'Content-Type':'application/json'}})):globalThis.fetch(input,options)},
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});
