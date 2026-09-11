import type {SupabaseClient} from '@supabase/supabase-js';
import {workPreview} from './work-preview-schema.ts';
import type {WorkCase} from './work-types.ts';

const caseColumns='id,case_number,title,status,workflow_state,ball_owner,ball_with,current_situation,next_action,follow_up_at,follow_up_date,closing_date,last_event_at,created_at,updated_at';
type MemoryEvent={id:string;case_id:string;kind:string;summary:string;source_text?:string;occurred_at:string};

export function groupCaseHistory(events:MemoryEvent[],limit=12){
  const grouped=new Map<string,MemoryEvent[]>();
  for(const event of events){
    const rows=grouped.get(event.case_id)??[];
    if(rows.length>=limit)continue;
    rows.push({...event,source_text:event.source_text?.slice(0,900)});
    grouped.set(event.case_id,rows);
  }
  return grouped;
}

export async function workMemoryContext(client:SupabaseClient,text:string,focusCaseId?:string){
  const candidates=new Map<string,WorkCase>();
  const recent=await client.from('work_cases').select(caseColumns).order('updated_at',{ascending:false}).limit(100);
  if(recent.error)throw new Error('STORE');
  for(const item of (recent.data??[]) as WorkCase[])candidates.set(item.id,item);

  const caseNumbers=[...new Set(text.toUpperCase().match(/G\d{2}-\d{4}/g)??[])];
  const priorityIds=new Set<string>();
  if(caseNumbers.length){
    const exact=await client.from('work_cases').select(caseColumns).in('case_number',caseNumbers).limit(30);
    if(exact.error)throw new Error('STORE');
    for(const item of (exact.data??[]) as WorkCase[]){candidates.set(item.id,item);priorityIds.add(item.id);}
  }
  if(focusCaseId){
    priorityIds.add(focusCaseId);
    if(!candidates.has(focusCaseId)){
      const focused=await client.from('work_cases').select(caseColumns).eq('id',focusCaseId).maybeSingle();
      if(focused.error)throw new Error('STORE');if(focused.data)candidates.set(focused.data.id,focused.data as WorkCase);
    }
  }

  const words=[...new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,40}/gu)??[])].filter(word=>!['the','and','that','this','with','have','from','what','where','when','work','file','case','today','tomorrow','please','reopen','reopened'].includes(word)).slice(0,6);
  if(words.length){
    const filters=words.flatMap(word=>['title.ilike.%'+word+'%','current_situation.ilike.%'+word+'%','next_action.ilike.%'+word+'%']);
    const found=await client.from('work_cases').select(caseColumns).or(filters.join(',')).order('updated_at',{ascending:false}).limit(60);
    if(found.error)throw new Error('STORE');for(const item of (found.data??[]) as WorkCase[])candidates.set(item.id,item as WorkCase);
  }

  const selected=[...candidates.values()].slice(0,120);
  const ids=selected.map(item=>item.id);
  let events:MemoryEvent[]=[];
  if(ids.length){
    const history=await client.from('work_events').select('id,case_id,kind,summary,source_text,occurred_at').in('case_id',ids).order('occurred_at',{ascending:false}).limit(500);
    if(history.error)throw new Error('STORE');events=(history.data??[]) as MemoryEvent[];
  }
  const grouped=groupCaseHistory(events,12);
  const priorityHistory=groupCaseHistory(events.filter(event=>priorityIds.has(event.case_id)),30);
  const turns=await client.from('items').select('id,source_text,turn_result,created_at').eq('type','capture').eq('area','Work').eq('status','processed').order('created_at',{ascending:false}).limit(8);
  if(turns.error)throw new Error('STORE');

  return {
    candidates:new Map(selected.map(item=>[item.id,item])),
    input:{
      utterance:text,
      focused_case_id:focusCaseId??null,
      explicit_case_numbers:caseNumbers,
      existing_cases:selected.map(item=>({...item,history:grouped.get(item.id)??[]})),
      priority_case_history:[...priorityIds].map(id=>({case_id:id,events:priorityHistory.get(id)??[]})),
      recent_turns:(turns.data??[]).map(turn=>({id:turn.id,user:turn.source_text.slice(0,3000),result:turn.turn_result})),
    },
  };
}

function normalizeProposalSemantics(proposal:ReturnType<typeof workPreview.parse>['proposals'][number]){
  if(proposal.status==='completed'){
    proposal.ball_owner='none';
    proposal.ball_with=null;
    return;
  }
  if(proposal.workflow_state==='waiting'){
    proposal.ball_owner='other';
    return;
  }
  if(proposal.workflow_state==='watching'){
    proposal.ball_owner='watching';
    proposal.ball_with=null;
    return;
  }
  proposal.ball_owner='me';
  proposal.ball_with=null;
}

export function validateWorkPreview(raw:unknown,candidates:Map<string,WorkCase>){
  const preview=workPreview.parse(raw);
  const seen=new Set<string>();
  for(const proposal of preview.proposals){
    normalizeProposalSemantics(proposal);
    if(proposal.case_id){
      const prior=candidates.get(proposal.case_id);
      if(!prior||seen.has(prior.id)||proposal.expected_updated_at!==prior.updated_at)throw new Error('ORGANIZE');
      seen.add(prior.id);
      if(proposal.case_number!==prior.case_number&&proposal.case_number&&[...candidates.values()].some(item=>item.id!==prior.id&&item.case_number===proposal.case_number))throw new Error('ORGANIZE');
    }else{
      if(proposal.expected_updated_at!==null)throw new Error('ORGANIZE');
      if(proposal.case_number&&[...candidates.values()].some(item=>item.case_number===proposal.case_number))throw new Error('ORGANIZE');
    }
  }
  return preview;
}
