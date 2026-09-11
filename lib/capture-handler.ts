import {createClient} from '@supabase/supabase-js';
import {captureInstructions,organizedCapture,outputSchema} from './capture-schema.ts';
import {z} from 'zod';
const metadata=z.object({id:z.string().uuid(),captured_at:z.string().datetime({offset:true}),time_zone:z.string().min(1).max(100)});
export type CaptureConfig={SUPABASE_URL?:string;SUPABASE_ANON_KEY?:string;OPENAI_API_KEY?:string;OPENAI_MODEL?:string};
export async function handleCapture(request:Request,c:CaptureConfig){
  const headers={'Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
  const json=(data:unknown,status=200)=>Response.json(data,{status,headers});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return json({error:'Use POST to capture a thought.'},405);
  try{
    if(!c.SUPABASE_URL||!c.SUPABASE_ANON_KEY)throw new Error('SETUP');
    const authorization=request.headers.get('authorization');
    if(!authorization?.startsWith('Bearer '))throw new Error('AUTH');
    const client=createClient(c.SUPABASE_URL,c.SUPABASE_ANON_KEY,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data:auth,error:authError}=await client.auth.getUser(authorization.slice(7));
    if(authError||!auth.user)throw new Error('AUTH');
    const user=auth.user;
    const {data:allowed,error:accessError}=await client.rpc('toolbox_can_access');
    if(accessError||allowed!==true)return json({error:'This private toolbox is restricted to its owner.'},403);
    if(Number(request.headers.get('content-length')??0)>22000000)return json({error:'Recording is too large. Please keep recordings under five minutes.'},413);
    const form=await request.formData();
    const parsed=metadata.safeParse({id:form.get('id'),captured_at:form.get('captured_at'),time_zone:form.get('time_zone')});
    if(!parsed.success)return json({error:'Capture details are invalid.'},400);
    const m=parsed.data;
    try{new Intl.DateTimeFormat('en-US',{timeZone:m.time_zone}).format();}catch{return json({error:'Time zone is invalid.'},400);}
    const {data:existing,error:existingError}=await client.from('items').select('id,status,source_text').eq('id',m.id).eq('type','capture').maybeSingle();
    if(existingError)throw new Error('STORE');
    if(existing?.status==='processed'){
      const {data:items,error}=await client.from('items').select('*').eq('capture_id',m.id).neq('type','capture');
      if(error)throw new Error('STORE');
      return json({items,already_saved:true});
    }
    if(!c.OPENAI_API_KEY)return json({error:'AI capture is not configured. Your capture is still saved on this device.'},503);
    const {count,error:countError}=await client.from('items').select('id',{count:'exact',head:true}).eq('type','capture').gte('created_at',new Date(Date.now()-3600000).toISOString());
    if(countError)throw new Error('STORE');
    if(!existing&&(count??0)>=60)return json({error:'Many captures arrived at once. Your recording is safe; try again later.'},429);
    let text=typeof form.get('text')==='string'?String(form.get('text')).trim():'';
    const audio=form.get('audio');
    if(!existing){
      const {error}=await client.from('items').insert({id:m.id,user_id:user.id,type:'capture',title:'Raw capture',content:'',source_text:text.slice(0,30000),area:'Inbox',status:'pending',importance:1,urgency:1});
      if(error&&error.code!=='23505')throw new Error('STORE');
    }
    if(audio instanceof File&&existing?.source_text)text=existing.source_text;
    else if(audio instanceof File){
      if(audio.size===0||audio.size>20000000)return json({error:'Recording must be smaller than 20 MB and contain audio.'},413);
      if(!/^(audio\/(mp4|mpeg|wav|x-wav|webm|ogg|aac)|video\/(mp4|webm))/.test(audio.type))return json({error:'This recording format is not supported. Try a new recording or type your thought.'},400);
      const upload=new FormData();
      const subtype=audio.type.split(';')[0].split('/')[1];
      const extension:Record<string,string>={mp4:'m4a',mpeg:'mp3',webm:'webm',ogg:'ogg',aac:'aac',wav:'wav','x-wav':'wav'};
      upload.set('file',audio,'capture.'+(extension[subtype]||'wav'));
      upload.set('model','gpt-4o-mini-transcribe');
      const response=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+c.OPENAI_API_KEY},body:upload,signal:AbortSignal.timeout(60000)});
      if(!response.ok)throw new Error(response.status===429?'AI_LIMIT':'TRANSCRIBE');
      const result=await response.json() as {text?:string};
      text=result.text?.trim()??'';
    }
    if(!text)return json({error:'No speech or text was found. Your recording is kept in Pending so you can try again.'},422);
    if(text.length>30000)return json({error:'Please keep each capture under 30,000 characters.'},413);
    const {error:transcriptError}=await client.from('items').update({source_text:text}).eq('id',m.id).eq('status','pending');
    if(transcriptError)throw new Error('STORE');
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+c.OPENAI_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({model:c.OPENAI_MODEL||'gpt-4.1-mini',store:false,instructions:captureInstructions(m.captured_at,m.time_zone),
        input:text,text:{format:{type:'json_schema',name:'organized_capture',strict:true,schema:outputSchema}},max_output_tokens:10000}),
      signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw new Error(response.status===429?'AI_LIMIT':'ORGANIZE');
    const result=await response.json() as {status?:string;output?:{content?:{type:string;text?:string}[]}[]};
    if(result.status!=='completed')throw new Error('ORGANIZE');
    const output=result.output?.flatMap(o=>o.content??[]).filter(o=>o.type==='output_text').map(o=>o.text??'').join('');
    const organized=organizedCapture.parse(JSON.parse(output||'{}'));
    const rows:Record<string,unknown>[]=[];
    for(const item of organized.items){
      const id=crypto.randomUUID(),{subtasks,...rest}=item;
      const factual=rest.type==='note'||rest.type==='reference';
      rows.push({...rest,...(factual?{importance:1,urgency:1,due_at:null}:{}),id,parent_id:null});
      if(item.type==='task')for(const sub of subtasks)rows.push({...sub,id:crypto.randomUUID(),parent_id:id});
    }
    const {data:items,error}=await client.rpc('toolbox_save_capture',{capture_uuid:m.id,source:text,entries:rows});
    if(error)throw new Error('STORE');
    return json({items:items??[]});
  }catch(error){
    const code=error instanceof Error?error.message:'UNKNOWN';
    if(code==='AUTH')return json({error:'Please sign in again. Your pending capture is safe on this device.'},401);
    const messages:Record<string,string>={
      SETUP:'Storage is being connected. Your capture is saved on this device.',
      STORE:'Could not reach your private storage. Your capture is saved and will retry.',
      AI_LIMIT:'AI processing is currently unavailable because of an API usage or billing limit. Your capture is saved in Pending.',
      TRANSCRIBE:'Could not transcribe this recording yet. It is saved in Pending.',
      ORGANIZE:'Could not organize this capture yet. It is saved in Pending.',
    };
    return json({error:messages[code]??'Could not finish processing. Your capture is saved and can be retried.'},503);
  }
}
