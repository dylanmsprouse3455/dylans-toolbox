import type {SupabaseClient} from '@supabase/supabase-js';
import {workPreview} from './work-preview-schema.ts';
import {normalizeWorkEntity,workIntentHint} from './work-context.ts';
import type {WorkCase,WorkCaseFact,WorkCasePhase} from './work-types.ts';

const caseColumns='id,user_id,case_number,title,status,workflow_state,ball_owner,ball_with,current_situation,next_action,memory_summary,current_phase_id,follow_up_at,follow_up_date,follow_up_condition,follow_up_resolved_at,closing_date,last_event_at,created_at,updated_at';
type MemoryEvent={id:string;case_id:string;kind:string;summary:string;source_text?:string;match_confidence?:string|null;match_reason?:string|null;occurred_at:string};
type CaptureHit={id:string;source_text:string;content:string;turn_result:unknown;created_at:string};

export function workSearchTerms(text:string){
  const stop=new Set(['the','and','that','this','with','have','from','what','where','when','work','file','case','today','tomorrow','please','reopen','reopened','old','road','rd','street','st','drive','dr','highway','hwy','need','needs','get','got','for']);
  return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,40}/gu)??[])].filter(word=>!stop.has(word)).slice(0,10);
}

export function groupCaseHistory(events:MemoryEvent[],limit=12){
  const grouped=new Map<string,MemoryEvent[]>();
  for(const event of events){
    const rows=grouped.get(event.case_id)??[];
    if(rows.length>=limit)continue;
    rows.push({...event,source_text:event.source_text?.slice(0,1200)});
    grouped.set(event.case_id,rows);
  }
  return grouped;
}

function compactTurnResult(value:unknown){
  if(!value||typeof value!=='object')return null;
  const row=value as Record<string,unknown>;
  if(row.kind==='work_commit')return {kind:row.kind,case_ids:Array.isArray(row.case_ids)?row.case_ids:[],reply:row.reply};
  if(row.kind==='work_answer')return {kind:row.kind,answer:row.answer,answer_status:row.answer_status};
  if(row.kind==='work_preview'){
    const preview=row.preview as {proposals?:Array<Record<string,unknown>>}|undefined;
    return {kind:row.kind,proposals:(preview?.proposals??[]).map(p=>({case_id:p.case_id,case_number:p.case_number,title:p.title,status:p.status,current_situation:p.current_situation,next_action:p.next_action,match_reason:p.match_reason}))};
  }
  return {kind:row.kind??null};
}

function committedCaseIds(row:CaptureHit){
  const result=row.turn_result as {kind?:string;case_ids?:unknown[]}|null;
  return result?.kind==='work_commit'&&Array.isArray(result.case_ids)?result.case_ids.filter((id):id is string=>typeof id==='string'):[];
}

async function addCases(client:SupabaseClient,candidates:Map<string,WorkCase>,ids:string[]){
  const missing=[...new Set(ids)].filter(id=>!candidates.has(id));
  if(!missing.length)return;
  const rows=await client.from('work_cases').select(caseColumns).in('id',missing).limit(100);
  if(rows.error)throw new Error('STORE');
  for(const item of (rows.data??[]) as WorkCase[])candidates.set(item.id,item);
}

