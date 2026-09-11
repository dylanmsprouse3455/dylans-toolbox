import test from 'node:test';
import assert from 'node:assert/strict';
import {attention,type Item} from '../lib/items.ts';
const now=Date.parse('2026-09-11T12:00:00Z');
const item=(id:string,extra:Partial<Item>={}):Item=>({id,user_id:'a',title:id,type:'task',content:'',area:'Home',status:'active',importance:4,urgency:1,due_at:null,parent_id:null,capture_id:null,source_text:'',created_at:new Date(now).toISOString(),updated_at:new Date(now).toISOString(),...extra});
test('Home caps attention at five and excludes notes, references, completed, subtasks and backlog',()=>{
  const rows=[...Array.from({length:9},(_,i)=>item(String(i))),item('note',{type:'note',importance:5}),item('reference',{type:'reference',urgency:5}),item('done',{status:'completed'}),item('child',{parent_id:'1'}),item('backlog',{importance:1,urgency:1})];
  const home=attention(rows,now);
  assert.equal(home.length,5);
  assert.deepEqual(home.map(i=>i.id),['0','1','2','3','4']);
  assert.equal(rows.length,14,'Stored rows remain accessible to Areas');
});
test('Overdue and near-due reminders surface; far-future low-attention reminders wait',()=>{
  const rows=[item('important'),item('overdue',{type:'reminder',importance:1,due_at:'2026-09-10T09:00:00Z'}),item('soon',{importance:1,due_at:'2026-09-12T09:00:00Z'}),item('later',{importance:1,due_at:'2026-10-12T09:00:00Z'})];
  assert.deepEqual(attention(rows,now).map(i=>i.id),['overdue','soon','important']);
});
