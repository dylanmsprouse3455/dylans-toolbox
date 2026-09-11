import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {normalizeWorkCaseNumbers} from './work-context.ts';
import {workMemoryContext,validateWorkPreview} from './work-memory.ts';
import {workPreviewInstructions,workPreviewOutputSchema} from './work-preview-schema.ts';
import type {WorkPreview,WorkRuleSuggestion} from './work-types.ts';

export type WorkCaptureConfig={SUPABASE_URL?:string;SUPABASE_ANON_KEY?:string;OPENAI_API_KEY?:string;OPENAI_MODEL?:string};
const previewMeta=z.object({id:z.string().uuid(),captured_at:z.string().datetime({offset:true}),time_zone:z.string().min(1).max(100),focus_case_id:z.string().uuid().optional()});
const draftMeta=z.object({id:z.string().uuid()});
const correctionSchema=z.string().trim().min(1).max(5000);
const ruleApprovalMeta=z.object({id:z.string().uuid(),rule_key:z.string().min(1).max(120),rule_text:z.string().min(1).max(2000)});

type Receipt={id:string;status:string;source_text:string;content:string;turn_result:unknown};

function errorCode(error:unknown){return error instanceof Error?error.message:'UNKNOWN';}
function captureDetails(receipt:Receipt){try{return JSON.parse(receipt.content) as {captured_at?:string;time_zone?:string;focus_case_id?:string};}catch{return {};}}

async function approvedRules(client:SupabaseClient){
  const result=await client.from('work_rules').select('rule_key,rule_text').eq('enabled',true).order('updated_at',{ascending:false}).limit(100);
  if(result.error)throw new Error('STORE');
  return (result.data??[]).map(row=>`${row.rule_key}: ${row.rule_text}`);
}

async function askOpenAI(c:WorkCaptureConfig,client:SupabaseClient,text:string,capturedAt:string,timeZone:string,focusCaseId?:string,previous?:WorkPreview,correction?:string){
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
      instructions:workPreviewInstructions(capturedAt,timeZone,rules)+(revision?'\n'+revision:''),
      input:JSON.stringify(context.input),
      text:{format:{type:'json_schema',name:'work_confirmation_preview',strict:true,schema:workPreviewOutputSchema}},
      max_output_tokens:14000,
    }),
    signal:AbortSignal.timeout(65000),
  });
  if(!response.ok)throw new Error(response.status===429?'AI_LIMIT':'ORGANIZE');
  const result=await response.json() as {status?:string;output?:{content?:{type:string;text?:string}[]}[]};
  if(result.status!=='completed')throw new Error('ORGANIZE');
  const output=result.output?.flatMap(item=>item.content??[]).filter(item=>item.type==='output_text').map(item=>item.text??'').join('');
  return validateWorkPreview(JSON.parse(output||'{}'),context.candidates);
}

async function transcribe(c:WorkCaptureConfig,audio:File){
  if(audio.size===0||audio.size>20000000)throw new Error('AUDIO_SIZE');
  if(!/^(audio\/(mp4|mpeg|wav|x-wav|webm|ogg|aac)|video\/(mp4|webm))/.test(audio.type))throw new Error('AUDIO_TYPE');
  const upload=new FormData(),subtype=audio.type.split(';')[0].split('/')[1];
  const extension:Record<string,string>={mp4:'m4a',mpeg:'mp3',webm:'webm',ogg:'ogg',aac:'aac',wav:'wav','x-wav':'wav'};
  upload.set('file',audio,'work-capture.'+(extension[subtype]||'wav'));upload.set('model','gpt-4o-mini-transcribe');
  const response=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+c.OPENAI_API_KEY},body:upload,signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw new Error(response.status===429?'AI_LIMIT':'TRANSCRIBE');
  const result=await response.json() as {text?:string};return result.text?.trim()??'';
}

function previewSuggestions(receipt:Receipt){
  const stored=receipt.turn_result as {kind?:string;preview?:WorkPreview}|null;
  return stored?.kind==='work_preview'?(stored.preview?.rule_suggestions??[]):[];
}

