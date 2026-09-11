import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {normalizeWorkCaseNumbers,workIntentHint} from './work-context.ts';
import {workMemoryContext,validateWorkPreview} from './work-memory.ts';
import {workPreviewInstructions,workPreviewOutputSchema} from './work-preview-schema.ts';
import type {WorkPreview,WorkRuleSuggestion} from './work-types.ts';
import {organizedInstructions,organizedOutputSchema,validateOrganizedCapture,captureSearchText,workTruthInstructions,type CaptureBundle,type OrganizedVersion,type WorkCapture} from './work-organized.ts';

export type WorkCaptureConfig={SUPABASE_URL?:string;SUPABASE_ANON_KEY?:string;OPENAI_API_KEY?:string;OPENAI_MODEL?:string};
const previewMeta=z.object({id:z.string().uuid(),captured_at:z.string().datetime({offset:true}),time_zone:z.string().min(1).max(100),focus_case_id:z.string().uuid().optional()});
const draftMeta=z.object({id:z.string().uuid()});
const correctionSchema=z.string().min(1).max(5000).refine(text=>!!text.trim());
const ruleApprovalMeta=z.object({id:z.string().uuid(),rule_key:z.string().min(1).max(120),rule_text:z.string().min(1).max(2000)});

type Receipt={id:string;status:string;source_text:string;content:string;turn_result:unknown};

function errorCode(error:unknown){return error instanceof Error?error.message:'UNKNOWN';}
function sourceField(form:FormData,name:string){
  const encoded=form.get(name+'_json');
  if(typeof encoded==='string'){const value:unknown=JSON.parse(encoded);if(typeof value!=='string')throw new Error('INVALID_TEXT');return value;}
  return typeof form.get(name)==='string'?String(form.get(name)):'';
}


async function approvedRules(client:SupabaseClient){
  const result=await client.from('work_rules').select('rule_key,rule_text').eq('enabled',true).order('updated_at',{ascending:false}).limit(100);
  if(result.error)throw new Error('STORE');
  return (result.data??[]).map(row=>`${row.rule_key}: ${row.rule_text}`);
}

async function askOpenAI(c:WorkCaptureConfig,client:SupabaseClient,text:string,capturedAt:string,timeZone:string,focusCaseId?:string,previous?:WorkPreview,correction?:string,bundle?:CaptureBundle){
  const [context,rules]=await Promise.all([workMemoryContext(client,text,focusCaseId),approvedRules(client)]);
  const revision=previous?[
    'REVISION MODE: Dylan rejected part of the prior draft. Revise using his correction. Preserve unrelated proposals unless the correction changes them.',
    'If the correction reveals a reusable work-language rule, add at most one concise rule_suggestion. Do NOT add a suggestion for a one-off factual correction such as a name, address, date, or case number.',
    'Previous draft: '+JSON.stringify(previous),
    'Dylan correction: '+correction,
  ].join('\n'):'';
  const response=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',headers:{Authorization:'Bearer '+c.OPENAI_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({
      model:c.OPENAI_MODEL||'gpt-4.1-mini',store:false,
      instructions:workPreviewInstructions(capturedAt,timeZone,rules)+'\n'+workTruthInstructions+(revision?'\n'+revision:''),
      input:JSON.stringify({...context.input,intent_hint:bundle?workIntentHint(bundle.capture.raw_transcript+'\n'+(bundle.versions.at(-1)?.correction??'')):context.input.intent_hint,organized_capture:bundle?{...bundle.capture,source_type:'organized_capture',organized:bundle.versions.at(-1)?.organized,corrections:bundle.versions.filter(v=>v.correction).map(v=>({version:v.version,text:v.correction}))}:null}),
      text:{format:{type:'json_schema',name:'work_confirmation_preview',strict:true,schema:workPreviewOutputSchema}},
      max_output_tokens:14000,
    }),
    signal:AbortSignal.timeout(65000),
  });
  if(!response.ok)throw new Error(response.status===429?'AI_LIMIT':'ORGANIZE');
  const result=await response.json() as {status?:string;output?:{content?:{type:string;text?:string}[]}[]};
  if(result.status!=='completed')throw new Error('ORGANIZE');
  const output=result.output?.flatMap(item=>item.content??[]).filter(item=>item.type==='output_text').map(item=>item.text??'').join('');
  return validateWorkPreview(JSON.parse(output||'{}'),context.candidates,context.knownEvents,context.knownFacts);
}

