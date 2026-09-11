import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Work wizard defaults to confirmation-first with optional full details and mobile scrolling',async()=>{
  const tsx=await readFile(new URL('../app/work-toolbox.tsx',import.meta.url),'utf8');
  const css=await readFile(new URL('../app/work-toolbox.css',import.meta.url),'utf8');
  assert.match(tsx,/showWizardDetails,setShowWizardDetails/);
  assert.match(tsx,/View full case/);
  assert.match(tsx,/Orbit understood/);
  assert.match(tsx,/showWizardDetails&&<div className=\"work-wizard-expanded\">/);
  assert.match(css,/compact confirmation-first Work wizard/);
  assert.match(css,/max-height:calc\(100dvh/);
  assert.match(css,/-webkit-overflow-scrolling:touch/);
  assert.match(css,/touch-action:pan-y/);
});
