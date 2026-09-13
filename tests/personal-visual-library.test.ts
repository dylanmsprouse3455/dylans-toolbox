import test from 'node:test';
import assert from 'node:assert/strict';
import {organizedCapture,captureInstructions} from '../lib/capture-schema.ts';
import {checkedChanges} from '../lib/conversation.ts';
import type {Item} from '../lib/items.ts';

const asset='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const now='2026-09-13T12:00:00Z';

test('Personal organizer accepts supplied visuals and visual-only updates',()=>{
  const plan=organizedCapture.parse({items:[{type:'task',title:'Buy birthday gift',content:'',area:'People',importance:3,urgency:3,due_at:null,due_date:null,workflow_state:'active',waiting_on:null,follow_up_at:null,follow_up_date:null,highlighted:false,visual_asset_id:asset,parent_id:null,depends_on_id:null,subtasks:[]}],updates:[{item_id:id,status:null,change_due:false,due_at:null,due_date:null,title:null,content:null,area:null,change_dependency:false,depends_on_id:null,change_waiting:false,workflow_state:null,waiting_on:null,follow_up_at:null,follow_up_date:null,change_highlighted:false,highlighted:null,change_visual:true,visual_asset_id:asset}],reply:'Updated.',needs_clarification:false});
  assert.equal(plan.items[0].visual_asset_id,asset);
  const item={id,user_id:'11111111-1111-4111-8111-111111111111',type:'task',title:'Birthday',content:'',area:'People',status:'active',importance:3,urgency:3,due_at:null,due_date:null,parent_id:null,depends_on_id:null,source_text:'',capture_id:null,created_at:now,updated_at:now} as Item;
  assert.equal(checkedChanges({...plan,items:[]},new Map([[id,item]]))[0].visual_asset_id,asset);
  assert.match(captureInstructions(now,'America/New_York','personal'),/VISUAL LIBRARY/);
});

test('Work instructions forbid Personal visual assignment',()=>{
  const instructions=captureInstructions(now,'America/New_York','work');
  assert.match(instructions,/visual_asset_id=null/);
  assert.match(instructions,/change_visual=false/);
});
