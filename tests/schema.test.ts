import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
test('Actual PostgreSQL enforces ownership, atomic retries, editing and parent completion',async()=>{
  const db=new PGlite();
  const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
  const receipt='33333333-3333-4333-8333-333333333333',parent='44444444-4444-4444-8444-444444444444',child='55555555-5555-4555-8555-555555555555';
  try{
    await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${a}'),('${b}');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
    await db.exec(await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${a}';insert into public.items(id,user_id,type,title,status) values('${receipt}','${a}','capture','Receipt','pending');`);
    const fields={type:'task',title:'Parent',content:'Details',area:'Home',importance:4,urgency:3,due_at:null,parent_id:null};
    const entries=[{...fields,id:parent},{...fields,id:child,title:'Child',parent_id:parent}];
    await db.query('select * from toolbox_save_capture($1,$2,$3)',[receipt,'original',JSON.stringify(entries)]);
    const retry=await db.query('select * from toolbox_save_capture($1,$2,$3)',[receipt,'retry',JSON.stringify(entries)]);
    assert.equal(retry.rows.length,2);
    assert.equal((await db.query('select * from items')).rows.length,3,'Retry creates no duplicate');
    await db.query('select * from toolbox_set_status($1,$2)',[parent,'completed']);
    assert.equal((await db.query("select * from items where status='completed'")).rows.length,2);
    await db.query('select * from toolbox_set_status($1,$2)',[parent,'active']);
    await db.query("update items set title='Edited' where id=$1",[parent]);
    assert.equal((await db.query<{title:string}>('select title from items where id=$1',[parent])).rows[0].title,'Edited');
    await assert.rejects(db.query('update items set user_id=$1 where id=$2',[b,parent]),/row-level security/);
    await db.exec(`set request.jwt.claim.sub='${b}'`);
    assert.equal((await db.query('select * from items')).rows.length,0);
    assert.equal((await db.query("update items set title='Intrusion' where id=$1 returning id",[parent])).rows.length,0);
    await assert.rejects(db.query('select * from toolbox_set_status($1,$2)',[parent,'completed']),/Task not found/);
    await assert.rejects(db.query('select * from toolbox_save_capture($1,$2,$3)',[receipt,'intrusion','[]']),/Capture not found/);
    await assert.rejects(db.query("insert into items(user_id,type,title,parent_id) values($1,'task','Cross-account child',$2)",[b,parent]),/owned top-level task/);
    await assert.rejects(db.query("insert into items(user_id,type,title) values($1,'task','Forged owner')",[a]),/row-level security/);
    await db.exec('reset role;set role anon');
    await assert.rejects(db.query('select * from items'),/permission denied/);
  }finally{await db.close();}
});
