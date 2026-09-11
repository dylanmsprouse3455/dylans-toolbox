import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedChanges} from '../lib/conversation.ts';
import {organizedCapture} from '../lib/capture-schema.ts';
import {dueLabel,attention,type Item} from '../lib/items.ts';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const entry=(id=randomUUID())=>({id,type:'task',title:'Bring catnip to work',content:'',area:'Work',importance:3,urgency:4,due_at:null,due_date:'2026-09-12',parent_id:null,depends_on_id:null});
const patch=(id:string,version:string,extra:object={})=>({item_id:id,expected_updated_at:version,status:null,change_due:false,due_at:null,due_date:null,title:null,content:null,area:null,change_dependency:false,depends_on_id:null,...extra});

test('Conversation edits are atomic, owner-only, date-aware, and safe to retry',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${owner}'),('${other}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated;`);
    for(const file of ['schema.sql','owner-access.sql','conversation.sql'])await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
    await db.exec(`insert into toolbox_private.owner(user_id) values('${owner}');set role authenticated;set request.jwt.claim.sub='${owner}';`);
    const receipt=async()=>{const id=randomUUID();await db.query("insert into items(id,user_id,type,title,status) values($1,$2,'capture','Message','pending')",[id,owner]);return id;};
    const apply=async(id:string,entries:object[],changes:object[],clarify=false)=>{
      const r=await db.query<{result:{items:Item[];updated_items:Item[];reply:string;needs_clarification:boolean}}>('select toolbox_apply_turn($1,$2,$3,$4,$5,$6) as result',[id,'User message',JSON.stringify(entries),JSON.stringify(changes),clarify?'What time tomorrow?':'Updated.',clarify]);return r.rows[0].result;
    };
    const first=await receipt(),task=entry();
    const created=await apply(first,[task],[]);
    assert.equal(created.items[0].due_at,null,'Tomorrow does not become a made-up clock time');
    assert.equal(created.items[0].due_date,'2026-09-12');
    const second=await receipt(),change=patch(task.id,created.items[0].updated_at,{change_due:true,due_at:'2026-09-12T15:00:00-04:00'});
    const edited=await apply(second,[],[change]);
    assert.equal(Date.parse(edited.updated_items[0].due_at!),Date.parse('2026-09-12T19:00:00Z'));
    assert.equal(edited.updated_items[0].due_date,null);
    assert.equal((await db.query("select id from items where type='task'")).rows.length,1,'An edit must not create a new task');
    const repeat=await apply(second,[],[change]);
    assert.deepEqual(repeat,edited,'Lost HTTP response replays the original receipt');
    await db.query("update items set title='Catnip manually corrected' where id=$1",[task.id]);
    await apply(second,[],[change]);
    assert.equal((await db.query<{title:string}>('select title from items where id=$1',[task.id])).rows[0].title,'Catnip manually corrected');
    const stale=await receipt(),wouldCreate=entry();
    await assert.rejects(apply(stale,[wouldCreate],[change]),/ITEM_CHANGED/);
    assert.equal((await db.query('select id from items where id=$1',[wouldCreate.id])).rows.length,0,'A conflict rolls back the entire batch');
    assert.equal((await db.query<{status:string}>('select status from items where id=$1',[stale])).rows[0].status,'pending');
    const question=await receipt();
    assert.equal((await apply(question,[],[],true)).needs_clarification,true);
    await assert.rejects(apply(await receipt(),[entry()],[],true),/Clarification cannot modify/);
    const batch=await receipt(),parent=entry(),child={...entry(),parent_id:parent.id,title:'Put catnip in bag'};
    const batchResult=await apply(batch,[parent,child],[]);
    const parentVersion=batchResult.items.find(item=>item.id===parent.id)!.updated_at;
    const finished=await apply(await receipt(),[{...entry(),type:'note',due_date:null,title:'A new idea'}],[patch(parent.id,parentVersion,{status:'completed'})]);
    assert.equal(finished.items.length,1);
    assert.equal(finished.updated_items.length,2);
    assert.ok(finished.updated_items.every(item=>item.status==='completed'));
    await db.exec(`reset role;insert into items(id,user_id,type,title) values('99999999-9999-4999-8999-999999999999','${other}','task','Private other task');set role authenticated;`);
    await assert.rejects(apply(await receipt(),[],[patch('99999999-9999-4999-8999-999999999999',created.items[0].updated_at,{status:'completed'})]),/Target not found/);
    await db.exec(`set request.jwt.claim.sub='${other}';`);
    await assert.rejects(apply(first,[],[]),/Owner access required/);
    await db.exec('reset role;set role anon;');
    await assert.rejects(apply(first,[],[]),/permission denied/);
  }finally{await db.close();}
});

test('Model proposals cannot target unseen items or combine ambiguous requests with edits',()=>{
  const item={...entry(),user_id:owner,status:'active',capture_id:null,source_text:'',created_at:'2026-09-11T12:00:00Z',updated_at:'2026-09-11T12:00:00Z'} as Item;
  const {expected_updated_at,...change}=patch(item.id,item.updated_at,{status:'completed'});
  const plan=organizedCapture.parse({items:[],updates:[change],reply:'Done.',needs_clarification:false});
  assert.throws(()=>checkedChanges(plan,new Map()),/ORGANIZE/);
  assert.equal(checkedChanges(plan,new Map([[item.id,item]]))[0].expected_updated_at,item.updated_at);
  assert.throws(()=>checkedChanges({...plan,needs_clarification:true},new Map([[item.id,item]])),/ORGANIZE/);
  assert.throws(()=>checkedChanges({...plan,updates:[change,change]},new Map([[item.id,item]])),/ORGANIZE/);
});

test('Day-only tasks surface on Today without displaying an invented time',()=>{
  const today=new Date(),day=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
  assert.equal(dueLabel(null,day),'Today');
  const item={...entry(),due_date:day,user_id:owner,status:'active',capture_id:null,source_text:'',created_at:today.toISOString(),updated_at:today.toISOString(),importance:1,urgency:1} as Item;
  assert.equal(attention([item]).length,1);
});
