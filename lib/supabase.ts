import { createClient,type SupabaseClient } from '@supabase/supabase-js';
import { publicConfig } from './public-config';
import {isManagedWorkContent} from './work-context';

type ClientWorkspace='personal'|'work'|null;
let workspace:ClientWorkspace=null;
let client:SupabaseClient|undefined;

function managedWorkRow(item:unknown){
  if(!item||typeof item!=='object')return false;
  const row=item as {area?:unknown;content?:unknown};
  return row.area==='Work'&&typeof row.content==='string'&&isManagedWorkContent(row.content);
}

function sanitizePersonalCache(){
  if(typeof indexedDB==='undefined')return;
  try{
    const request=indexedDB.open('dylans-toolbox');
    request.onsuccess=()=>{
      const database=request.result;
      if(!database.objectStoreNames.contains('cache')){database.close();return;}
      const tx=database.transaction('cache','readwrite'),store=tx.objectStore('cache'),read=store.getAll();
      read.onsuccess=()=>{
        for(const entry of read.result??[]){
          if(!entry||!Array.isArray(entry.items))continue;
          const items=entry.items.filter((item:unknown)=>!managedWorkRow(item));
          if(items.length!==entry.items.length)store.put({...entry,items});
        }
      };
      tx.oncomplete=()=>database.close();tx.onerror=tx.onabort=()=>database.close();
    };
  }catch{}
}

export function setClientWorkspace(next:ClientWorkspace){
  workspace=next;
  if(next==='personal')sanitizePersonalCache();
}

async function scopedFetch(input:RequestInfo|URL,init?:RequestInit){
  const response=await fetch(input,init);
  if(!workspace||!response.ok)return response;
  const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
  const method=(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
  if(method!=='GET'||!url.includes('/rest/v1/items'))return response;
  const contentType=response.headers.get('content-type')||'';
  if(!contentType.includes('application/json'))return response;
  try{
    const data=await response.clone().json();
    if(!Array.isArray(data))return response;
    const filtered=data.filter((item:unknown)=>workspace==='work'?managedWorkRow(item):!managedWorkRow(item));
    if(filtered.length===data.length)return response;
    const headers=new Headers(response.headers);headers.delete('content-length');
    return new Response(JSON.stringify(filtered),{status:response.status,statusText:response.statusText,headers});
  }catch{return response;}
}

export async function getSupabase(){
  return client??=createClient(publicConfig.url,publicConfig.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true},global:{fetch:scopedFetch}});
}