export async function workMemoryContext(client:SupabaseClient,text:string,focusCaseId?:string){
  const candidates=new Map<string,WorkCase>();
  const priorityIds=new Set<string>();
  const recent=await client.from('work_cases').select(caseColumns).order('updated_at',{ascending:false}).limit(120);
  if(recent.error)throw new Error('STORE');
  for(const item of (recent.data??[]) as WorkCase[])candidates.set(item.id,item);

  const caseNumbers=[...new Set(text.toUpperCase().match(/G\d{2}-\d{4}/g)??[])];
  if(caseNumbers.length){
    const exact=await client.from('work_cases').select(caseColumns).in('case_number',caseNumbers).limit(30);
    if(exact.error)throw new Error('STORE');
    for(const item of (exact.data??[]) as WorkCase[]){candidates.set(item.id,item);priorityIds.add(item.id);}
  }
  if(focusCaseId){priorityIds.add(focusCaseId);await addCases(client,candidates,[focusCaseId]);}

  const words=workSearchTerms(text);
  const captureEvidence=await client.from('work_capture_evidence').select('capture_id,version_id,version,raw_transcript,raw_origin,organized,correction,captured_at,time_zone,truth_status,confirmed_changes,confirmed_at,turn_result')
    .textSearch('search_document',words.length?words.join(' | '):'__no_search__',{config:'simple'}).order('created_at',{ascending:false}).limit(30);
  if(captureEvidence.error)throw new Error('STORE');
  const organizedHits=captureEvidence.data??[];
  for(const hit of organizedHits){
    const linked=(hit.turn_result as {case_ids?:string[]}|null)?.case_ids??[];
    for(const id of linked)priorityIds.add(id);
    await addCases(client,candidates,linked);
  }
  if(words.length){
    const caseFilters=words.flatMap(word=>['title.ilike.%'+word+'%','current_situation.ilike.%'+word+'%','next_action.ilike.%'+word+'%','ball_with.ilike.%'+word+'%','memory_summary.ilike.%'+word+'%']);
    const found=await client.from('work_cases').select(caseColumns).or(caseFilters.join(',')).order('updated_at',{ascending:false}).limit(100);
    if(found.error)throw new Error('STORE');
    for(const item of (found.data??[]) as WorkCase[])candidates.set(item.id,item);
  }

  let matchedFacts:WorkCaseFact[]=[];
  let matchedPhases:WorkCasePhase[]=[];
  if(words.length){
    const found=await client.from('work_case_phases').select('*').or(words.flatMap(word=>['title.ilike.%'+word+'%','summary.ilike.%'+word+'%']).join(',')).order('updated_at',{ascending:false}).limit(80);
    if(found.error)throw new Error('STORE');
    matchedPhases=(found.data??[]) as WorkCasePhase[];
    for(const phase of matchedPhases)priorityIds.add(phase.case_id);
    await addCases(client,candidates,matchedPhases.map(phase=>phase.case_id));
  }
  if(words.length){
    const filters=words.flatMap(word=>['fact_value.ilike.%'+word+'%','aliases_text.ilike.%'+word+'%','normalized_value.ilike.%'+normalizeWorkEntity(word)+'%']);
    const facts=await client.from('work_case_facts').select('*').or(filters.join(',')).order('active',{ascending:false}).order('updated_at',{ascending:false}).limit(120);
    if(facts.error)throw new Error('STORE');
    matchedFacts=(facts.data??[]) as WorkCaseFact[];
    for(const fact of matchedFacts)priorityIds.add(fact.case_id);
    await addCases(client,candidates,matchedFacts.map(fact=>fact.case_id));
  }

  let matchedEvents:MemoryEvent[]=[];
  if(words.length){
    const eventFilters=words.flatMap(word=>['summary.ilike.%'+word+'%','source_text.ilike.%'+word+'%','match_reason.ilike.%'+word+'%']);
    const historyHits=await client.from('work_events').select('id,case_id,kind,summary,source_text,match_confidence,match_reason,occurred_at').or(eventFilters.join(',')).order('occurred_at',{ascending:false}).limit(140);
    if(historyHits.error)throw new Error('STORE');
    matchedEvents=(historyHits.data??[]) as MemoryEvent[];
    for(const event of matchedEvents)priorityIds.add(event.case_id);
    await addCases(client,candidates,matchedEvents.map(event=>event.case_id));
  }

  let captureHits:CaptureHit[]=[];
  if(words.length){
    const captureFilters=words.map(word=>'source_text.ilike.%'+word+'%');
    const hits=await client.from('items').select('id,source_text,content,turn_result,created_at').eq('type','capture').eq('area','Work').or(captureFilters.join(',')).order('created_at',{ascending:false}).limit(40);
    if(hits.error)throw new Error('STORE');
    captureHits=(hits.data??[]) as CaptureHit[];
    const linked=[...new Set(captureHits.flatMap(committedCaseIds))];
    for(const id of linked)priorityIds.add(id);
    await addCases(client,candidates,linked);
  }

  const selected=[...candidates.values()].sort((a,b)=>Number(priorityIds.has(b.id))-Number(priorityIds.has(a.id))||Date.parse(b.updated_at)-Date.parse(a.updated_at)).slice(0,160);
  const ids=selected.map(item=>item.id);
  let events:MemoryEvent[]=[],facts:WorkCaseFact[]=[],phases:WorkCasePhase[]=[];
  if(ids.length){
    const [history,factRows,phaseRows]=await Promise.all([
      client.from('work_events').select('id,case_id,kind,summary,source_text,match_confidence,match_reason,occurred_at').in('case_id',ids).order('occurred_at',{ascending:false}).limit(900),
      client.from('work_case_facts').select('*').in('case_id',ids).eq('active',true).order('updated_at',{ascending:false}).limit(500),
      client.from('work_case_phases').select('*').in('case_id',ids).order('phase_number',{ascending:false}).limit(500),
    ]);
    if(history.error||factRows.error||phaseRows.error)throw new Error('STORE');
    events=(history.data??[]) as MemoryEvent[];facts=(factRows.data??[]) as WorkCaseFact[];phases=(phaseRows.data??[]) as WorkCasePhase[];
  }
  const grouped=groupCaseHistory(events,14);
  const priorityHistory=groupCaseHistory(events.filter(event=>priorityIds.has(event.case_id)),40);
  const factsByCase=new Map<string,WorkCaseFact[]>(),phasesByCase=new Map<string,WorkCasePhase[]>();
  for(const fact of facts)factsByCase.set(fact.case_id,[...(factsByCase.get(fact.case_id)??[]),fact]);
  for(const phase of phases)phasesByCase.set(phase.case_id,[...(phasesByCase.get(phase.case_id)??[]),phase]);

  const turns=await client.from('items').select('id,source_text,turn_result,created_at').eq('type','capture').eq('area','Work').eq('status','processed').order('created_at',{ascending:false}).limit(10);
  if(turns.error)throw new Error('STORE');

  return {
    candidates:new Map(selected.map(item=>[item.id,item])),
    knownEvents:new Map([...events,...matchedEvents].map(event=>[event.id,event])),
    knownFacts:facts,
    input:{
      utterance:text,
      intent_hint:workIntentHint(text),
      focused_case_id:focusCaseId??null,
      explicit_case_numbers:caseNumbers,
      search_terms:words,
      existing_cases:selected.map(item=>({...item,source_type:'current_case_state',truth_status:'current',history:(grouped.get(item.id)??[]).map(event=>({...event,source_type:'timeline_event',truth_status:'historical'})),facts:(factsByCase.get(item.id)??[]).map(fact=>({...fact,source_type:'permanent_fact',truth_status:fact.active?'current':'superseded'})),phases:(phasesByCase.get(item.id)??[]).map(phase=>({...phase,source_type:'phase',truth_status:phase.id===item.current_phase_id&&phase.status==='active'?'current':'historical'}))})),
      matched_facts:matchedFacts.slice(0,50).map(fact=>({...fact,source_type:'permanent_fact',truth_status:fact.active?'current':'superseded'})),
      matched_phases:matchedPhases.map(phase=>({...phase,source_type:'phase',truth_status:phase.status==='active'&&candidates.get(phase.case_id)?.current_phase_id===phase.id?'current':'historical'})),
      matched_history:matchedEvents.slice(0,50).map(event=>({...event,source_type:'timeline_event',truth_status:'historical'})),
      matched_organized_captures:organizedHits.map(hit=>({...hit,source_type:'organized_capture',case_truth_confirmed:false})),
      matched_prior_captures:captureHits.map(row=>({id:row.id,source_type:'raw_transcript',truth_status:'historical',user:row.source_text.slice(0,3000),result:compactTurnResult(row.turn_result),created_at:row.created_at})),
      priority_case_history:[...priorityIds].map(id=>({case_id:id,events:priorityHistory.get(id)??[]})),
      recent_turns:(turns.data??[]).map(turn=>({id:turn.id,user:turn.source_text.slice(0,3000),result:compactTurnResult(turn.turn_result)})),
    },
  };
}

