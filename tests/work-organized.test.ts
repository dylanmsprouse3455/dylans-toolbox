import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {validateOrganizedCapture,relativeCaptureDate,captureSearchText,workTruthInstructions,type CaptureBundle,type OrganizedCapture} from '../lib/work-organized.ts';
import {savePendingWorkText,pendingWorkText,removePendingWorkText} from '../lib/work-local.ts';
import {handleWorkCapture} from '../lib/work-capture-handler.ts';

const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const raw='  G 26 0441: Mike needs the papers tomorrow.\nAlso, the copier is making a clicking noise.  ';
const rootId='33333333-3333-4333-8333-333333333333';
function organized(text=raw):OrganizedCapture{return {summary:text,entries:[{kind:'note',text,case_numbers:[],people:[],property:null,truth_status:'current',source:'raw_transcript',source_version:1,source_excerpt:text,date_wording:null,resolved_date:null,resolved_at:null}]};}
function bundle():CaptureBundle{return {capture:{id:rootId,user_id:owner,raw_transcript:raw,raw_origin:'original',captured_at:'2026-09-12T02:00:00Z',time_zone:'America/New_York',focus_case_id:null,current_version:1,created_at:'2026-09-12T02:00:00Z'},versions:[]};}
const answer={kind:'answer',headline:'Saved note',answer:'Saved this unlinked Work note.',answer_status:'capture_only',commit_reply:'',proposals:[],rule_suggestions:[]};

