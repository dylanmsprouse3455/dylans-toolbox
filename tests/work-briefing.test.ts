import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWorkBriefing} from '../lib/work-briefing.ts';
import type {WorkCase} from '../lib/work-types.ts';

const now=Date.parse('2026-09-14T17:00:00Z');
const row=(caseNumber:string,extra:Partial<WorkCase>={}):WorkCase=>({
  id:caseNumber,user_id:'owner',case_number:caseNumber,title:caseNumber,status:'active',workflow_state:'todo',ball_owner:'me',ball_with:null,current_situation:'Current '+caseNumber,next_action:'Next '+caseNumber,memory_summary:'',current_phase_id:null,follow_up_at:null,follow_up_date:null,follow_up_condition:null,follow_up_resolved_at:null,closing_date:null,last_event_at:'2026-09-14T16:00:00Z',created_at:'2026-09-10T12:00:00Z',updated_at:'2026-09-14T16:00:00Z',...extra,
});

test('briefing is derived from current case state and separates due soon from generic needs-you work',()=>{
  const cases=[
    row('G26-0232',{current_situation:'Mailing address still needed.',next_action:'Call Austin again.'}),
    row('G26-0391',{workflow_state:'follow_up',follow_up_date:'2026-09-16',current_situation:'Recording package is awaiting return.'}),
    row('G26-0456',{workflow_state:'waiting',ball_owner:'other',ball_with:'Cindy',current_situation:'Waiting for Cindy process guidance.'}),
    row('G26-0454',{status:'completed',ball_owner:'none',current_situation:'Completed.',last_event_at:'2026-09-11T18:07:53Z'}),
  ];
  const briefing=buildWorkBriefing(cases,now);
  assert.equal(briefing.needsYou,1);
  assert.equal(briefing.dueSoon,1);
  assert.equal(briefing.waiting,1);
  assert.deepEqual(briefing.groups.find(group=>group.key==='needs_you')?.items.map(item=>item.case_number),['G26-0232']);
  assert.deepEqual(briefing.groups.find(group=>group.key==='due_soon')?.items.map(item=>item.case_number),['G26-0391']);
  assert.deepEqual(briefing.groups.find(group=>group.key==='waiting')?.items.map(item=>item.case_number),['G26-0456']);
  assert.equal(briefing.groups.find(group=>group.key==='needs_you')?.items[0]?.current_situation,'Mailing address still needed.');
});

test('overdue dated work moves into needs you, while later follow-ups stay in watching',()=>{
  const briefing=buildWorkBriefing([
    row('G26-1000',{workflow_state:'follow_up',follow_up_date:'2026-09-13'}),
    row('G26-1001',{workflow_state:'follow_up',follow_up_date:'2026-09-25'}),
  ],now);
  assert.deepEqual(briefing.groups.find(group=>group.key==='needs_you')?.items.map(item=>item.case_number),['G26-1000']);
  assert.deepEqual(briefing.groups.find(group=>group.key==='watching')?.items.map(item=>item.case_number),['G26-1001']);
});