async function transcribe(c:WorkCaptureConfig,audio:File){
  if(audio.size===0||audio.size>20000000)throw new Error('AUDIO_SIZE');
  if(!/^(audio\/(mp4|mpeg|wav|x-wav|webm|ogg|aac)|video\/(mp4|webm))/.test(audio.type))throw new Error('AUDIO_TYPE');
  const upload=new FormData(),subtype=audio.type.split(';')[0].split('/')[1];
  const extension:Record<string,string>={mp4:'m4a',mpeg:'mp3',webm:'webm',ogg:'ogg',aac:'aac',wav:'wav','x-wav':'wav'};
  upload.set('file',audio,'work-capture.'+(extension[subtype]||'wav'));upload.set('model','gpt-4o-mini-transcribe');
  const response=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+c.OPENAI_API_KEY},body:upload,signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw new Error(response.status===429?'AI_LIMIT':'TRANSCRIBE');
  const result=await response.json() as {text?:string};return result.text??'';
}

function previewSuggestions(receipt:Receipt){
  const stored=receipt.turn_result as {kind?:string;preview?:WorkPreview}|null;
  return stored?.kind==='work_preview'?(stored.preview?.rule_suggestions??[]):[];
}

async function loadBundle(client:SupabaseClient,id:string):Promise<CaptureBundle>{
  const root=await client.from('work_captures').select('*').eq('id',id).single();
  if(root.error)throw new Error('STORE');
  const versions=await client.from('work_capture_versions').select('*').eq('capture_id',id).order('version');
  if(versions.error)throw new Error('STORE');
  return {capture:root.data as WorkCapture,versions:(versions.data??[]) as OrganizedVersion[]};
}
async function receiptFor(client:SupabaseClient,id:string){
  const row=await client.from('items').select('id,status,source_text,content,turn_result').eq('id',id).eq('type','capture').eq('area','Work').single();
  if(row.error)throw new Error('STORE');return row.data as Receipt;
}
async function bundleForReceipt(client:SupabaseClient,id:string){
  const version=await client.from('work_capture_versions').select('capture_id').eq('receipt_id',id).maybeSingle();
  if(version.error)throw new Error('STORE');
  if(version.data)return loadBundle(client,version.data.capture_id);
  // Adopt a legacy receipt written by an already-open client during deployment.
  const receipt=await receiptFor(client,id);
  let details:{captured_at?:string;time_zone?:string;focus_case_id?:string}={};
  try{details=JSON.parse(receipt.content);}catch{/* Legacy receipt without metadata. */}
  const saved=await client.rpc('toolbox_start_work_capture',{capture_uuid:id,transcript:receipt.source_text,capture_time:details.captured_at||new Date().toISOString(),capture_zone:details.time_zone||'America/New_York',focus_uuid:details.focus_case_id??null});
  if(saved.error)throw new Error('STORE');return loadBundle(client,id);
}
async function storeVersion(client:SupabaseClient,id:string,args:Record<string,unknown>){
  const result=await client.rpc('toolbox_store_work_capture_version',{version_uuid:id,...args});
  if(result.error)throw new Error(result.error.message.includes('CAPTURE_CHANGED')?'CAPTURE_CHANGED':'STORE');return result.data as Receipt;
}
async function organize(c:WorkCaptureConfig,client:SupabaseClient,bundle:CaptureBundle){
  const version=bundle.versions.at(-1)!;
  if(version.organized)return bundle;
  if(!c.OPENAI_API_KEY)throw new Error('SETUP_AI');
  const response=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',headers:{Authorization:'Bearer '+c.OPENAI_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({model:c.OPENAI_MODEL||'gpt-4.1-mini',store:false,instructions:organizedInstructions(bundle.capture),
      input:JSON.stringify({raw_transcript:bundle.capture.raw_transcript,corrections:bundle.versions.filter(v=>v.correction).map(v=>({version:v.version,text:v.correction})),previous_organized:bundle.versions.at(-2)?.organized??null}),
      text:{format:{type:'json_schema',name:'organized_work_capture',strict:true,schema:organizedOutputSchema}},max_output_tokens:20000}),
    signal:AbortSignal.timeout(65000),
  });
  if(!response.ok)throw new Error(response.status===429?'AI_LIMIT':'ORGANIZE');
  const data=await response.json() as {status?:string;output?:{content?:{type:string;text?:string}[]}[]};
  if(data.status!=='completed')throw new Error('ORGANIZE');
  const text=data.output?.flatMap(o=>o.content??[]).filter(o=>o.type==='output_text').map(o=>o.text??'').join('');
  const organized=validateOrganizedCapture(JSON.parse(text||'{}'),bundle);
  await storeVersion(client,version.id,{interpretation:organized,searchable_text:[bundle.capture.raw_transcript,...bundle.versions.map(v=>v.correction??''),captureSearchText(organized)].join('\n')});
  // Another retry may have won the save. Reason only from the durable winner.
  return loadBundle(client,bundle.capture.id);
}
async function reason(c:WorkCaptureConfig,client:SupabaseClient,bundle:CaptureBundle,expectedRevision=0,refresh=false){
  if(!c.OPENAI_API_KEY)throw new Error('SETUP_AI');
  const version=bundle.versions.at(-1)!,root=bundle.capture;
  const current=await receiptFor(client,version.receipt_id);
  if(current.status==='processed'||current.turn_result&&!refresh)return {turn_id:current.id,...current.turn_result as object};
  const prior=version.version>1?await receiptFor(client,bundle.versions.at(-2)!.receipt_id):null;
  const priorResult=(refresh?current.turn_result:prior?.turn_result) as {preview?:WorkPreview}|null;
  const interpretation=version.organized!;
  const preview=await askOpenAI(c,client,normalizeWorkCaseNumbers(root.raw_transcript),root.captured_at,root.time_zone,root.focus_case_id??undefined,priorResult?.preview,refresh?'Refresh against current case data; preserve the organized meaning.':version.correction??undefined,bundle);
  const result=preview.kind==='answer'?{kind:'work_answer',answer:preview.answer,answer_status:preview.answer_status,reply:preview.answer}:{kind:'work_preview',preview};
  const stored=await storeVersion(client,version.id,{preview_result:result,expected_revision:expectedRevision});
  return {turn_id:stored.id,...stored.turn_result as object};
}

