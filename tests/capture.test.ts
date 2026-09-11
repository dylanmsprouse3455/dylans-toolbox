import test from 'node:test';
import assert from 'node:assert/strict';
import {handleCapture} from '../lib/capture-handler.ts';
const config={SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'test-public-key',OPENAI_API_KEY:'test-server-only'};
const owner='11111111-1111-4111-8111-111111111111',id='33333333-3333-4333-8333-333333333333';
function request(audio=false){const form=new FormData();form.set('id',id);form.set('captured_at','2026-09-10T10:00:00-04:00');form.set('time_zone','America/New_York');
  if(audio)form.set('audio',new Blob(['test audio'],{type:'audio/mp4'}),'recording');else form.set('text','Please call Sam tomorrow. Also a note: the door code is 42.');
  return new Request('https://example.supabase.co/functions/v1/capture',{method:'POST',headers:{Authorization:'Bearer test-user-token'},body:form});}
test('Edge function rejects unauthenticated requests and handles browser preflight without AI',async()=>{
  assert.equal((await handleCapture(new Request('https://example.com',{method:'POST'}),config)).status,401);
  const cors=await handleCapture(new Request('https://example.com',{method:'OPTIONS'}),config);
  assert.equal(cors.status,204);assert.equal(cors.headers.get('access-control-allow-origin'),'*');
  assert.equal((await handleCapture(new Request('https://example.com'),config)).status,405);
});
test('Text and audio processing, AI failure, transcript recovery, and idempotent receipt recovery',async()=>{
  const original=globalThis.fetch;
  let saved=false,fail=false,source='',aiCalls=0,transcriptions=0,savedRows:unknown[]=[],mode='normal';
  globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
    const req=input instanceof Request?input:new Request(input,init),url=new URL(req.url);
    if(url.pathname==='/auth/v1/user')return Response.json({id:owner,aud:'authenticated',role:'authenticated',email:'test@example.invalid'});
    if(url.hostname==='api.openai.com'){
      assert.equal(req.headers.get('authorization'),'Bearer test-server-only');
      if(url.pathname.includes('transcriptions')){transcriptions++;assert.equal((await req.formData()).get('model'),'gpt-4o-mini-transcribe');return Response.json({text:'Call Sam tomorrow.'});}
      aiCalls++;if(fail)return Response.json({error:'quota'},{status:429});
      const body=await req.json();assert.equal(body.store,false);assert.ok(body.instructions.includes('2026-09-10T10:00:00-04:00'));
      return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({items:[{type:'note',title:'Door code',content:'42',area:'Home',importance:5,urgency:5,due_at:'2026-09-11T09:00:00-04:00',subtasks:[]},{type:'task',title:'Call Sam',content:'',area:'People',importance:4,urgency:4,due_at:'2026-09-11T09:00:00-04:00',subtasks:[]}]})}]}]});
    }
    assert.equal(req.headers.get('authorization'),'Bearer test-user-token','All database calls use the caller token, never an admin key');
    if(url.pathname.endsWith('/rpc/toolbox_save_capture')){const body=await req.json();saved=true;savedRows=body.entries.map((e:object)=>({...e,user_id:owner,capture_id:id}));return Response.json(savedRows);}
    if(req.method==='HEAD')return new Response(null,{headers:{'content-range':'0-0/1'}});
    if(req.method==='PATCH'){source=(await req.json()).source_text;return new Response(null,{status:204});}
    if(req.method==='POST')return new Response(null,{status:201});
    if(url.searchParams.has('capture_id'))return Response.json(savedRows);
    return Response.json(saved?[{id,status:'processed',source_text:source}]:mode==='retry'?[{id,status:'pending',source_text:source}]:[]);
  };
  try{
    const text=await handleCapture(request(),config);assert.equal(text.status,200);
    const result=await text.json();assert.equal(result.items.length,2);assert.equal(result.items[0].importance,1);assert.equal(result.items[0].due_at,null);
    const calls=aiCalls;
    assert.equal((await handleCapture(request(),{...config,OPENAI_API_KEY:undefined})).status,200);
    assert.equal(aiCalls,calls,'Already-saved response recovery needs no AI key or request');
    saved=false;fail=true;source='';
    assert.equal((await handleCapture(request(true),config)).status,503);
    assert.equal(source,'Call Sam tomorrow.','Transcript saved before organization fails');
    assert.equal(transcriptions,1);
    mode='retry';fail=false;
    assert.equal((await handleCapture(request(true),config)).status,200);
    assert.equal(transcriptions,1,'Retry reuses the saved transcript');
  }finally{globalThis.fetch=original;}
});
