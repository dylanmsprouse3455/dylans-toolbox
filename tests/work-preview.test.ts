import test from 'node:test';
import assert from 'node:assert/strict';
import {groupCaseHistory,validateWorkPreview,workSearchTerms} from '../lib/work-memory.ts';
import {workPreviewInstructions} from '../lib/work-preview-schema.ts';
import type {WorkCase} from '../lib/work-types.ts';

const existing:WorkCase={
  id:'11111111-1111-4111-8111-111111111111',user_id:'22222222-2222-4222-8222-222222222222',case_number:'G26-0441',title:'G26-0441 · Ball Lane',status:'active',workflow_state:'waiting',ball_owner:'other',ball_with:'Mike',current_situation:'Waiting on LLC documents.',next_action:'Follow up if they do not arrive.',follow_up_at:null,follow_up_date:'2026-09-14',closing_date:null,last_event_at:'2026-09-11T14:00:00.000Z',created_at:'2026-09-11T13:00:00.000Z',updated_at:'2026-09-11T14:00:00.000Z'
};

function proposal(){return {
  case_id:existing.id,expected_updated_at:existing.updated_at,case_number:'G26-0441',title:'G26-0441 · Ball Lane',status:'active' as const,workflow_state:'waiting' as const,ball_owner:'other' as const,ball_with:'Mike',current_situation:'Waiting on LLC documents.',next_action:'Follow up if they do not arrive.',follow_up_at:null,follow_up_date:'2026-09-14',closing_date:null,event_kind:'request' as const,event_summary:'Requested LLC documents from Mike.',confirmation_question:'Keep G26-0441 in Waiting on Response with the ball with Mike and follow up Monday — is that right?'
};}

test('accepts a versioned proposal for an existing Work file',()=>{
  const result=validateWorkPreview({kind:'changes',headline:'One file update',answer:null,commit_reply:'Saved.',proposals:[proposal()]},new Map([[existing.id,existing]]));
  assert.equal(result.proposals[0].case_number,'G26-0441');
});

test('normalizes harmless ball-owner inconsistencies instead of rejecting the Work update',()=>{
  const newCase={...proposal(),case_id:null,expected_updated_at:null,case_number:'G26-0454',title:'G26-0454 · 7691 Asheville Highway',workflow_state:'todo' as const,ball_owner:'me' as const,ball_with:"Jeannie's office",current_situation:'File needs to be placed in Jeannie’s office.',next_action:'Put the file in Jeannie’s office.',event_kind:'action' as const,event_summary:'Need to put the file in Jeannie’s office.',confirmation_question:'Put G26-0454 in To Do for placing the file in Jeannie’s office — is that right?'};
  const result=validateWorkPreview({kind:'changes',headline:'One file update',answer:null,commit_reply:'Saved.',proposals:[newCase]},new Map());
  assert.equal(result.proposals[0].ball_owner,'me');
  assert.equal(result.proposals[0].ball_with,null);
});

test('rejects stale versions so confirmation cannot overwrite newer file data',()=>{
  const stale={...proposal(),expected_updated_at:'2026-09-11T13:30:00.000Z'};
  assert.throws(()=>validateWorkPreview({kind:'changes',headline:'One file update',answer:null,commit_reply:'Saved.',proposals:[stale]},new Map([[existing.id,existing]])));
});

test('rejects duplicate creation when the case number already exists',()=>{
  const duplicate={...proposal(),case_id:null,expected_updated_at:null};
  assert.throws(()=>validateWorkPreview({kind:'changes',headline:'One file update',answer:null,commit_reply:'Saved.',proposals:[duplicate]},new Map([[existing.id,existing]])));
});

test('accepts read-only Work answers with no proposed changes',()=>{
  const result=validateWorkPreview({kind:'answer',headline:'Briefing',answer:'G26-0441 is waiting on Mike.',commit_reply:'',proposals:[]},new Map([[existing.id,existing]]));
  assert.equal(result.kind,'answer');
});

test('groups timeline history by file and keeps newest entries first',()=>{
  const events=[
    {id:'a',case_id:'one',kind:'completion',summary:'Closed.',source_text:'done',occurred_at:'2026-09-11T12:00:00Z'},
    {id:'b',case_id:'two',kind:'note',summary:'Other file.',source_text:'other',occurred_at:'2026-09-11T11:00:00Z'},
    {id:'c',case_id:'one',kind:'request',summary:'Requested documents.',source_text:'asked for docs',occurred_at:'2026-09-11T10:00:00Z'},
  ];
  const grouped=groupCaseHistory(events,10);
  assert.deepEqual(grouped.get('one')?.map(event=>event.id),['a','c']);
  assert.equal(grouped.get('two')?.[0].summary,'Other file.');
});

test('search terms retain distinctive address and person tokens',()=>{
  assert.deepEqual(workSearchTerms("For 1445 Old Jonesboro Rd I need Christopher's phone number"),['1445','jonesboro','christopher','phone','number']);
});

test('instructions treat reopened completed files as the same case with history',()=>{
  const instructions=workPreviewInstructions('2026-09-11T16:00:00-04:00','America/New_York');
  assert.match(instructions,/A completed file is NOT a blank slate/);
  assert.match(instructions,/same case_id/);
  assert.match(instructions,/different situation/);
  assert.match(instructions,/SEARCH BEFORE SAYING NOT FOUND/);
  assert.match(instructions,/focused_case_id is only conversational context/);
  assert.match(instructions,/I need to call\/text\/email\/get\/find\/pull\/look up/);
});