export async function handleWorkCapture(request:Request,c:WorkCaptureConfig){
  const headers={'Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
  const json=(data:unknown,status=200)=>Response.json(data,{status,headers});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return json({error:'Use POST for Work capture.'},405);
  try{
    if(!c.SUPABASE_URL||!c.SUPABASE_ANON_KEY)throw new Error('SETUP');
    const authorization=request.headers.get('authorization');if(!authorization?.startsWith('Bearer '))throw new Error('AUTH');
    const client=createClient(c.SUPABASE_URL,c.SUPABASE_ANON_KEY,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data:auth,error:authError}=await client.auth.getUser(authorization.slice(7));if(authError||!auth.user)throw new Error('AUTH');
    const {data:allowed,error:accessError}=await client.rpc('toolbox_can_access');if(accessError||allowed!==true)return json({error:'This private toolbox is restricted to its owner.'},403);
    if(Number(request.headers.get('content-length')??0)>22000000)return json({error:'Recording is too large. Keep Work recordings under five minutes.'},413);

    const form=await request.formData();
    const mode=String(form.get('mode')||'preview');

    if(mode==='approve_rule'){
      const parsed=ruleApprovalMeta.safeParse({id:form.get('id'),rule_key:form.get('rule_key'),rule_text:form.get('rule_text')});
      if(!parsed.success)return json({error:'That rule suggestion is invalid.'},400);
      const {data:receipt,error}=await client.from('items').select('id,status,source_text,content,turn_result').eq('id',parsed.data.id).eq('type','capture').eq('area','Work').maybeSingle();
      if(error)throw new Error('STORE');if(!receipt)return json({error:'That Work draft could not be found.'},404);
      const suggestion=previewSuggestions(receipt as Receipt).find((row:WorkRuleSuggestion)=>row.rule_key===parsed.data.rule_key&&row.rule_text===parsed.data.rule_text);
      if(!suggestion)return json({error:'That rule is no longer part of this draft.'},409);
      const saved=await client.from('work_rules').upsert({user_id:auth.user.id,rule_key:suggestion.rule_key,rule_text:suggestion.rule_text,enabled:true,source_capture_id:receipt.id},{onConflict:'user_id,rule_key'}).select('id,rule_key,rule_text,enabled').single();
      if(saved.error)throw new Error('STORE');
      return json({approved_rule:saved.data});
    }

    if(!c.OPENAI_API_KEY)return json({error:'AI capture is not configured.'},503);

    if(mode==='commit'||mode==='discard'||mode==='revise'){
      const parsed=draftMeta.safeParse({id:form.get('id')});if(!parsed.success)return json({error:'That Work draft is invalid.'},400);
      const {data:receipt,error}=await client.from('items').select('id,status,source_text,content,turn_result').eq('id',parsed.data.id).eq('type','capture').eq('area','Work').maybeSingle();
      if(error)throw new Error('STORE');if(!receipt)return json({error:'That Work draft could not be found.'},404);
      const row=receipt as Receipt;

      if(mode==='discard'){
        if(row.status==='pending'){const removed=await client.from('items').delete().eq('id',row.id).eq('status','pending');if(removed.error)throw new Error('STORE');}
        return json({discarded:true});
      }

      if(mode==='commit'){
        if(row.status==='processed'&&row.turn_result)return json(row.turn_result);
        const applied=await client.rpc('toolbox_apply_work_preview',{capture_uuid:row.id});
        if(applied.error){
          if(applied.error.message.includes('CASE_CHANGED')){
            const details=captureDetails(row),stored=row.turn_result as {kind?:string;revision?:number;preview?:WorkPreview}|null;
            const refreshed=await askOpenAI(c,client,row.source_text,details.captured_at||new Date().toISOString(),details.time_zone||'America/New_York',details.focus_case_id,stored?.preview,'Refresh this draft against the latest file data without changing Dylan’s meaning.');
            if(refreshed.kind==='answer')throw new Error('ORGANIZE');
            const next={kind:'work_preview',revision:(stored?.revision??0)+1,preview:refreshed};
            const saved=await client.from('items').update({turn_result:next}).eq('id',row.id).eq('status','pending');if(saved.error)throw new Error('STORE');
            return json({kind:'work_preview',turn_id:row.id,revision:next.revision,preview:refreshed,error:'One of these files changed while you were reviewing it. I refreshed the draft; confirm it again.'},409);
          }
          throw new Error('STORE');
        }
        return json(applied.data);
      }

      if(row.status!=='pending')return json({error:'That Work draft has already been finished.'},409);
      const correction=correctionSchema.safeParse(form.get('correction'));if(!correction.success)return json({error:'Tell me what I got wrong or what should change.'},400);
      const stored=row.turn_result as {kind?:string;revision?:number;preview?:WorkPreview}|null;
      if(stored?.kind!=='work_preview'||!stored.preview)return json({error:'There is no Work draft to correct.'},409);
      const details=captureDetails(row),combined=(row.source_text+'\nCorrection: '+correction.data).slice(0,30000);
      const revised=await askOpenAI(c,client,combined,details.captured_at||new Date().toISOString(),details.time_zone||'America/New_York',details.focus_case_id,stored.preview,correction.data);
      const revision=(stored.revision??1)+1;
      if(revised.kind==='answer'){
        const result={kind:'work_answer',turn_id:row.id,answer:revised.answer,answer_status:revised.answer_status,reply:revised.answer};
        const saved=await client.from('items').update({source_text:combined,status:'processed',turn_result:result}).eq('id',row.id).eq('status','pending');if(saved.error)throw new Error('STORE');
        return json(result);
      }
      const next={kind:'work_preview',revision,preview:revised};
      const saved=await client.from('items').update({source_text:combined,turn_result:next}).eq('id',row.id).eq('status','pending');if(saved.error)throw new Error('STORE');
      return json({kind:'work_preview',turn_id:row.id,revision,preview:revised});
    }

    if(mode!=='preview')return json({error:'Unknown Work capture mode.'},400);
    const parsed=previewMeta.safeParse({id:form.get('id'),captured_at:form.get('captured_at'),time_zone:form.get('time_zone'),focus_case_id:form.get('focus_case_id')||undefined});
    if(!parsed.success)return json({error:'Capture details are invalid.'},400);
    const meta=parsed.data;
    try{new Intl.DateTimeFormat('en-US',{timeZone:meta.time_zone}).format();}catch{return json({error:'Time zone is invalid.'},400);}

    const {data:existing,error:existingError}=await client.from('items').select('id,status,source_text,content,turn_result').eq('id',meta.id).eq('type','capture').maybeSingle();
    if(existingError)throw new Error('STORE');
    if(existing?.status==='processed'&&existing.turn_result)return json(existing.turn_result);
    if(existing?.status==='pending'&&existing.turn_result)return json({turn_id:existing.id,...existing.turn_result});

    const {count,error:countError}=await client.from('items').select('id',{count:'exact',head:true}).eq('type','capture').eq('area','Work').gte('created_at',new Date(Date.now()-3600000).toISOString());
    if(countError)throw new Error('STORE');if((count??0)>=60)return json({error:'Many Work captures arrived at once. Try again in a little while.'},429);

    if(!existing){
      const inserted=await client.from('items').insert({id:meta.id,user_id:auth.user.id,type:'capture',title:'Work capture',content:JSON.stringify({workspace:'work-wizard',captured_at:meta.captured_at,time_zone:meta.time_zone,focus_case_id:meta.focus_case_id??null}),source_text:'',area:'Work',status:'pending',importance:1,urgency:1});
      if(inserted.error&&inserted.error.code!=='23505')throw new Error('STORE');
    }

    let text=typeof form.get('text')==='string'?String(form.get('text')).trim():'';
    const audio=form.get('audio');if(!text&&audio instanceof File)text=await transcribe(c,audio);
    text=normalizeWorkCaseNumbers(text);
    if(!text)return json({error:'I did not catch any speech or text.'},422);if(text.length>30000)return json({error:'Keep each Work capture under 30,000 characters.'},413);
    const transcript=await client.from('items').update({source_text:text}).eq('id',meta.id).eq('status','pending');if(transcript.error)throw new Error('STORE');

    const preview=await askOpenAI(c,client,text,meta.captured_at,meta.time_zone,meta.focus_case_id);
    if(preview.kind==='answer'){
      const result={kind:'work_answer',turn_id:meta.id,answer:preview.answer,answer_status:preview.answer_status,reply:preview.answer};
      const saved=await client.from('items').update({status:'processed',turn_result:result}).eq('id',meta.id).eq('status','pending');if(saved.error)throw new Error('STORE');
      return json(result);
    }
    const stored={kind:'work_preview',revision:1,preview};
    const saved=await client.from('items').update({turn_result:stored}).eq('id',meta.id).eq('status','pending');if(saved.error)throw new Error('STORE');
    return json({kind:'work_preview',turn_id:meta.id,revision:1,preview});
  }catch(error){
    const code=errorCode(error);
    if(code==='AUTH')return json({error:'Please sign in again.'},401);
    const messages:Record<string,string>={
      SETUP:'Work storage is still being connected.',STORE:'Could not reach private Work storage.',AI_LIMIT:'AI processing is temporarily unavailable because of an API usage or billing limit.',
      TRANSCRIBE:'I could not transcribe that recording yet.',ORGANIZE:'I could not confidently organize that Work update. Your recording or text is still on this screen so you can retry.',
      AUDIO_SIZE:'Recording must be smaller than 20 MB.',AUDIO_TYPE:'That recording format is not supported.',
    };
    return json({error:messages[code]??'Could not finish that Work update.'},503);
  }
}
