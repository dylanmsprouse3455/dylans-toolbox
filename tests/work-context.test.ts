import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWorkCaseNumbers,normalizeWorkEntity,workContent,workIntentHint,workState,withWorkState} from '../lib/work-context.ts';

test('normalizes common spoken case-number forms',()=>{
  assert.equal(normalizeWorkCaseNumbers('Check G 26 0441 today.'),'Check G26-0441 today.');
  assert.equal(normalizeWorkCaseNumbers('Check g260441 today.'),'Check G26-0441 today.');
  assert.equal(normalizeWorkCaseNumbers('Check G 20 6 0441 today.'),'Check G26-0441 today.');
  assert.equal(normalizeWorkCaseNumbers('Check G 2 6 0 4 4 1 today.'),'Check G26-0441 today.');
  assert.equal(normalizeWorkCaseNumbers('G 26 is 0481 1445 Old Jonesboro Rd.'),'G26-0481 1445 Old Jonesboro Rd.');
});

test('normalizes common address alias wording for retrieval',()=>{
  assert.equal(normalizeWorkEntity('1445 Old Jonesboro Road'),'1445oldjonesborord');
  assert.equal(normalizeWorkEntity('1445 Old Jonesboro Rd.'),'1445oldjonesborord');
});

test('classifies obvious Work actions separately from questions',()=>{
  assert.equal(workIntentHint('I need to pull that file and get Christopher’s phone number.'),'action');
  assert.equal(workIntentHint('What is Christopher’s phone number?'),'question');
  assert.equal(workIntentHint('Did we get the payoff?'),'question');
  assert.equal(workIntentHint('So there is a G 20 60232 Austin Porter need to get his mailing address'),'action');
});

test('work state marker is machine-readable but hidden from display content',()=>{
  const content=withWorkState('Texted seller for payoff statement.','waiting');
  assert.equal(workState(content),'waiting');
  assert.equal(workContent(content),'Texted seller for payoff statement.');
});
