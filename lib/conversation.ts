import type {SupabaseClient} from '@supabase/supabase-js';
import type {Item} from './items.ts';
import {organizedCapture} from './capture-schema.ts';
import {isManagedWorkContent} from './work-context.ts';
const columns='id,type,title,content,area,status,importance,urgency,due_at,due_date,parent_id,depends_on_id,updated_at,completed_at,last_opened_at';
type PersonalEntity={canonical_name:string;aliases:string[];relationship:string|null;entity_type:'person'|'pet'};
function turnFocus(content:string){try{const id=JSON.parse(content).focus_id;return typeof id==='string'&&/^[a-f0-9-]{36}$/i.test(id)?id:null;}catch{return null;}}
function belongs(item:Item,workspace:'personal'|'work'){
  const managed=item.area==='Work'&&isManagedWorkContent(item.content);
  return workspace==='work'?managed:item.area!=='Work';
}
function normalizedPhrase(value:string){return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
function mentions(text:string,value:string){const hay=' '+normalizedPhrase(text)+' ',needle=normalizedPhrase(value);return !!needle&&hay.includes(' '+needle+' ');}
export async function conversationContext(client:SupabaseClient,text:string,focusId?:string,replyTo?:string,workspace:'personal'|'work'='personal',channel:'capture'|'ai'='capture'){
  let recentQuery=client.from('items').select(columns).neq('type','capture');
  if(workspace==='work')recentQuery=recentQuery.eq('area','Work');else recentQuery=recentQuery.neq('area','Work');
  const recent=await recentQuery.order('updated_at',{ascending:false}).limit(160);
  if(recent.error)throw new Error('STORE');
  const recentItems=(recent.data as Item[]).filter(item=>belongs(item,workspace));
  const candidates=new Map<string,Item>(recentItems.map(item=>[item.id,item]));
  let entities:PersonalEntity[]=[];
  if(workspace==='personal'){
    const entityResult=await client.from('personal_entities').select('canonical_name,aliases,relationship,entity_type').eq('active',true).order('canonical_name').limit(100);
    if(entityResult.error)throw new Error('STORE');
    entities=(entityResult.data??[]) as PersonalEntity[];
  }
  let historyQuery=client.from('items').select('id,title,content,source_text,turn_result,area').eq('type','capture').eq('status','processed');
  if(workspace==='work')historyQuery=historyQuery.eq('area','Work');else historyQuery=historyQuery.neq('area','Work');
  if(workspace==='personal'&&channel==='ai')historyQuery=historyQuery.eq('title','AI conversation');
  const history=await historyQuery.order('created_at',{ascending:false}).limit(workspace==='work'?6:12);
  if(history.error)throw new Error('STORE');
  const turns=(history.data??[]).filter(turn=>workspace==='work'?turn.area==='Work':turn.area!=='Work').slice(0,6);
  if(replyTo&&!turns.some(turn=>turn.id===replyTo)){
    let priorQuery=client.from('items').select('id,title,content,source_text,turn_result,area').eq('id',replyTo).eq('type','capture').eq('status','processed');
    if(workspace==='work')priorQuery=priorQuery.eq('area','Work');
    const prior=await priorQuery.maybeSingle();
    if(prior.error)throw new Error('STORE');if(prior.data&&(workspace==='work'?prior.data.area==='Work':prior.data.area!=='Work'))turns.unshift(prior.data);
  }
  const related=turns.flatMap(turn=>[...(turn.turn_result?.created_ids??[]),...(turn.turn_result?.updated_ids??[]),turnFocus(turn.content)]).filter(Boolean);
  const ids=[...new Set([...(focusId?[focusId]:[]),...related])].filter(id=>!candidates.has(id)).slice(0,100);
  if(ids.length){
    let foundQuery=client.from('items').select(columns).in('id',ids).neq('type','capture');
    if(workspace==='work')foundQuery=foundQuery.eq('area','Work');else foundQuery=foundQuery.neq('area','Work');
    const found=await foundQuery;
    if(found.error)throw new Error('STORE');for(const item of (found.data??[]) as Item[])if(belongs(item,workspace))candidates.set(item.id,item);
  }
  const matchedEntities=entities.filter(entity=>[entity.canonical_name,...(entity.aliases??[])].some(alias=>mentions(text,alias)));
  const spokenWords=text.toLowerCase().match(/[\p{L}\p{N}-]{3,40}/gu)??[];
  const aliasWords=matchedEntities.flatMap(entity=>[entity.canonical_name,...(entity.aliases??[])]).flatMap(name=>normalizedPhrase(name).split(' '));
  const words=[...new Set([...spokenWords,...aliasWords])].filter(word=>word.length>=3&&!['the','and','that','this','with','have','done','tomorrow','today','please','task','time','work','bring','need','probably'].includes(word)).slice(0,16);
  if(words.length){
    let foundQuery=client.from('items').select(columns).neq('type','capture').or(words.flatMap(word=>['title.ilike.%'+word+'%','content.ilike.%'+word+'%']).join(','));
    if(workspace==='work')foundQuery=foundQuery.eq('area','Work');else foundQuery=foundQuery.neq('area','Work');
    const found=await foundQuery.order('updated_at',{ascending:false}).limit(100);
    if(found.error)throw new Error('STORE');for(const item of (found.data??[]) as Item[])if(belongs(item,workspace))candidates.set(item.id,item);
  }
  return {candidates,input:{utterance:text,workspace,focused_item_id:focusId??null,reply_to:replyTo??null,search_is_partial:true,
    entity_aliases:entities.map(entity=>({canonical_name:entity.canonical_name,aliases:entity.aliases??[],relationship:entity.relationship,entity_type:entity.entity_type})),
    recent_turns:turns.map(turn=>({id:turn.id,user:turn.source_text.slice(0,4000),focused_item_id:turnFocus(turn.content),assistant:turn.turn_result?.reply??'',related_item_ids:[...(turn.turn_result?.created_ids??[]),...(turn.turn_result?.updated_ids??[])]})),
    existing_items:[...candidates.values()].map(item=>({...item,content:item.content.slice(0,1200)}))}};
}
export function checkedChanges(plan:ReturnType<typeof organizedCapture.parse>,candidates:Map<string,Item>){
  if(plan.needs_clarification&&(plan.items.length||plan.updates.length))throw new Error('ORGANIZE');
  const seen=new Set<string>();
  for(const item of plan.items.flatMap(item=>[item,...item.subtasks]))if(item.due_at&&item.due_date)throw new Error('ORGANIZE');
  return plan.updates.map(change=>{
    const item=candidates.get(change.item_id);
    if(!item||seen.has(item.id)||change.due_at&&change.due_date)throw new Error('ORGANIZE');
    seen.add(item.id);
    if((change.status||change.change_due||change.change_dependency)&&!['task','reminder'].includes(item.type))throw new Error('ORGANIZE');
    if(!change.status&&!change.change_due&&!change.change_dependency&&change.title===null&&change.content===null&&change.area===null)throw new Error('ORGANIZE');
    if(change.status&&plan.updates.some(other=>other.item_id===item.parent_id&&other.status))throw new Error('ORGANIZE');
    if(change.change_dependency&&change.depends_on_id){
      const dependency=candidates.get(change.depends_on_id);
      if(!dependency||dependency.id===item.id||dependency.area==='Work'||dependency.parent_id||dependency.status!=='active'||!['task','reminder'].includes(dependency.type))throw new Error('ORGANIZE');
    }
    return {...change,expected_updated_at:item.updated_at};
  });
}
