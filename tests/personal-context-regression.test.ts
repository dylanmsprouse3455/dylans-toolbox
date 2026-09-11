import test from 'node:test';
import assert from 'node:assert/strict';
import {captureInstructions} from '../lib/capture-schema.ts';

test('Personal context instructions prefer updates, aliases, errands, and explicit dependencies',()=>{
  const prompt=captureInstructions('2026-09-11T17:00:00-04:00','America/New_York','personal');
  assert.match(prompt,/ENTITY ALIASES/);
  assert.match(prompt,/SAME GOAL, UPDATE IT/);
  assert.match(prompt,/ERRAND AND LIST MERGING/);
  assert.match(prompt,/DEPENDENCIES/);
  assert.match(prompt,/clarify rather than silently creating a third one/);
});
