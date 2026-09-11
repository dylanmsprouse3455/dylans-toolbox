import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWorkPreview} from '../lib/work-memory.ts';
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
