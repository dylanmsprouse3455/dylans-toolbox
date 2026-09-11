import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/personal-backups.sql',import.meta.url),'utf8');
const ui=readFileSync(new URL('../components/personal-recovery.tsx',import.meta.url),'utf8');
test('Personal backups are owner-scoped and explicitly exclude Work',()=>{
  assert.match(sql,/enable row level security/i);
  assert.match(sql,/i\.area<>'Work'/);
  assert.match(sql,/Work data cannot be restored through Personal recovery/);
  assert.match(sql,/toolbox_can_access/);
});
test('Restore creates a safety backup and Personal settings expose create, download and restore',()=>{
  assert.match(sql,/Always save the current Personal state first/);
  assert.match(ui,/Create backup/);assert.match(ui,/Download latest/);assert.match(ui,/Restore latest/);
});
