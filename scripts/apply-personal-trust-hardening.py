from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p=Path(path); text=p.read_text()
    if old not in text:
        raise SystemExit(f'missing expected block in {path}: {old[:80]!r}')
    p.write_text(text.replace(old,new,1))

replace_once('lib/items.ts',"""export function priority(item: Item, now = Date.now()) {
  const hours = (dueTime(item) - now) / 3600000;
  return item.importance * 12 + item.urgency * 8 + (hours < 0 ? 80 : hours <= 24 ? 60 : hours <= 72 ? 35 : hours <= 168 ? 10 : 0);
}
export function attention(items: Item[], now = Date.now()) {
  return items.filter(i => actionable(i) && i.status === 'active' && !i.parent_id &&
    (i.importance >= 4 || i.urgency >= 4 || dueTime(i) <= now + 72 * 3600000))
    .sort((a,b) => priority(b, now) - priority(a, now) || (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999') || a.created_at.localeCompare(b.created_at)).slice(0,5);
}
""","""export function priority(item: Item, now = Date.now()) {
  const hours = (dueTime(item) - now) / 3600000;
  const seen=Date.parse(item.last_opened_at||item.created_at);
  const unattended=Number.isFinite(seen)?Math.max(0,(now-seen)/3600000):0;
  const staleBoost=unattended>=24?Math.min(70,35+Math.floor((unattended-24)/24)*10):0;
  return item.importance * 12 + item.urgency * 8 + (hours < 0 ? 80 : hours <= 24 ? 60 : hours <= 72 ? 35 : hours <= 168 ? 10 : 0) + staleBoost;
}
export function attention(items: Item[], now = Date.now()) {
  const ranked=items.filter(i => actionable(i) && i.status === 'active' && !i.parent_id &&
    (i.importance >= 4 || i.urgency >= 4 || dueTime(i) <= now + 72 * 3600000 || unopenedForDay(i,now)))
    .sort((a,b) => priority(b, now) - priority(a, now) || (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999') || a.created_at.localeCompare(b.created_at));
  const chosen=ranked.slice(0,5),stale=ranked.filter(i=>unopenedForDay(i,now));
  if(stale.length&&chosen.length===5&&!chosen.some(i=>unopenedForDay(i,now)))chosen[4]=stale[0];
  return chosen.sort((a,b)=>priority(b,now)-priority(a,now)||(a.due_at??'9999').localeCompare(b.due_at??'9999')||a.created_at.localeCompare(b.created_at));
}
""")

replace_once('lib/conversation.ts',"""    let foundQuery=client.from('items').select(columns).neq('type','capture').or(words.map(word=>'title.ilike.%'+word+'%').join(','));
""","""    let foundQuery=client.from('items').select(columns).neq('type','capture').or(words.flatMap(word=>['title.ilike.%'+word+'%','content.ilike.%'+word+'%']).join(','));
""")

