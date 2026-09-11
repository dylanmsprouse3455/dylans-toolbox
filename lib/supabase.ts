import { createClient,type SupabaseClient } from '@supabase/supabase-js';
import { publicConfig } from './public-config';
let client:SupabaseClient|undefined;
export async function getSupabase(){
  return client??=createClient(publicConfig.url,publicConfig.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
}
