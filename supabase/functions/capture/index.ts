import {handleCapture} from '../../../lib/capture-handler.ts';

Deno.serve((request:Request)=>handleCapture(request,{
  SUPABASE_URL:Deno.env.get('SUPABASE_URL'),
  SUPABASE_ANON_KEY:Deno.env.get('SUPABASE_ANON_KEY'),
  OPENAI_API_KEY:Deno.env.get('OPENAI_API_KEY'),
  OPENAI_MODEL:Deno.env.get('OPENAI_MODEL'),
}));
