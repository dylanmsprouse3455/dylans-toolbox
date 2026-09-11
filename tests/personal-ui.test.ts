import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Personal UI has dedicated AI section and no floating Orbit bubble',async()=>{
  const source=await readFile(new URL('../app/toolbox.tsx',import.meta.url),'utf8');
  assert.match(source,/TabsTrigger value="ai"/);
  assert.match(source,/Message Orbit/);
  assert.match(source,/General Notes/);
  assert.match(source,/Search finished items/);
  assert.match(source,/details className=\"completed-day\"/);
  assert.doesNotMatch(source,/!aiHistory.length&&!lastTurn/);
  assert.doesNotMatch(source,/className={'orbit-button/);
  assert.match(source,/today-area-grid/);
});
