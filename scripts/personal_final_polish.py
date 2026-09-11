from pathlib import Path

# Personal UI fixes.
p=Path('app/toolbox.tsx'); text=p.read_text()
repls={
"{!aiHistory.length&&!lastTurn&&!pending.some(capture=>capture.channel==='ai')&&<div className=\"empty\">":"{!aiHistory.length&&!pending.some(capture=>capture.channel==='ai')&&<div className=\"empty\">",
"{completedGroups.slice(0,limit).map(group=><section className=\"completed-day\" key={group.key}><h3>{group.label}</h3><div className=\"item-list\">{group.rows.map(row)}</div></section>)}":"{completedGroups.slice(0,limit).map((group,index)=><details className=\"completed-day\" key={group.key} open={index===0}><summary><span>{group.label}</span><small>{group.rows.length} {group.rows.length===1?'item':'items'}</small></summary><div className=\"item-list\">{group.rows.map(row)}</div></details>)}",
"if(clientRef.current&&navigator.onLine)void clientRef.current.from('items').update({last_opened_at:opened}).eq('id',item.id).then":"if(clientRef.current&&navigator.onLine)void clientRef.current.from('items').update({last_opened_at:opened}).eq('id',item.id).eq('user_id',owner).then",
}
for old,new in repls.items():
    if old not in text: raise SystemExit('Missing toolbox target: '+old[:120])
    text=text.replace(old,new,1)
p.write_text(text)

# Done accordion styling.
p=Path('app/toolbox.css'); css=p.read_text()
old=".completed-day{margin:0 0 20px}.completed-day>h3{margin:0 0 9px;color:#56667e;font-size:.82rem;text-transform:uppercase;letter-spacing:.06em}"
new=".completed-day{margin:0 0 12px;border:1px solid var(--border);border-radius:16px;background:#fff;overflow:hidden}.completed-day>summary{cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 15px;color:#56667e;font-size:.82rem;font-weight:750;text-transform:uppercase;letter-spacing:.06em;background:#f8fafc}.completed-day>summary::-webkit-details-marker{display:none}.completed-day>summary:after{content:'+';font-size:1.1rem;color:#7b879a}.completed-day[open]>summary:after{content:'−'}.completed-day>summary small{margin-left:auto;font-size:.72rem;font-weight:650;text-transform:none;letter-spacing:0;color:#8793a5}.completed-day .item-list{padding:10px}"
if old not in css: raise SystemExit('Missing completed CSS target')
css=css.replace(old,new,1);p.write_text(css)

# Local-day grouping and DST-safe day labels.
p=Path('lib/items.ts'); text=p.read_text()
old="export function completionDayKey(item:Pick<Item,'completed_at'|'updated_at'>){const d=new Date(completionMoment(item));return Number.isNaN(d.getTime())?'unknown':d.toISOString().slice(0,10);}\nexport function completionDayLabel(item:Pick<Item,'completed_at'|'updated_at'>,now=new Date()){\n  const d=new Date(completionMoment(item));if(Number.isNaN(d.getTime()))return 'Earlier';\n  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate()),day=new Date(d.getFullYear(),d.getMonth(),d.getDate());\n  const diff=Math.round((today.getTime()-day.getTime())/86400000);"
new="export function completionDayKey(item:Pick<Item,'completed_at'|'updated_at'>){const d=new Date(completionMoment(item));if(Number.isNaN(d.getTime()))return 'unknown';return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}\nexport function completionDayLabel(item:Pick<Item,'completed_at'|'updated_at'>,now=new Date()){\n  const d=new Date(completionMoment(item));if(Number.isNaN(d.getTime()))return 'Earlier';\n  const diff=Math.round((Date.UTC(now.getFullYear(),now.getMonth(),now.getDate())-Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()))/86400000);"
if old not in text: raise SystemExit('Missing completion helper target')
text=text.replace(old,new,1);p.write_text(text)

# Trigger: last_opened_at-only updates are metadata and must not change content updated_at.
function_sql="""create or replace function public.toolbox_touch_item() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
   new.updated_at=coalesce(new.updated_at,now());
   if new.type<>'capture' and new.last_opened_at is null then new.last_opened_at=coalesce(new.created_at,now()); end if;
   if new.type<>'capture' and new.status='completed' and new.completed_at is null then new.completed_at=now(); end if;
 else
   if (to_jsonb(new)-'updated_at'-'last_opened_at'-'completed_at') is distinct from (to_jsonb(old)-'updated_at'-'last_opened_at'-'completed_at') then
     new.updated_at=now();
   else
     new.updated_at=old.updated_at;
   end if;
   if new.type<>'capture' and old.status is distinct from new.status then
     if new.status='completed' then new.completed_at=now(); end if;
     if new.status='active' then new.completed_at=null; end if;
   end if;
 end if;
 if new.parent_id is not null then
   if new.type<>'task' or not exists(select 1 from public.items where id=new.parent_id and user_id=new.user_id and type='task' and parent_id is null) then
     raise exception 'Subtasks require an owned top-level task';
   end if;
 end if;
 if new.type<>'task' and exists(select 1 from public.items where parent_id=new.id) then raise exception 'A task with subtasks must remain a task'; end if;
 return new;
end $$;"""
for file in ['supabase/personal-item-history.sql','supabase/schema.sql']:
    p=Path(file); text=p.read_text(); start=text.find("create or replace function public.toolbox_touch_item()") if file.endswith('personal-item-history.sql') else text.find("create function public.toolbox_touch_item()")
    if start<0: raise SystemExit('Missing trigger function in '+file)
    end=text.find("end $$;",start)
    if end<0: raise SystemExit('Missing trigger end in '+file)
    replacement=function_sql if file.endswith('personal-item-history.sql') else function_sql.replace('create or replace function','create function',1)
    text=text[:start]+replacement+text[end+7:]
    p.write_text(text)
Path('supabase/personal-open-metadata.sql').write_text("-- Opening an item is view metadata and must not make its contents look newly changed.\n"+function_sql+"\n")

# Regression tests.
p=Path('tests/personal-mode.test.ts'); text=p.read_text()
text=text.replace("assert.equal(completionDayKey({completed_at:'2026-09-10T23:00:00Z',updated_at:'2026-09-11T15:00:00Z'}),'2026-09-10');", "const completed='2026-09-10T12:00:00';\n  assert.equal(completionDayKey({completed_at:completed,updated_at:'2026-09-11T15:00:00Z'}),completionDayKey({completed_at:null,updated_at:completed}));")
p.write_text(text)
p=Path('tests/personal-ui.test.ts'); text=p.read_text(); text=text.replace("  assert.match(source,/Search finished items/);", "  assert.match(source,/Search finished items/);\n  assert.match(source,/details className=\\\"completed-day\\\"/);\n  assert.doesNotMatch(source,/!aiHistory.length&&!lastTurn/);"); p.write_text(text)
