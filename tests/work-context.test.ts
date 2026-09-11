import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWorkCaseNumbers,workContent,workState,withWorkState} from '../lib/work-context.ts';

test('normalizes common spoken case-number forms',()=>{
  assert.equal(normalizeWorkCaseNumbers('Check G 26 0441 today.'),'Check G26-0441 today.');
  assert.equal(normalizeWorkCaseNumbers('Check g260441 today.'),'Check G26-0441 today.');
  assert.equal(normalizeWorkCaseNumbers('Check G 20 6 0441 today.'),'Check G26-0441 today.');
  assert.equal(normalizeWorkCaseNumbers('Check G 2 6 0 4 4 1 today.'),'Check G26-0441 today.');
  assert.equal(normalizeWorkCaseNumbers('G 26 is 0481 1445 Old Jonesboro Rd.'),'G26-0481 1445 Old Jonesboro Rd.');
});

test('work state marker is machine-readable but hidden from display content',()=>{
  const content=withWorkState('Texted seller for payoff statement.','waiting');
  assert.equal(workState(content),'waiting');
  assert.equal(workContent(content),'Texted seller for payoff statement.');
});
