import test from 'node:test';
import assert from 'node:assert/strict';
import {PERSONAL_AREAS,unopenedForDay,completionDayKey} from '../lib/items.ts';
import {captureInstructions} from '../lib/capture-schema.ts';

test('Personal areas exclude Work and Personal prompt enforces separation',()=>{
  assert.equal(PERSONAL_AREAS.includes('Work' as never),false);
  const prompt=captureInstructions('2026-09-11T16:00:00-04:00','America/New_York','personal');
  assert.match(prompt,/Keep Work completely separate/);
  assert.match(prompt,/CONNECTED ACTIONS/);
  assert.match(prompt,/GENERAL NOTES/);
});

test('24-hour unopened highlighting uses last opened time',()=>{
  assert.equal(unopenedForDay({type:'task',status:'active',created_at:'2026-09-09T12:00:00Z',last_opened_at:'2026-09-10T12:00:00Z'},Date.parse('2026-09-11T13:00:00Z')),true);
  assert.equal(unopenedForDay({type:'note',status:'active',created_at:'2026-09-09T12:00:00Z',last_opened_at:null},Date.parse('2026-09-11T13:00:00Z')),false);
});

test('completed items group by durable completed_at',()=>{
  const completed='2026-09-10T12:00:00';
  assert.equal(completionDayKey({completed_at:completed,updated_at:'2026-09-11T15:00:00Z'}),completionDayKey({completed_at:null,updated_at:completed}));
});