async function setup(){
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${owner}'),('${other}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated;`);
  for(const path of ['schema.sql','conversation.sql','owner-access.sql','work-cases.sql','work-event-indexes.sql','work-quick-complete.sql','work-memory-v2-prereq.sql','work-memory-v2.sql','work-memory-v2-indexes.sql','work-memory-v2-hardening.sql'])await db.exec(await readFile(new URL('../supabase/'+path,import.meta.url),'utf8'));
  await db.exec(`insert into toolbox_private.owner(user_id) values('${owner}');`);
  return db;
}
async function start(db:PGlite,id=rootId,text=raw){await db.query('select toolbox_start_work_capture($1,$2,$3,$4,null)',[id,text,'2026-09-12T02:00:00Z','America/New_York']);}
async function current(db:PGlite,id=rootId){return (await db.query<Record<string,any>>('select * from work_capture_evidence where capture_id=$1 order by version desc',[id])).rows[0];}

// Real PostgreSQL behind a small fetch adapter exercises the deployed handler's request order and retry behavior.
function provider(db:PGlite,ai:(body:Record<string,any>)=>Response,audio:()=>Response){return async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(input instanceof Request?input.url:String(input)),method=init?.method??(input instanceof Request?input.method:'GET');
  if(url.pathname==='/auth/v1/user')return Response.json({id:owner});
  if(url.pathname.endsWith('/audio/transcriptions'))return audio();
  if(url.pathname==='/v1/responses')return ai(JSON.parse(String(init?.body)));
  if(url.pathname.startsWith('/rest/v1/rpc/')){
    const name=url.pathname.split('/').at(-1)!,args=JSON.parse(String(init?.body??'{}')),keys=Object.keys(args);
    try{const result=await db.query(`select public.${name}(${keys.map((key,i)=>`${key}:=$${i+1}`).join(',')}) as result`,keys.map(key=>args[key]!==null&&typeof args[key]==='object'?JSON.stringify(args[key]):args[key]));return Response.json((result.rows[0] as {result:unknown}).result);}
    catch(e){return Response.json({message:e instanceof Error?e.message:'SQL failed',code:'P0001'},{status:400});}
  }
  if(!url.pathname.startsWith('/rest/v1/'))throw new Error('Unexpected external request: '+url.pathname);
  const table=url.pathname.split('/').at(-1)!;
  const params:unknown[]=[],where:string[]=[];
  for(const [key,value] of url.searchParams){
    if(['select','order','limit','or'].includes(key))continue;
    const index=params.length+1;
    if(value.startsWith('eq.')){where.push(`${key}=$${index}`);params.push(value.slice(3));}
    else if(value.startsWith('gte.')){where.push(`${key}>=$${index}`);params.push(value.slice(4));}
    else if(value.startsWith('in.')){const vals=value.slice(4,-1).split(',');where.push(`${key} in (${vals.map((_,i)=>'$'+(index+i)).join(',')})`);params.push(...vals);}
    else if(value.startsWith('fts')){where.push(`${key}@@to_tsquery('simple',$${index})`);params.push(value.slice(value.indexOf('.')+1));}
  }
  if(url.searchParams.has('or')){
    const ors=url.searchParams.get('or')!.slice(1,-1).split(',').map(filter=>{const [key,operator,...rest]=filter.split('.');assert.equal(operator,'ilike');params.push(rest.join('.'));return `${key} ilike $${params.length}`;});where.push('('+ors.join(' or ')+')');
  }
  const predicate=where.length?' where '+where.join(' and '):'';
  try{
    if(method==='PATCH'){
      const values=JSON.parse(String(init?.body)),keys=Object.keys(values),args=keys.map(k=>typeof values[k]==='object'?JSON.stringify(values[k]):values[k]);
      const updated=await db.query(`update ${table} set ${keys.map((key,i)=>`${key}=$${params.length+i+1}`).join(',')}${predicate} returning *`,[...params,...args]);return Response.json(updated.rows);
    }
    const count=await db.query<{count:number}>(`select count(*)::int as count from ${table}${predicate}`,params);
    if(method==='HEAD')return new Response(null,{headers:{'content-range':`0-0/${count.rows[0].count}`}});
    const columns=url.searchParams.get('select')||'*';
    const order=url.searchParams.get('order')?.split(',').map(x=>x.split('.').join(' ')).join(',');
    const result=await db.query(`select ${columns} from ${table}${predicate}${order?' order by '+order:''}${url.searchParams.get('limit')?' limit '+Number(url.searchParams.get('limit')):''}`,params);
    const accept=new Headers(init?.headers??(input instanceof Request?input.headers:undefined)).get('accept')||'';
    return Response.json(accept.includes('vnd.pgrst.object')?(result.rows[0]??null):result.rows);
  }catch(e){return Response.json({message:e instanceof Error?e.message:'SQL failed'},{status:400});}
};}
const aiResult=(value:unknown)=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]});
async function request(fields:Record<string,string|Blob>,config:Record<string,string>={OPENAI_API_KEY:'test'}){
  const form=new FormData();for(const [key,value] of Object.entries(fields))if((key==='text'||key==='correction')&&typeof value==='string')form.set(key+'_json',JSON.stringify(value));else form.set(key,value);
  return handleWorkCapture(new Request('https://example.com',{method:'POST',headers:{Authorization:'Bearer test'},body:form}),{SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'test',...config});
}

 test('organized capture keeps exact citations, unlinked notes, correction sources, and anchored relative wording',()=>{
  const b=bundle(),value=organized();value.entries[0].date_wording='tomorrow';value.entries[0].resolved_date='2099-01-01';
  const result=validateOrganizedCapture(value,b);
  assert.equal(result.entries[0].resolved_date,'2026-09-12');assert.equal(result.entries[0].date_wording,'tomorrow');
  assert.equal(b.capture.raw_transcript,raw);assert.deepEqual(result.entries[0].case_numbers,[]);assert.match(captureSearchText(result),/copier/);
  assert.equal(relativeCaptureDate('Monday',b.capture.captured_at,b.capture.time_zone),'2026-09-14');
  assert.equal(relativeCaptureDate('tomorrow','2026-03-08T04:30:00Z','America/New_York'),'2026-03-08');
  assert.throws(()=>validateOrganizedCapture({...value,entries:[{...value.entries[0],source_excerpt:'invented quote'}]},b));
  assert.match(workTruthInstructions,/Prefer current confirmed/);assert.match(workTruthInstructions,/superseded\/historical\/uncertain/);
 });

 test('Work recovery queue is owner-separated, immutable and contains text only',async()=>{
  const record={id:rootId,user_id:owner,text:raw,captured_at:'2026-09-12T02:00:00Z',time_zone:'America/New_York',focus_case_id:null};
  await savePendingWorkText({...record,audio:new Blob(['secret recording'])} as typeof record);
  assert.equal((await pendingWorkText(owner))[0].text,raw);assert.equal('audio' in (await pendingWorkText(owner))[0],false);
  assert.deepEqual(await pendingWorkText(other),[]);
  await assert.rejects(savePendingWorkText({...record,text:'replacement'}));
  await removePendingWorkText(rootId,other);assert.equal((await pendingWorkText(owner)).length,1);
  await removePendingWorkText(rootId,owner);assert.equal((await pendingWorkText(owner)).length,0);
 });

 test('SQL preserves legacy data, source evidence, versions, confirmation boundaries, and owner-only RLS',async()=>{
  const db=await setup();
  try{
    await db.exec(`insert into items(id,user_id,type,title,area,status,source_text) values('${rootId}','${owner}','capture','Existing','Work','processed','Legacy normalized words');`);
    await db.exec(await readFile(new URL('../supabase/work-organized-captures.sql',import.meta.url),'utf8'));
    assert.equal((await current(db)).raw_transcript,'Legacy normalized words');assert.equal((await current(db)).raw_origin,'legacy_snapshot');
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${owner}';`);
    const id=crypto.randomUUID();await start(db,id);await start(db,id,'attempted replacement');
    const first=await current(db,id);assert.equal(first.raw_transcript,raw);
    await assert.rejects(db.query('update work_captures set raw_transcript=$1 where id=$2',['edited',id]),/immutable/);
    await assert.rejects(db.query('update items set source_text=$1 where id=$2',['edited',id]),/immutable/);
    await db.query('select toolbox_store_work_capture_version($1,$2,$3)',[first.version_id,JSON.stringify(organized()),captureSearchText(organized())]);
    await assert.rejects(db.query('update work_capture_versions set organized=$1 where id=$2',[JSON.stringify(organized('different')),first.version_id]),/immutable/);
    const correctionId=crypto.randomUUID();await db.query('select toolbox_revise_work_capture($1,$2,$3)',[id,'It was Sarah, not Mike.',correctionId]);
    const corrected=await current(db,id);assert.equal(corrected.version,2);assert.equal(corrected.raw_transcript,raw);assert.equal(corrected.correction,'It was Sarah, not Mike.');
    assert.equal((await db.query('select * from work_cases')).rows.length,0,'Correction alone never changes cases');
    assert.equal((await db.query<{truth_status:string}>('select truth_status from work_capture_evidence where version_id=$1',[first.version_id])).rows[0].truth_status,'superseded');
    await assert.rejects(db.query('select toolbox_store_work_capture_version($1,$2,$3)',[first.version_id,null,null]),/CAPTURE_CHANGED/);
    await db.query('select toolbox_revise_work_capture($1,$2,$3)',[id,'It was Sarah, not Mike.',correctionId]);assert.equal((await current(db,id)).version,2,'Lost correction response reuses its revision ID');
    await db.exec(`set request.jwt.claim.sub='${other}';`);
    for(const table of ['work_captures','work_capture_versions','work_capture_evidence'])assert.equal((await db.query(`select * from ${table}`)).rows.length,0);
    await assert.rejects(start(db,crypto.randomUUID()),/Owner access/);
    await db.exec('reset role;set role anon;');await assert.rejects(db.query('select * from work_capture_evidence'),/permission denied/);
  }finally{await db.close();}
 });

 test('handler saves transcription before AI, retries the same capture without audio, and reuses durable organization after reasoning failure',async()=>{
  const db=await setup(),original=globalThis.fetch;let audioCalls=0,organizationCalls=0,reasoningCalls=0,failOrganization=true,failReasoning=true;
  try{
    await db.exec(await readFile(new URL('../supabase/work-organized-captures.sql',import.meta.url),'utf8'));
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${owner}';`);
    globalThis.fetch=provider(db,body=>{
      if(body.text.format.name==='organized_work_capture'){organizationCalls++;return failOrganization?Response.json({error:'unavailable'},{status:503}):aiResult(organized());}
      reasoningCalls++;return failReasoning?Response.json({error:'unavailable'},{status:503}):aiResult(answer);
    },()=>{audioCalls++;return Response.json({text:raw});});
    const fields={mode:'preview',id:rootId,captured_at:'2026-09-12T02:00:00Z',time_zone:'America/New_York',audio:new Blob(['temporary'],{type:'audio/webm'})};
    const failed=await request(fields);assert.equal(failed.status,503);assert.equal(((await failed.json()) as {transcript:string}).transcript,raw);assert.equal((await current(db)).raw_transcript,raw);assert.equal(audioCalls,1);
    failOrganization=false;
    const reasonFailed=await request({mode:'retry',id:rootId});assert.equal(reasonFailed.status,503);assert.ok((await current(db)).organized);assert.equal((await current(db)).error_stage,'reasoning');
    failReasoning=false;
    const success=await request({mode:'retry',id:rootId});assert.equal(success.status,200);assert.equal(((await success.json()) as {kind:string}).kind,'work_answer');
    assert.equal(audioCalls,1);assert.equal(organizationCalls,2);assert.equal(reasoningCalls,2);assert.equal((await db.query('select * from work_captures')).rows.length,1);assert.equal((await db.query('select * from work_cases')).rows.length,0);
    const retry=await request({mode:'retry',id:rootId});assert.equal(retry.status,200);assert.equal(organizationCalls,2);assert.equal(reasoningCalls,2);
    const all=await db.query("select column_name,data_type from information_schema.columns where table_name in ('work_captures','work_capture_versions')");
    assert.equal(all.rows.some((r:any)=>/audio|blob|bytea/.test(r.column_name+' '+r.data_type)),false);
    const id=crypto.randomUUID();const savedWithoutAI=await request({mode:'transcribe',id,captured_at:'2026-09-12T02:00:00Z',time_zone:'America/New_York',text:raw},{});assert.equal(savedWithoutAI.status,200);assert.equal((await current(db,id)).raw_transcript,raw);
  }finally{globalThis.fetch=original;await db.close();}
 });

 test('confirmed corrections preserve case memory until approval, bind provenance, and never duplicate events or facts',async()=>{
  const db=await setup();
  try{
    await db.exec(await readFile(new URL('../supabase/work-organized-captures.sql',import.meta.url),'utf8'));
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${owner}';`);await start(db);
    const first=await current(db);
    const proposal={case_id:null as string|null,expected_updated_at:null as string|null,case_number:'G26-0441',title:'Papers for Mike',status:'active',workflow_state:'waiting',ball_owner:'other',ball_with:'Mike',current_situation:'Waiting for papers.',next_action:'Follow up tomorrow if missing.',memory_summary:'Papers requested from Mike.',follow_up_at:null,follow_up_date:'2026-09-12',follow_up_condition:'if papers are missing',closing_date:null,event_kind:'request',event_summary:'Requested papers from Mike.',evidence_excerpt:'Mike needs the papers tomorrow.',match_confidence:'high',match_reason:'Exact case number.',fact_changes:[{action:'upsert',key:'contact',value:'Mike',aliases:[],confidence:'high'}],confirmation_question:'Save this update?',duplicate_event_id:null as string|null};
    const preview=(p=proposal)=>({kind:'work_preview',preview:{kind:'changes',headline:'One update',answer:null,answer_status:null,commit_reply:'Saved.',proposals:[p],rule_suggestions:[]}});
    await db.query('select toolbox_store_work_capture_version($1,$2,$3,$4)',[first.version_id,JSON.stringify(organized()),captureSearchText(organized()),JSON.stringify(preview())]);
    assert.equal((await db.query('select * from work_cases')).rows.length,0,'Organization and reasoning never apply proposals');
    await assert.rejects(db.query('select toolbox_confirm_work_capture($1,$2)',[rootId,2]),/CAPTURE_CHANGED/);
    await db.query('select toolbox_confirm_work_capture($1,$2)',[rootId,1]);
    await db.query('select toolbox_confirm_work_capture($1,$2)',[rootId,1]);
    const caseBefore=(await db.query<{data:Record<string,any>}>('select to_jsonb(c) as data from work_cases c')).rows[0].data;
    const event=(await db.query<Record<string,any>>('select * from work_events')).rows[0];
    assert.equal(caseBefore.ball_with,'Mike');assert.equal((await db.query('select * from work_events')).rows.length,1);
    for(const table of ['work_cases','work_case_phases','work_case_facts','work_events'])assert.equal((await db.query<{source_capture_version_id:string}>(`select source_capture_version_id from ${table}`)).rows[0].source_capture_version_id,first.version_id);
    const revisionId=crypto.randomUUID();await db.query('select toolbox_revise_work_capture($1,$2,$3)',[rootId,'  Sarah, not Mike.\nKeep the same date.  ',revisionId]);
    const corrected=await current(db);assert.equal(corrected.correction,'  Sarah, not Mike.\nKeep the same date.  ');
    const correctedInterpretation=organized();correctedInterpretation.entries.push({...correctedInterpretation.entries[0],text:'Sarah needs the papers.',source:'correction',source_version:2,source_excerpt:'Sarah, not Mike.'});
    const changed={...proposal,case_id:caseBefore.id,expected_updated_at:caseBefore.updated_at,ball_with:'Sarah',current_situation:'Waiting for papers from Sarah.',event_summary:'Corrected the contact to Sarah.',event_kind:'note',fact_changes:[{action:'remove',key:'contact',value:'Mike',aliases:[],confidence:'high'},{action:'upsert',key:'contact',value:'Sarah',aliases:[],confidence:'high'}]};
    await db.query('select toolbox_store_work_capture_version($1,$2,$3,$4)',[corrected.version_id,JSON.stringify(correctedInterpretation),captureSearchText(correctedInterpretation),JSON.stringify(preview(changed))]);
    assert.equal((await db.query<{ball_with:string}>('select ball_with from work_cases')).rows[0].ball_with,'Mike','Even a reasoned correction cannot change saved memory without confirmation');
    await db.query('select toolbox_confirm_work_capture($1,$2)',[revisionId,1]);
    assert.equal((await db.query<{ball_with:string}>('select ball_with from work_cases')).rows[0].ball_with,'Sarah');
    assert.equal((await db.query<{active:boolean}>("select active from work_case_facts where fact_value='Mike'")).rows[0].active,false);
    assert.equal((await current(db)).raw_transcript,raw);
    // Repeat/paraphrase of the same real event: the database reuses its event and fact.
    const repeat=crypto.randomUUID();await start(db,repeat,'I had already asked Sarah for the paperwork.');
    const repeatVersion=await current(db,repeat),currentCase=(await db.query<{data:Record<string,any>}>('select to_jsonb(c) as data from work_cases c')).rows[0].data;
    const repeated={...changed,expected_updated_at:currentCase.updated_at,event_kind:'request',event_summary:'Asked for the paperwork.',duplicate_event_id:event.id,fact_changes:[{action:'upsert',key:'contact',value:'Sarah',aliases:[],confidence:'high'}]};
    const repeatOrg=organized('I had already asked Sarah for the paperwork.');
    await db.query('select toolbox_store_work_capture_version($1,$2,$3,$4)',[repeatVersion.version_id,JSON.stringify(repeatOrg),captureSearchText(repeatOrg),JSON.stringify(preview(repeated))]);
    await db.query('select toolbox_confirm_work_capture($1,$2)',[repeat,1]);
    assert.equal((await db.query('select * from work_events')).rows.length,2,'A paraphrased reference to an existing event creates no duplicate event');
    assert.equal((await db.query("select * from work_case_facts where active and fact_value='Sarah'")).rows.length,1);
    assert.equal((await db.query<{follow_up_date:string}>('select follow_up_date::text from work_cases')).rows[0].follow_up_date,'2026-09-12');
    assert.match(JSON.stringify((await current(db,rootId)).organized),/copier/,'Unlinked note remains after case confirmation');
    const stale=crypto.randomUUID();await start(db,stale,'Another pending capture.');const staleVersion=await current(db,stale);
    await db.query('select toolbox_store_work_capture_version($1,$2,$3,$4)',[staleVersion.version_id,JSON.stringify(organized('Another pending capture.')),'pending',JSON.stringify(preview(changed))]);
    await assert.rejects(db.query('select toolbox_confirm_work_capture($1,$2)',[stale,1]),/CASE_CHANGED/);
    assert.equal((await db.query<{ball_with:string}>('select ball_with from work_cases')).rows[0].ball_with,'Sarah');
  }finally{await db.close();}
 });