replace_once('lib/capture-schema.ts',"""const subtask=z.object({...fields,type:z.literal('task')}).strict();
const update=z.object({item_id:z.string().uuid(),status:z.enum(['active','completed']).nullable(),change_due:z.boolean(),
""","""const subtask=z.object({...fields,type:z.literal('task')}).strict();
const captureItem=z.object({...fields,parent_id:z.string().uuid().nullable().default(null),subtasks:z.array(subtask).max(20)}).strict();
const update=z.object({item_id:z.string().uuid(),status:z.enum(['active','completed']).nullable(),change_due:z.boolean(),
""")
replace_once('lib/capture-schema.ts',"""export const organizedCapture=z.object({items:z.array(z.object({...fields,subtasks:z.array(subtask).max(20)}).strict()).max(40),
""","""export const organizedCapture=z.object({items:z.array(captureItem).max(40),
""")
replace_once('lib/capture-schema.ts',"""  properties:{items:{type:'array',items:{type:'object',additionalProperties:false,required:[...Object.keys(properties),'subtasks'],
    properties:{...properties,subtasks:{type:'array',items:childSchema}}}},
""","""  properties:{items:{type:'array',items:{type:'object',additionalProperties:false,required:[...Object.keys(properties),'parent_id','subtasks'],
    properties:{...properties,parent_id:{type:['string','null']},subtasks:{type:'array',items:childSchema}}}},
""")
replace_once('lib/capture-schema.ts',"""    'CONNECTED ACTIONS: When the user explicitly describes multiple actions that belong to one outcome or one action is a prerequisite for another, group them under one concise parent task and put the explicit steps in practical execution order. Example: get cat litter and then clean/refill the cat boxes should surface the litter/shopping step before the cleaning/refill step. Do not invent stores, purchases, or errands the user did not state.',
    'GENERAL NOTES: Thoughts that are not actions now but may be useful or relevant later should be stored as note or reference items, not forced into To Do.',
""","""    'CONNECTED ACTIONS: When the user explicitly describes multiple actions that belong to one outcome or one action is a prerequisite for another, group them under one concise parent task and put the explicit steps in practical execution order. Example: get cat litter and then clean/refill the cat boxes should surface the litter/shopping step before the cleaning/refill step. Do not invent stores, purchases, or errands the user did not state.',
    'RELATED EXISTING TASKS: Existing personal items may come from older captures. When a genuinely new explicit task is clearly a step of exactly one supplied ACTIVE top-level personal task, set parent_id to that existing task ID so it becomes a connected step instead of an unrelated duplicate. Only task items may use parent_id. Never attach notes, references, reminders, or a task with its own subtasks. If the relationship is merely plausible, leave parent_id null. Never invent an ID and never duplicate an existing task just to make a connection.',
    'GENERAL NOTES: Thoughts that are not actions now but may be useful or relevant later should be stored as note or reference items, not forced into To Do.',
""")

replace_once('lib/capture-handler.ts',"""      organized.items=organized.items.filter(item=>item.area!=='Work');
      organized.updates=organized.updates.filter(change=>context.candidates.get(change.item_id)?.area!=='Work'&&change.area!=='Work');
      if(removed)organized.reply=(organized.items.length||organized.updates.length?'I kept the Work part out of Personal and handled the personal part.':'That belongs in Work mode, so I kept it out of Personal.');
""","""      organized.items=organized.items.filter(item=>item.area!=='Work');
      organized.updates=organized.updates.filter(change=>context.candidates.get(change.item_id)?.area!=='Work'&&change.area!=='Work');
      for(const item of organized.items)if(item.parent_id){
        const parent=context.candidates.get(item.parent_id);
        if(item.type!=='task'||item.subtasks.length||!parent||parent.area==='Work'||parent.type!=='task'||parent.status!=='active'||parent.parent_id)throw new Error('ORGANIZE');
      }
      if(removed)organized.reply=(organized.items.length||organized.updates.length?'I kept the Work part out of Personal and handled the personal part.':'That belongs in Work mode, so I kept it out of Personal.');
""")
replace_once('lib/capture-handler.ts',"""      for(const item of organized.items){
        item.area='Work';
""","""      for(const item of organized.items){
        if(item.parent_id!==null)throw new Error('ORGANIZE');
        item.area='Work';
""")
replace_once('lib/capture-handler.ts',"""    for(const item of organized.items){
      const id=crypto.randomUUID(),{subtasks,...rest}=item;
      const factual=rest.type==='note'||rest.type==='reference';
      rows.push({...rest,...(factual?{importance:1,urgency:1,due_at:null,due_date:null}:{}),id,parent_id:null});
      if(item.type==='task')for(const sub of subtasks)rows.push({...sub,id:crypto.randomUUID(),parent_id:id});
    }
""","""    for(const item of organized.items){
      const id=crypto.randomUUID(),{subtasks,parent_id,...rest}=item;
      const factual=rest.type==='note'||rest.type==='reference';
      rows.push({...rest,...(factual?{importance:1,urgency:1,due_at:null,due_date:null}:{}),id,parent_id:parent_id??null});
      if(item.type==='task'&&!parent_id)for(const sub of subtasks)rows.push({...sub,id:crypto.randomUUID(),parent_id:id});
    }
""")

