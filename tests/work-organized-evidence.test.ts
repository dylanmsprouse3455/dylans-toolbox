import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOrganizedCapture,type CaptureBundle} from '../lib/work-organized.ts';

const raw="So what I need to do Is for G26-0232 Austin Porter 423-823-4023 we need to do a refund for the earnest money and get them on address from him I tried calling him but I didn't get an answer So I'm gonna need to try to call him again Today around four";
const bundle:CaptureBundle={
  capture:{id:'662f12fc-de73-41ca-8ef1-c75439015662',user_id:'11111111-1111-4111-8111-111111111111',raw_transcript:raw,raw_origin:'original',captured_at:'2026-09-11T19:13:36.762Z',time_zone:'America/New_York',focus_case_id:null,current_version:1,created_at:'2026-09-11T19:13:37.662Z'},
  versions:[],
};

test('organized evidence reconciles harmless case and punctuation formatting back to exact source',()=>{
  const result=validateOrganizedCapture({
    summary:'G26-0232: refund earnest money, get Austin Porter’s address, and call him again today around four after no answer.',
    entries:[{
      kind:'action',text:'Call Austin Porter again around four today.',case_numbers:['G26-0232'],people:['Austin Porter'],property:null,truth_status:'current',source:'raw_transcript',source_version:1,
      source_excerpt:"i tried calling him but i didn't get an answer, so i'm gonna need to try to call him again today around four",
      date_wording:'today around four',resolved_date:null,resolved_at:'2026-09-11T16:00:00-04:00',
    }],
  },bundle);
  assert.equal(result.entries[0].source_excerpt,"I tried calling him but I didn't get an answer So I'm gonna need to try to call him again Today around four");
  assert.equal(result.entries[0].date_wording,'Today around four');
});

test('organized evidence still rejects a semantic paraphrase that is not in the source',()=>{
  assert.throws(()=>validateOrganizedCapture({
    summary:'Call again.',
    entries:[{
      kind:'action',text:'Call again.',case_numbers:['G26-0232'],people:['Austin Porter'],property:null,truth_status:'current',source:'raw_transcript',source_version:1,
      source_excerpt:'Austin asked me to call him again at four',date_wording:null,resolved_date:null,resolved_at:null,
    }],
  },bundle));
});
