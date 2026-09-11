import type {SupabaseClient} from '@supabase/supabase-js';
import type {Item} from './items.ts';
import {organizedCapture} from './capture-schema.ts';
const columns='id,type,title,content,area,status,importance,urgency,due_at,due_date,parent_id,updated_at';
function turnFocus(content:string){try{const id=JSON.parse(content).focus_id;return typeof id==='string'&&/^[a-f0-9-]{36}$/i.test(id)?id:null;}catch{return null;}}
export async function conversationContext(client:SupabaseClient,text:string,focusId?:string,replyTo?:string){
  const recent=await client.from('items').select(columns).neq('type','capture').order('updated_at',{ascending:false}).limit(160);
  if(recent.error)throw new Error('STORE');
  const candidates=new Map<string,Item>((recent.data as Item[]).map(item=>[item.id,item]));
  const history=await client.from('items').select('id,content,source_text,turn_result').eq('type','capture').eq('status','processed').order('created_at',{ascending:false}).limit(6);
  if(history.error)throw new Error('STORE');
  const turns=history.data??[];
  if(replyTo&&!turns.some(turn=>turn.id===replyTo)){
    const prior=await client.from('items').select('id,content,source_text,turn_result').eq('id',replyTo).eq('type','capture').eq('status','processed').maybeSingle();
    if(prior.error)throw new Error('STORE');if(prior.data)turns.unshift(prior.data);
  }
  const related=turns.flatMap(turn=>[...(turn.turn_result?.created_ids??[]),...(turn.turn_result?.updated_ids??[]),turnFocus(turn.content)]).filter(Boolean);
  const ids=[...new Set([...(focusId?[focusId]:[]),...related])].filter(id=>!candidates.has(id)).slice(0,100);
  if(ids.length){const found=await client.from('items').select(columns).in('id',ids).neq('type','capture');if(found.error)throw new Error('STORE');for(const item of found.data??[])candidates.set(item.id,item as Item);}
  // Search task titles as well as recent items, so older named tasks can be found.
  const words=[...new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,40}/gu)??[])].filter(word=>!['the','and','that','this','with','have','done','tomorrow','today','please','task','time','work','bring'].includes(word)).slice(0,8);
  if(words.length){const found=await client.from('items').select(columns).neq('type','capture').or(words.map(word=>'title.ilike.%'+word+'%').join(',')).order('updated_at',{ascending:false}).limit(80);if(found.error)throw new Error('STORE');for(const item of found.data??[])candidates.set(item.id,item as Item);}
  return {candidates,input:{utterance:text,focused_item_id:focusId??null,reply_to:replyTo??null,search_is_partial:true,
    recent_turns:turns.map(turn=>({id:turn.id,user:turn.source_text.slice(0,4000),focused_item_id:turnFocus(turn.content),assistant:turn.turn_result?.reply??'',related_item_ids:[...(turn.turn_result?.created_ids??[]),...(turn.turn_result?.updated_ids??[])]})),
    existing_items:[...candidates.values()].map(item=>({...item,content:item.content.slice(0,800)}))}};
}
export function checkedChanges(plan:ReturnType<typeof organizedCapture.parse>,candidates:Map<string,Item>){
  if(plan.needs_clarification&&(plan.items.length||plan.updates.length))throw new Error('ORGANIZE');
  const seen=new Set<string>();
  for(const item of plan.items.flatMap(item=>[item,...item.subtasks]))if(item.due_at&&item.due_date)throw new Error('ORGANIZE');
  return plan.updates.map(change=>{
    const item=candidates.get(change.item_id);
    if(!item||seen.has(item.id)||change.due_at&&change.due_date)throw new Error('ORGANIZE');
    seen.add(item.id);
    if((change.status||change.change_due)&&!['task','reminder'].includes(item.type))throw new Error('ORGANIZE');
    if(!change.status&&!change.change_due&&change.title===null&&change.content===null&&change.area===null)throw new Error('ORGANIZE');
    if(change.status&&plan.updates.some(other=>other.item_id===item.parent_id&&other.status))throw new Error('ORGANIZE');
    return {...change,expected_updated_at:item.updated_at};
  });
}