replace_once('app/toolbox.tsx',"""import {Button} from '@/components/ui/button';
""","""import {Button} from '@/components/ui/button';
import {PersonalRecovery} from '@/components/personal-recovery';
""")
replace_once('app/toolbox.tsx',"""          <div className=\"auth-card\" style={{marginTop:0}}><h3>Keep it on your Home Screen</h3><p className=\"muted\" style={{marginTop:8}}>In iPhone Safari, tap Share, then Add to Home Screen. Open it once online before using it offline.</p></div>
          <p className=\"muted\">Reminders appear in the app when they’re due. This version doesn’t send push notifications.</p>
""","""          <div className=\"auth-card\" style={{marginTop:0}}><h3>Keep it on your Home Screen</h3><p className=\"muted\" style={{marginTop:8}}>In iPhone Safari, tap Share, then Add to Home Screen. Open it once online before using it offline.</p></div>
          <PersonalRecovery client={clientRef.current!} onRestored={()=>location.reload()}/>
          <p className=\"muted\">Reminders appear in the app when they’re due. This version doesn’t send push notifications.</p>
""")

p=Path('tests/items.test.ts'); text=p.read_text(); text += """
test('An untouched low-priority task becomes eligible for Today after 24 hours',()=>{
  const stale=item('stale',{importance:1,urgency:1,created_at:'2026-09-09T10:00:00Z',last_opened_at:'2026-09-09T10:00:00Z'});
  const fresh=item('fresh',{importance:1,urgency:1,created_at:'2026-09-11T11:30:00Z',last_opened_at:'2026-09-11T11:30:00Z'});
  assert.ok(attention([stale,fresh],now).some(i=>i.id==='stale'));
  assert.equal(attention([stale,fresh],now).some(i=>i.id==='fresh'),false);
});

test('Today reserves room for an old untouched task even with five stronger fresh items',()=>{
  const stale=item('stale',{importance:1,urgency:1,created_at:'2026-09-08T10:00:00Z',last_opened_at:'2026-09-08T10:00:00Z'});
  const fresh=Array.from({length:5},(_,i)=>item('fresh'+i,{importance:5,urgency:5,last_opened_at:'2026-09-11T11:30:00Z'}));
  const home=attention([...fresh,stale],now);
  assert.equal(home.length,5);assert.ok(home.some(i=>i.id==='stale'));
});
"""; p.write_text(text)

p=Path('tests/personal-mode.test.ts'); text=p.read_text(); text=text.replace("assert.match(prompt,/CONNECTED ACTIONS/);","assert.match(prompt,/CONNECTED ACTIONS/);\n  assert.match(prompt,/RELATED EXISTING TASKS/);"); p.write_text(text)

Path('tests/personal-backup.test.ts').write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/personal-backups.sql',import.meta.url),'utf8');
const ui=readFileSync(new URL('../components/personal-recovery.tsx',import.meta.url),'utf8');
test('Personal backups are owner-scoped and explicitly exclude Work',()=>{
  assert.match(sql,/enable row level security/i);
  assert.match(sql,/i\.area<>\'Work\'/);
  assert.match(sql,/Work data cannot be restored through Personal recovery/);
  assert.match(sql,/toolbox_can_access/);
});
test('Restore creates a safety backup and Personal settings expose create, download and restore',()=>{
  assert.match(sql,/Always save the current Personal state first/);
  assert.match(ui,/Create backup/);assert.match(ui,/Download latest/);assert.match(ui,/Restore latest/);
});
""")
