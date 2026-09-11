import test from 'node:test';
import assert from 'node:assert/strict';
import {appendSpeech,thoughtLines} from '../lib/live-speech.ts';

test('Live speech joins finalized phrases without duplicated spacing',()=>{
  assert.equal(appendSpeech('Bring catnip tomorrow.','  Actually, make that Friday.  '),'Bring catnip tomorrow. Actually, make that Friday.');
  assert.equal(appendSpeech('Keep this','   '),'Keep this');
});

test('Live review keeps the newest five thought lines and includes interim words',()=>{
  const lines=thoughtLines('One. Two. Three. Four. Five.','Six is still being spoken');
  assert.deepEqual(lines,['Two.','Three.','Four.','Five.','Six is still being spoken']);
});

