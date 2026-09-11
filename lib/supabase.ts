import { createClient,type SupabaseClient } from '@supabase/supabase-js';
import { publicConfig } from './public-config';
import {isManagedWorkContent} from './work-context';

type ClientWorkspace='personal'|'work'|null;
let workspace:ClientWorkspace=null;
let client:SupabaseClient|undefined;

export function setClientWorkspace(next:ClientWorkspace){workspace=next;}

async function scopedFetch(input:RequestInfo|URL,init?:RequestInit){
  const response=await fetch(input,init);
  if(workspace!=='personal'||!response.ok)return response;
  const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
  const method=(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
  if(method!=='GET'||!url.includes('/rest/v1/items'))return response;
  const contentType=response.headers.get('content-type')||'';
  if(!contentType.includes('application/json'))return response;
  try{
    const data=await response.clone().json();
    if(!Array.isArray(data))return response;
    const filtered=data.filter((item:unknown)=>{
      if(!item||typeof item!=='object')return true;
      const row=item as {area?:unknown;content?:unknown};
      return !(row.area==='Work'&&typeof row.content==='string'&&isManagedWorkContent(row.content));
    });
    if(filtered.length===data.length)return response;
    const headers=new Headers(response.headers);headers.delete('content-length');
    return new Response(JSON.stringify(filtered),{status:response.status,statusText:response.statusText,headers});
  }catch{return response;}
}

export async function getSupabase(){
  return client??=createClient(publicConfig.url,publicConfig.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true},global:{fetch:scopedFetch}});
}