function normalizeProposalSemantics(proposal:ReturnType<typeof workPreview.parse>['proposals'][number]){
  if(proposal.status==='completed'){proposal.ball_owner='none';proposal.ball_with=null;proposal.follow_up_at=null;proposal.follow_up_date=null;proposal.follow_up_condition=null;return;}
  if(proposal.workflow_state==='waiting'){proposal.ball_owner='other';return;}
  if(proposal.workflow_state==='watching'){proposal.ball_owner='watching';proposal.ball_with=null;return;}
  proposal.ball_owner='me';proposal.ball_with=null;
}

export function validateWorkPreview(raw:unknown,candidates:Map<string,WorkCase>,knownEvents:Map<string,MemoryEvent>=new Map(),knownFacts:WorkCaseFact[]=[]){
  const preview=workPreview.parse(raw),seen=new Set<string>();
  for(const proposal of preview.proposals){
    if(proposal.duplicate_event_id&&knownEvents.get(proposal.duplicate_event_id)?.case_id!==proposal.case_id)throw new Error('ORGANIZE');
    normalizeProposalSemantics(proposal);
    proposal.fact_changes=proposal.fact_changes.filter((fact,index,all)=>all.findIndex(other=>other.action===fact.action&&other.key===fact.key&&normalizeWorkEntity(other.value)===normalizeWorkEntity(fact.value))===index);
    proposal.fact_changes=proposal.fact_changes.filter(change=>{
      if(change.action!=='upsert')return true;
      const prior=knownFacts.find(fact=>fact.active&&fact.case_id===proposal.case_id&&normalizeWorkEntity(fact.fact_key)===normalizeWorkEntity(change.key)&&[fact.fact_value,...fact.aliases_text.split(' | ')].some(value=>normalizeWorkEntity(value)===normalizeWorkEntity(change.value)));
      if(!prior)return true;
      const priorAliases=prior.aliases_text.split(' | ').filter(Boolean);
      const novel=change.aliases.filter(alias=>![prior.fact_value,...priorAliases].some(value=>normalizeWorkEntity(value)===normalizeWorkEntity(alias)));
      if(!novel.length)return false;
      change.key=prior.fact_key;change.value=prior.fact_value;change.aliases=[...new Set([...priorAliases,...novel])].slice(0,12);return true;
    });
    if(proposal.case_id){
      const prior=candidates.get(proposal.case_id);
      if(!prior||seen.has(prior.id)||proposal.expected_updated_at!==prior.updated_at)throw new Error('ORGANIZE');
      seen.add(prior.id);
      if(proposal.case_number!==prior.case_number&&proposal.case_number&&[...candidates.values()].some(item=>item.id!==prior.id&&item.case_number===proposal.case_number))throw new Error('ORGANIZE');
      if(!proposal.memory_summary.trim())proposal.memory_summary=prior.memory_summary||prior.current_situation;
    }else{
      if(proposal.expected_updated_at!==null)throw new Error('ORGANIZE');
      if(proposal.case_number&&[...candidates.values()].some(item=>item.case_number===proposal.case_number))throw new Error('ORGANIZE');
    }
  }
  // Paraphrased descriptions of an existing event must not rewrite its current state.
  // A genuinely new occurrence has duplicate_event_id=null and retains normal behavior.
  preview.proposals=preview.proposals.filter(proposal=>{
    const prior=proposal.case_id?candidates.get(proposal.case_id):null;
    if(!proposal.duplicate_event_id||!prior||proposal.fact_changes.length)return true;
    return (['status','workflow_state','ball_owner','ball_with','follow_up_at','follow_up_date','follow_up_condition','closing_date'] as const).some(key=>proposal[key]!==prior[key]);
  });
  if(preview.kind==='changes'&&!preview.proposals.length)return {...preview,kind:'answer' as const,answer:'That information is already recorded. I kept this capture without adding duplicate case changes.',answer_status:'found' as const,commit_reply:'',proposals:[] as []};
  return preview;
}
