import test from 'node:test';
import assert from 'node:assert/strict';
import {groupCaseHistory,validateWorkPreview,workSearchTerms} from '../lib/work-memory.ts';
import {workPreviewInstructions} from '../lib/work-preview-schema.ts';
import type {WorkCase} from '../lib/work-types.ts';

const existing:WorkCase={
  id:'11111111-1111-4111-8111-111111111111',user_id:'22222222-2222-4222-8222-222222222222',case_number:'G26-0441',title:'G26-0441 · Ball Lane',status:'active',workflow_state:'waiting',ball_owner:'other',ball_with:'Mike',current_situation:'Waiting on LLC documents.',next_action:'Follow up if they do not arrive.',memory_summary:'LLC documents were requested from Mike and remain outstanding.',current_phase_id:'33333333-3333-4333-8333-333333333333',follow_up_at:null,follow_up_date:'2026-09-14',follow_up_condition:'if Mike has not sent the LLC documents',follow_up_resolved_at:null,closing_date:null,last_event_at:'2026-09-11T14:00:00.000Z',created_at:'2026-09-11T13:00:00.000Z',updated_at:'2026-09-11T14:00:00.000Z'
};

function proposal(){return {
  case_id:existing.id,expected_updated_at:existing.updated_at,case_number:'G26-0441',title:'G26-0441 · Ball Lane',status:'active' as const,workflow_state:'waiting' as const,ball_owner:'other' as const,ball_with:'Mike',current_situation:'Waiting on LLC documents.',next_action:'Follow up if they do not arrive.',memory_summary:existing.memory_summary,follow_up_at:null,follow_up_date:'2026-09-14',follow_up_condition:'if Mike has not sent the LLC documents',closing_date:null,event_kind:'request' as const,event_summary:'Requested LLC documents from Mike.',evidence_excerpt:'I requested the LLC docs from Mike.',match_confidence:'high' as const,match_reason:'Exact G26-0441 match.',fact_changes:[],confirmation_question:'Keep G26-0441 in Waiting on Response with the ball with Mike and follow up Monday if the documents have not arrived — is that right?'
};}

const changes=(rows=[proposal()])=>({kind:'changes' as const,headline:'One file update',answer:null,answer_status:null,commit_reply:'Saved.',proposals:rows,rule_suggestions:[]});

test('accepts a versioned proposal for an existing Work file',()=>{
  const result=validateWorkPreview(changes(),new Map([[existing.id,existing]]));
  assert.equal(result.proposals[0].case_number,'G26-0441');
  assert.equal(result.proposals[0].follow_up_condition,'if Mike has not sent the LLC documents');
});

test('normalizes harmless ball-owner inconsistencies instead of rejecting the Work update',()=>{
  const newCase={...proposal(),case_id:null,expected_updated_at:null,case_number:'G26-0454',title:'G26-0454 · 7691 Asheville Highway',workflow_state:'todo' as const,ball_owner:'me' as const,ball_with:"Jeannie's office",current_situation:'File needs to be placed in Jeannie’s office.',next_action:'Put the file in Jeannie’s office.',memory_summary:'File for 7691 Asheville Highway needs to be placed in Jeannie’s office.',follow_up_date:null,follow_up_condition:null,event_kind:'action' as const,event_summary:'Need to put the file in Jeannie’s office.',evidence_excerpt:'I need to drop off the file in Jeannie’s office.',match_reason:'New case identified by exact case number.',confirmation_question:'Put G26-0454 in To Do for placing the file in Jeannie’s office — is that right?'};
  const result=validateWorkPreview(changes([newCase]),new Map());
  assert.equal(result.proposals[0].ball_owner,'me');
  assert.equal(result.proposals[0].ball_with,null);
});

test('deduplicates repeated permanent fact changes',()=>{
  const row={...proposal(),fact_changes:[
    {action:'upsert' as const,key:'property_address',value:'1445 Old Jonesboro Rd',aliases:['1445 Old Jonesboro Road'],confidence:'high' as const},
    {action:'upsert' as const,key:'property_address',value:'1445 Old Jonesboro Rd',aliases:[],confidence:'high' as const},
  ]};
  const result=validateWorkPreview(changes([row]),new Map([[existing.id,existing]]));
  assert.equal(result.proposals[0].fact_changes.length,1);
});

test('completion clears stale follow-up state',()=>{
  const row={...proposal(),status:'completed' as const,workflow_state:'todo' as const,ball_owner:'me' as const};
  const result=validateWorkPreview(changes([row]),new Map([[existing.id,existing]]));
  assert.equal(result.proposals[0].follow_up_date,null);
  assert.equal(result.proposals[0].follow_up_condition,null);
  assert.equal(result.proposals[0].ball_owner,'none');
});

test('rejects stale versions so confirmation cannot overwrite newer file data',()=>{
  const stale={...proposal(),expected_updated_at:'2026-09-11T13:30:00.000Z'};
  assert.throws(()=>validateWorkPreview(changes([stale]),new Map([[existing.id,existing]])));
});

test('rejects duplicate creation when the case number already exists',()=>{
  const duplicate={...proposal(),case_id:null,expected_updated_at:null};
  assert.throws(()=>validateWorkPreview(changes([duplicate]),new Map([[existing.id,existing]])));
});

test('accepts read-only Work answers with explicit evidence status',()=>{
  const result=validateWorkPreview({kind:'answer',headline:'Briefing',answer:'G26-0441 is waiting on Mike.',answer_status:'found',commit_reply:'',proposals:[],rule_suggestions:[]},new Map([[existing.id,existing]]));
  assert.equal(result.kind,'answer');
  assert.equal(result.answer_status,'found');
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

test('instructions cover phases facts evidence isolation conditions and approved rules',()=>{
  const instructions=workPreviewInstructions('2026-09-11T16:00:00-04:00','America/New_York',['payoff_ordered: payoff ordered means waiting on the servicer']);
  assert.match(instructions,/A completed file is NOT a blank slate/);
  assert.match(instructions,/LIFECYCLE PHASES/);
  assert.match(instructions,/PERMANENT FACTS/);
  assert.match(instructions,/EVIDENCE ISOLATION/);
  assert.match(instructions,/CONDITIONAL FOLLOW-UPS/);
  assert.match(instructions,/MATCH CONFIDENCE/);
  assert.match(instructions,/answer_status/);
  assert.match(instructions,/payoff ordered means waiting on the servicer/);
});
