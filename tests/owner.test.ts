import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {handleCapture} from '../lib/capture-handler.ts';
test('Only the configured owner can use the database, even when another user owns existing rows',async()=>{
  const db=new PGlite();
  const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
  try{
    await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${owner}'),('${other}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated;`);
    await db.exec(await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
    await db.exec(`insert into items(user_id,type,title) values('${owner}','task','Owner item'),('${other}','task','Other account item');`);
    await db.exec(await readFile(new URL('../supabase/owner-access.sql',import.meta.url),'utf8'));
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${owner}';`);
    assert.equal((await db.query<{allowed:boolean}>('select toolbox_can_access() as allowed')).rows[0].allowed,false,'Unconfigured deployment fails closed');
    await db.exec(`reset role;insert into toolbox_private.owner(user_id) values('${owner}');set role authenticated;`);
    assert.equal((await db.query<{allowed:boolean}>('select toolbox_can_access() as allowed')).rows[0].allowed,true);
    assert.equal((await db.query('select * from items')).rows.length,1);
    await db.exec(`set request.jwt.claim.sub='${other}';`);
    assert.equal((await db.query<{allowed:boolean}>('select toolbox_can_access() as allowed')).rows[0].allowed,false);
    assert.equal((await db.query('select * from items')).rows.length,0,'Other user cannot even access their former rows');
    await assert.rejects(db.query("insert into items(user_id,type,title) values($1,'task','Denied')",[other]),/row-level security/);
    await assert.rejects(db.query('update toolbox_private.owner set user_id=$1',[other]),/permission denied/);
    assert.equal((await db.query('select * from toolbox_private.owner')).rows.length,0);
    await db.exec('reset role;set role anon;');
    await assert.rejects(db.query('select toolbox_can_access()'),/permission denied/);
  }finally{await db.close();}
});
test('Capture denies a valid but unauthorized user before any AI request',async()=>{
  const original=globalThis.fetch;let aiCalls=0;
  globalThis.fetch=async(input:RequestInfo|URL)=>{
    const url=String(input instanceof Request?input.url:input);
    if(url.includes('/auth/v1/user'))return Response.json({id:'22222222-2222-4222-8222-222222222222'});
    if(url.includes('/rpc/toolbox_can_access'))return Response.json(false);
    aiCalls++;throw new Error('Unexpected external request');
  };
  try{
    const response=await handleCapture(new Request('https://example.com',{method:'POST',headers:{Authorization:'Bearer other-user'}}),{SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'test',OPENAI_API_KEY:'test'});
    assert.equal(response.status,403);assert.equal(aiCalls,0);
  }finally{globalThis.fetch=original;}
});
