import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {attention,attentionReason,softOverdue,type Item} from '../lib/items.ts';
import {captureInstructions} from '../lib/capture-schema.ts';

function item(overrides:Partial<Item>={}):Item{return {id:crypto.randomUUID(),user_id:'owner',type:'task',title:'Flexible task',content:'',area:'Home',status:'active',importance:3,urgency:3,due_at:null,due_date:null,parent_id:null,depends_on_id:null,source_text:'',capture_id:null,created_at:'2026-09-10T12:00:00.000Z',updated_at:'2026-09-10T12:00:00.000Z',last_opened_at:'2026-09-13T00:00:00.000Z',workflow_state:'active',waiting_on:null,follow_up_at:null,follow_up_date:null,highlighted:false,...overrides};}

test('waiting items stay off Home until follow-up is due, then explain why they returned',()=>{
  const now=Date.parse('2026-09-13T16:00:00.000Z');
  const waiting=item({workflow_state:'waiting',waiting_on:'Insurance',follow_up_date:'2026-09-14',importance:5,urgency:5});
  assert.equal(attention([waiting],now).length,0);
  const due={...waiting,follow_up_date:'2026-09-12'};
  assert.equal(attention([due],now)[0]?.id,due.id);
  assert.match(attentionReason(due,now),/Follow-up/);
});

test('only flexible unhighlighted date-only tasks qualify for overdue autopilot',()=>{
  const flexible=item({due_date:'2026-09-12'}),pinned=item({due_date:'2026-09-12',highlighted:true}),timed=item({due_at:'2026-09-12T15:00:00-04:00'}),reminder=item({type:'reminder',due_date:'2026-09-12'});
  assert.equal(softOverdue(flexible,'2026-09-13'),true);
  assert.equal(softOverdue(pinned,'2026-09-13'),false);
  assert.equal(softOverdue(timed,'2026-09-13'),false);
  assert.equal(softOverdue(reminder,'2026-09-13'),false);
});

test('Personal capture instructions treat pasted conversations as source material, not assistant-generated tasks',()=>{
  const instructions=captureInstructions('2026-09-13T12:00:00-04:00','America/New_York','personal');
  assert.match(instructions,/BULK TEXT DUMPS/);
  assert.match(instructions,/Suggestions made by an assistant or another speaker are NOT Dylan’s tasks/);
  assert.match(instructions,/WAITING ON/);
  assert.match(instructions,/HIGHLIGHTING/);
});

test('Personal UI exposes dump, quick actions, Home reasons, waiting, highlight, and undo without adding a new navigation section',()=>{
  const ui=fs.readFileSync(new URL('../app/toolbox.tsx',import.meta.url),'utf8');
  assert.match(ui,/Paste text dump/);assert.match(ui,/Process dump/);assert.match(ui,/Quick actions/);assert.match(ui,/attentionReason/);assert.match(ui,/Mark waiting/);assert.match(ui,/Undo last change/);
});

test('migration records Personal revisions and preserves new state in backup version 3',()=>{
  const sql=fs.readFileSync(new URL('../supabase/personal-attention-v2.sql',import.meta.url),'utf8');
  assert.match(sql,/personal_item_revisions/);assert.match(sql,/toolbox_undo_personal_item/);assert.match(sql,/'version',3/);assert.match(sql,/workflow_state/);assert.match(sql,/highlighted/);
});