export async function handleWorkCapture(request:Request,c:WorkCaptureConfig){
  const headers={'Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
  const json=(data:unknown,status=200)=>Response.json(data,{status,headers});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return json({error:'Use POST for Work capture.'},405);
  let client:SupabaseClient|undefined,bundle:CaptureBundle|undefined,sourceText:string|undefined,captureId:string|undefined;
  let stage:'organization'|'reasoning'='organization';
  try{
    if(!c.SUPABASE_URL||!c.SUPABASE_ANON_KEY)throw new Error('SETUP');
    const authorization=request.headers.get('authorization');if(!authorization?.startsWith('Bearer '))throw new Error('AUTH');
    client=createClient(c.SUPABASE_URL,c.SUPABASE_ANON_KEY,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data:auth,error:authError}=await client.auth.getUser(authorization.slice(7));if(authError||!auth.user)throw new Error('AUTH');
    const {data:allowed,error:accessError}=await client.rpc('toolbox_can_access');if(accessError||allowed!==true)return json({error:'This private toolbox is restricted to its owner.'},403);
    if(Number(request.headers.get('content-length')??0)>22000000)return json({error:'Recording is too large. Keep Work recordings under five minutes.'},413);
    const form=await request.formData(),mode=String(form.get('mode')||'preview');

    if(mode==='approve_rule'){
      const parsed=ruleApprovalMeta.safeParse({id:form.get('id'),rule_key:form.get('rule_key'),rule_text:form.get('rule_text')});
      if(!parsed.success)return json({error:'That rule suggestion is invalid.'},400);
      const receipt=await receiptFor(client,parsed.data.id);
      const suggestion=previewSuggestions(receipt).find((row:WorkRuleSuggestion)=>row.rule_key===parsed.data.rule_key&&row.rule_text===parsed.data.rule_text);
      if(!suggestion)return json({error:'That rule is no longer part of this draft.'},409);
      const saved=await client.from('work_rules').upsert({user_id:auth.user.id,rule_key:suggestion.rule_key,rule_text:suggestion.rule_text,enabled:true,source_capture_id:receipt.id},{onConflict:'user_id,rule_key'}).select('id,rule_key,rule_text,enabled').single();
      if(saved.error)throw new Error('STORE');return json({approved_rule:saved.data});
    }

    if(mode==='commit'||mode==='discard'||mode==='revise'){
      const parsed=draftMeta.safeParse({id:form.get('id')});if(!parsed.success)return json({error:'That Work draft is invalid.'},400);
      const row=await receiptFor(client,parsed.data.id);
      bundle=await bundleForReceipt(client,row.id);captureId=bundle.capture.id;sourceText=bundle.capture.raw_transcript;
      if(mode==='discard'){
        const saved=await client.from('items').update({status:'processed',turn_result:{kind:'work_discarded'}}).eq('id',row.id).eq('status','pending');
        if(saved.error)throw new Error('STORE');return json({discarded:true});
      }
      if(mode==='commit'){
        const stored=row.turn_result as {revision?:number}|null;
        const revision=Number(form.get('revision')??stored?.revision??0);
        if(!Number.isInteger(revision)||revision<1)return json({error:'Review this capture before confirming.'},400);
        const applied=await client.rpc('toolbox_confirm_work_capture',{capture_uuid:row.id,expected_revision:revision});
        if(applied.error){
          if(applied.error.message.includes('CASE_CHANGED')){
            bundle=await organize(c,client,bundle);stage='reasoning';
            const refreshed=await reason(c,client,bundle,stored?.revision??0,true);
            return json({...refreshed,error:'One of these files changed while you were reviewing it. I refreshed the draft; confirm it again.'},409);
          }
          if(applied.error.message.includes('CAPTURE_CHANGED'))throw new Error('CAPTURE_CHANGED');
          throw new Error('STORE');
        }
        return json(applied.data);
      }
      const correction=correctionSchema.safeParse(sourceField(form,'correction'));
      const revisionId=z.string().uuid().safeParse(form.get('revision_id')||crypto.randomUUID());
      if(!correction.success||!revisionId.success)return json({error:'Tell me what should change.'},400);
      const revised=await client.rpc('toolbox_revise_work_capture',{receipt_uuid:row.id,correction_text:correction.data,revision_uuid:revisionId.data});
      if(revised.error)throw new Error(revised.error.message.includes('CAPTURE_CHANGED')?'CAPTURE_CHANGED':'STORE');
      bundle=await loadBundle(client,revised.data as string);
    }else if(mode==='retry'){
      const id=z.string().uuid().safeParse(form.get('id'));if(!id.success)return json({error:'That capture is invalid.'},400);
      bundle=await loadBundle(client,id.data);captureId=id.data;sourceText=bundle.capture.raw_transcript;
    }else if(mode==='preview'||mode==='transcribe'){
      const parsed=previewMeta.safeParse({id:form.get('id'),captured_at:form.get('captured_at'),time_zone:form.get('time_zone'),focus_case_id:form.get('focus_case_id')||undefined});
      if(!parsed.success)return json({error:'Capture details are invalid.'},400);
      const meta=parsed.data;captureId=meta.id;
      try{new Intl.DateTimeFormat('en-US',{timeZone:meta.time_zone}).format();}catch{return json({error:'Time zone is invalid.'},400);}
      const existing=await client.from('work_captures').select('id').eq('id',meta.id).maybeSingle();
      if(existing.error)throw new Error('STORE');
      if(!existing.data){
        const count=await client.from('work_captures').select('id',{count:'exact',head:true}).gte('created_at',new Date(Date.now()-3600000).toISOString());
        if(count.error)throw new Error('STORE');if((count.count??0)>=60)return json({error:'Many Work captures arrived at once. Try again in a little while.'},429);
        sourceText=sourceField(form,'text');
        const audio=form.get('audio');
        if(!sourceText.trim()&&audio instanceof File){if(!c.OPENAI_API_KEY)throw new Error('SETUP_AI');sourceText=await transcribe(c,audio);form.delete('audio');}
        if(!sourceText.trim())return json({error:'I did not catch any speech or text.'},422);
        if(sourceText.length>30000)return json({error:'Keep each Work capture under 30,000 characters.',transcript:sourceText,capture_id:meta.id},413);
        const saved=await client.rpc('toolbox_start_work_capture',{capture_uuid:meta.id,transcript:sourceText,capture_time:meta.captured_at,capture_zone:meta.time_zone,focus_uuid:meta.focus_case_id??null});
        if(saved.error)throw new Error('STORE');
      }
      bundle=await loadBundle(client,meta.id);sourceText=bundle.capture.raw_transcript;
      if(mode==='transcribe')return json({kind:'work_transcript',capture_id:meta.id,transcript:sourceText});
    }else return json({error:'Unknown Work capture mode.'},400);

    const latest=bundle.versions.at(-1)!;
    const receipt=await receiptFor(client,latest.receipt_id);
    if(receipt.turn_result&&receipt.status==='pending')return json({turn_id:receipt.id,...receipt.turn_result as object});
    // Legacy sources can be organized without replaying their old confirmed changes.
    bundle=await organize(c,client,bundle);stage='reasoning';
    if(receipt.status==='processed')return json({turn_id:receipt.id,...receipt.turn_result as object});
    return json(await reason(c,client,bundle));
  }catch(error){
    const code=errorCode(error);
    if(client&&bundle&&code!=='CAPTURE_CHANGED')try{await storeVersion(client,bundle.versions.at(-1)!.id,{failed_stage:stage});}catch{/* Original source remains durable even when an error marker cannot be saved. */}
    if(code==='AUTH')return json({error:'Please sign in again.'},401);
    const messages:Record<string,string>={SETUP:'Work storage is still being connected.',SETUP_AI:'AI capture is not configured. Saved text can be retried later.',STORE:'Could not reach private Work storage.',AI_LIMIT:'AI processing is temporarily unavailable because of an API usage or billing limit.',TRANSCRIBE:'I could not transcribe that recording yet.',ORGANIZE:'I could not organize that capture yet. Retry the saved text without recording again.',CAPTURE_CHANGED:'This capture has a newer correction or review. Open it from Recent Captures before confirming.',AUDIO_SIZE:'Recording must be smaller than 20 MB.',AUDIO_TYPE:'That recording format is not supported.'};
    return json({error:messages[code]??'Could not finish organizing this capture. Retry the saved text.',capture_id:captureId,transcript:sourceText,transcript_saved:!!bundle,retryable:!!sourceText},code==='CAPTURE_CHANGED'?409:503);
  }
}
